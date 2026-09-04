from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.rag.embeddings import EmbeddingService
from app.rag.vector_store import CloudInferenceUnavailable, VectorStore
from app.schemas.document import RetrievedChunk

RetrievalStrategy = Literal["hybrid_rerank", "dense_cosine", "disabled"]


@dataclass(frozen=True, slots=True)
class RetrievalResult:
    chunks: list[RetrievedChunk]
    strategy: RetrievalStrategy


class Retriever:
    def __init__(
        self,
        embeddings: EmbeddingService,
        vector_store: VectorStore,
        *,
        top_k: int,
        score_threshold: float,
    ) -> None:
        self._embeddings = embeddings
        self._vector_store = vector_store
        self._top_k = top_k
        self._score_threshold = score_threshold

    async def retrieve(
        self,
        query: str,
        *,
        user_id: str,
        document_ids: list[str],
    ) -> RetrievalResult:
        """Embed a question and retrieve its nearest document chunks."""

        if not document_ids:
            return RetrievalResult(chunks=[], strategy="disabled")

        # Step 1: Prefer the managed model used during cloud ingestion.
        try:
            return RetrievalResult(
                chunks=await self._vector_store.search_text(
                    query,
                    user_id=user_id,
                    document_ids=document_ids,
                    limit=self._top_k,
                    score_threshold=self._score_threshold,
                ),
                strategy="hybrid_rerank",
            )
        except CloudInferenceUnavailable:
            # Step 2: Fall back to the equivalent local embedding model.
            query_vector = await self._embeddings.embed_query(query)
            return RetrievalResult(
                chunks=await self._vector_store.search(
                    query_vector,
                    user_id=user_id,
                    document_ids=document_ids,
                    limit=self._top_k,
                    score_threshold=self._score_threshold,
                ),
                strategy="dense_cosine",
            )

    @staticmethod
    def format_context(chunks: list[RetrievedChunk]) -> str | None:
        """Number retrieved evidence while retaining IDs for validation."""

        if not chunks:
            return None

        sections = []
        for source_number, chunk in enumerate(chunks, start=1):
            sections.append(
                f"[source={source_number} chunk_id={chunk.chunk_id} "
                f"document={chunk.document_name}]\n{chunk.text}"
            )

        return "\n\n".join(sections)
