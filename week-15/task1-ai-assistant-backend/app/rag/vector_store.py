from __future__ import annotations

import asyncio
import logging

from qdrant_client import AsyncQdrantClient, models

from app.core.config import Settings
from app.schemas.document import DocumentChunk, RetrievedChunk

logger = logging.getLogger(__name__)


class CloudInferenceUnavailable(RuntimeError):
    """Raised when Qdrant cannot embed text in the cloud."""


class VectorStore:
    UPSERT_BATCH_SIZE = 100
    DENSE_VECTOR = "dense"
    SPARSE_VECTOR = "sparse"
    RERANK_VECTOR = "multi"

    def __init__(self, settings: Settings) -> None:
        api_key = (
            settings.qdrant_api_key.get_secret_value()
            if settings.qdrant_api_key
            else None
        )
        self._client = AsyncQdrantClient(
            url=str(settings.qdrant_url),
            api_key=api_key or None,
            cloud_inference=True,
        )
        self._collection = settings.qdrant_collection
        self._dimension = settings.embedding_dimension
        self._dense_model = settings.qdrant_dense_model
        self._sparse_model = settings.qdrant_sparse_model
        self._reranker_model = settings.qdrant_reranker_model
        self._reranker_dimension = settings.qdrant_reranker_dimension
        self._candidate_limit = settings.rag_candidate_top_k
        self._cloud_inference_available = True
        self._collection_ready = False
        self._collection_lock = asyncio.Lock()

    @property
    def cloud_inference_available(self) -> bool:
        return self._cloud_inference_available

    async def close(self) -> None:
        await self._client.close()

    async def ensure_collection(self) -> None:
        if self._collection_ready:
            return

        async with self._collection_lock:
            if self._collection_ready:
                return

            await self._create_collection_if_needed()
            self._collection_ready = True

    async def _create_collection_if_needed(self) -> None:
        # Step 1: Create the vector collection on the first ingestion.
        if not await self._client.collection_exists(self._collection):
            await self._client.create_collection(
                collection_name=self._collection,
                vectors_config={
                    self.DENSE_VECTOR: models.VectorParams(
                        size=self._dimension,
                        distance=models.Distance.COSINE,
                    ),
                    self.RERANK_VECTOR: models.VectorParams(
                        size=self._reranker_dimension,
                        distance=models.Distance.COSINE,
                        multivector_config=models.MultiVectorConfig(
                            comparator=models.MultiVectorComparator.MAX_SIM,
                        ),
                        hnsw_config=models.HnswConfigDiff(m=0),
                    ),
                },
                sparse_vectors_config={
                    self.SPARSE_VECTOR: models.SparseVectorParams(
                        modifier=models.Modifier.IDF,
                    )
                },
            )

        # Step 2: Index the field used to replace an existing document.
        await self._client.create_payload_index(
            collection_name=self._collection,
            field_name="document_id",
            field_schema=models.PayloadSchemaType.KEYWORD,
            wait=True,
        )
        await self._client.create_payload_index(
            collection_name=self._collection,
            field_name="user_id",
            field_schema=models.PayloadSchemaType.KEYWORD,
            wait=True,
        )

    async def replace_document_from_text(
        self,
        user_id: str,
        document_id: str,
        chunks: list[DocumentChunk],
    ) -> None:
        """Ask Qdrant Cloud to embed and store document chunks."""

        if not self._cloud_inference_available:
            raise CloudInferenceUnavailable

        try:
            await self.ensure_collection()
            await self._delete_document(user_id, document_id)
            points = [
                models.PointStruct(
                    id=chunk.chunk_id,
                    vector={
                        self.DENSE_VECTOR: models.Document(
                            text=chunk.text,
                            model=self._dense_model,
                        ),
                        self.SPARSE_VECTOR: models.Document(
                            text=chunk.text,
                            model=self._sparse_model,
                        ),
                        self.RERANK_VECTOR: models.Document(
                            text=chunk.text,
                            model=self._reranker_model,
                        ),
                    },
                    payload=chunk.model_dump(),
                )
                for chunk in chunks
            ]
            await self._upsert_batches(points)
        except Exception as exc:
            self._disable_cloud_inference(exc)
            raise CloudInferenceUnavailable from exc

    async def replace_document(
        self,
        user_id: str,
        document_id: str,
        chunks: list[DocumentChunk],
        vectors: list[list[float]],
    ) -> None:
        """Delete old chunks for a document and write its current chunks."""

        # Step 1: Validate input and ensure the collection exists.
        if len(chunks) != len(vectors):
            raise ValueError("Every chunk must have exactly one embedding")
        await self.ensure_collection()

        # Step 2: Remove vectors from an earlier ingestion of this document.
        await self._delete_document(user_id, document_id)

        # Step 3: Convert chunks and embeddings into Qdrant points.
        points = self._build_points(chunks, vectors)

        # Step 4: Write bounded batches instead of one unbounded request.
        await self._upsert_batches(points)

    async def delete_document(self, user_id: str, document_id: str) -> None:
        """Delete every vector belonging to one user's document."""

        await self._delete_document(user_id, document_id)

    async def _delete_document(self, user_id: str, document_id: str) -> None:
        if not await self._client.collection_exists(self._collection):
            self._collection_ready = False
            return

        await self._client.delete(
            collection_name=self._collection,
            points_selector=models.FilterSelector(
                filter=models.Filter(
                    must=[
                        models.FieldCondition(
                            key="user_id",
                            match=models.MatchValue(value=user_id),
                        ),
                        models.FieldCondition(
                            key="document_id",
                            match=models.MatchValue(value=document_id),
                        ),
                    ]
                )
            ),
            wait=True,
        )

    @classmethod
    def _build_points(
        cls,
        chunks: list[DocumentChunk],
        vectors: list[list[float]],
    ) -> list[models.PointStruct]:
        return [
            models.PointStruct(
                id=chunk.chunk_id,
                vector={cls.DENSE_VECTOR: vector},
                payload=chunk.model_dump(),
            )
            for chunk, vector in zip(chunks, vectors, strict=True)
        ]

    async def _upsert_batches(self, points: list[models.PointStruct]) -> None:
        for start in range(0, len(points), self.UPSERT_BATCH_SIZE):
            await self._client.upsert(
                collection_name=self._collection,
                points=points[start : start + self.UPSERT_BATCH_SIZE],
                wait=True,
            )

    async def search(
        self,
        query_vector: list[float],
        *,
        user_id: str,
        document_ids: list[str],
        limit: int,
        score_threshold: float,
    ) -> list[RetrievedChunk]:
        """Find nearest chunks and validate their stored payloads."""

        # Step 1: Search Qdrant using cosine similarity.
        await self.ensure_collection()
        response = await self._client.query_points(
            collection_name=self._collection,
            query=query_vector,
            using=self.DENSE_VECTOR,
            query_filter=self._scope_filter(user_id, document_ids),
            limit=limit,
            score_threshold=score_threshold,
            with_payload=True,
            with_vectors=False,
        )

        # Step 2: Convert database points back into domain schemas.
        return [self._to_retrieved_chunk(point) for point in response.points]

    async def search_text(
        self,
        query: str,
        *,
        user_id: str,
        document_ids: list[str],
        limit: int,
        score_threshold: float,
    ) -> list[RetrievedChunk]:
        """Run cloud hybrid retrieval followed by ColBERT reranking."""

        if not self._cloud_inference_available:
            raise CloudInferenceUnavailable

        try:
            await self.ensure_collection()
            response = await self._client.query_points(
                collection_name=self._collection,
                prefetch=[
                    models.Prefetch(
                        query=models.Document(text=query, model=self._dense_model),
                        using=self.DENSE_VECTOR,
                        filter=self._scope_filter(user_id, document_ids),
                        limit=self._candidate_limit,
                    ),
                    models.Prefetch(
                        query=models.Document(text=query, model=self._sparse_model),
                        using=self.SPARSE_VECTOR,
                        filter=self._scope_filter(user_id, document_ids),
                        limit=self._candidate_limit,
                    ),
                ],
                query=models.Document(text=query, model=self._reranker_model),
                using=self.RERANK_VECTOR,
                limit=limit,
                score_threshold=score_threshold,
                with_payload=True,
                with_vectors=False,
            )
            return [self._to_retrieved_chunk(point) for point in response.points]
        except Exception as exc:
            self._disable_cloud_inference(exc)
            raise CloudInferenceUnavailable from exc

    @staticmethod
    def _scope_filter(user_id: str, document_ids: list[str]) -> models.Filter:
        return models.Filter(
            must=[
                models.FieldCondition(
                    key="user_id",
                    match=models.MatchValue(value=user_id),
                ),
                models.FieldCondition(
                    key="document_id",
                    match=models.MatchAny(any=document_ids),
                ),
            ]
        )

    def _disable_cloud_inference(self, exc: Exception) -> None:
        if self._cloud_inference_available:
            logger.warning(
                "Qdrant Cloud Inference unavailable; using local embeddings: %s",
                exc,
            )
        self._cloud_inference_available = False

    @staticmethod
    def _to_retrieved_chunk(point: models.ScoredPoint) -> RetrievedChunk:
        payload = dict(point.payload or {})
        payload["score"] = point.score
        return RetrievedChunk.model_validate(payload)
