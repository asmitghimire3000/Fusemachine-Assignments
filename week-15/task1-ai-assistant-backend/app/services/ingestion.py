from __future__ import annotations

import asyncio
import hashlib
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.db.models import Document
from app.db.session import Database
from app.rag.chunker import TextChunker
from app.rag.embeddings import EmbeddingService
from app.rag.loader import DocumentLoader
from app.rag.vector_store import CloudInferenceUnavailable, VectorStore
from app.schemas.document import DocumentChunk, IngestionResult


class IngestionService:
    def __init__(
        self,
        loader: DocumentLoader,
        chunker: TextChunker,
        embeddings: EmbeddingService,
        vector_store: VectorStore,
        database: Database,
        *,
        max_upload_size_mb: int,
        max_batch_files: int,
        retention_days: int,
    ) -> None:
        self._loader = loader
        self._chunker = chunker
        self._embeddings = embeddings
        self._vector_store = vector_store
        self._database = database
        self._max_upload_bytes = max_upload_size_mb * 1024 * 1024
        self._max_batch_files = max_batch_files
        self._retention = timedelta(days=retention_days)

    @property
    def max_upload_bytes(self) -> int:
        return self._max_upload_bytes

    @property
    def max_batch_files(self) -> int:
        return self._max_batch_files

    async def ingest(
        self,
        path: Path,
        *,
        user_id: uuid.UUID,
        document_name: str | None = None,
    ) -> IngestionResult:
        """Load, index, and persist one document owned by a user."""

        # Step 1: Validate the file and extract readable text.
        file_metadata = await asyncio.to_thread(path.stat)
        if file_metadata.st_size > self._max_upload_bytes:
            raise ValueError("Document exceeds the configured upload size limit")

        loaded_document = await self._loader.load(path)
        display_name = document_name or loaded_document.name
        content_hash = hashlib.sha256(loaded_document.text.encode("utf-8")).hexdigest()
        expires_at = datetime.now(UTC) + self._retention

        # Step 2: Reuse an identical document already owned by this user.
        document, needs_indexing = await self._prepare_document(
            user_id=user_id,
            content_hash=content_hash,
            document_name=display_name,
            character_count=len(loaded_document.text),
            expires_at=expires_at,
        )
        if not needs_indexing:
            return self._result(document)

        # Step 3: Chunk using the owner-safe database document ID.
        chunks = self._chunker.split(
            loaded_document.text,
            document_id=str(document.id),
            user_id=str(user_id),
            document_name=document.name,
        )
        await self._set_chunk_count(document.id, len(chunks))

        # Step 4: Prefer Qdrant Cloud Inference, with local dense fallback.
        try:
            await self._index_document(user_id, document.id, chunks)
        except Exception:
            await self._set_status(document.id, "error")
            raise

        await self._set_status(document.id, "ready")
        document.status = "ready"
        document.chunk_count = len(chunks)
        return self._result(document)

    async def _prepare_document(
        self,
        *,
        user_id: uuid.UUID,
        content_hash: str,
        document_name: str,
        character_count: int,
        expires_at: datetime,
    ) -> tuple[Document, bool]:
        document_id = uuid.uuid4()
        statement = (
            insert(Document)
            .values(
                id=document_id,
                user_id=user_id,
                content_hash=content_hash,
                name=document_name,
                status="processing",
                character_count=character_count,
                chunk_count=0,
                expires_at=expires_at,
            )
            .on_conflict_do_nothing(constraint="uq_documents_user_id")
            .returning(Document)
        )

        async with self._database.session() as database_session:
            async with database_session.begin():
                document = await database_session.scalar(statement)
                if document is not None:
                    return document, True

                document = await database_session.scalar(
                    select(Document).where(
                        Document.user_id == user_id,
                        Document.content_hash == content_hash,
                    )
                )
                if document is None:
                    raise RuntimeError("Could not create or find uploaded document")

                document.expires_at = expires_at
                needs_indexing = document.status != "ready"
                if needs_indexing:
                    document.status = "processing"
                return document, needs_indexing

    async def _index_document(
        self,
        user_id: uuid.UUID,
        document_id: uuid.UUID,
        chunks: list[DocumentChunk],
    ) -> None:
        try:
            await self._vector_store.replace_document_from_text(
                str(user_id),
                str(document_id),
                chunks,
            )
        except CloudInferenceUnavailable:
            vectors = await self._embeddings.embed_documents(
                [chunk.text for chunk in chunks]
            )
            await self._vector_store.replace_document(
                str(user_id),
                str(document_id),
                chunks,
                vectors,
            )

    async def _set_chunk_count(self, document_id: uuid.UUID, count: int) -> None:
        async with self._database.session() as database_session:
            async with database_session.begin():
                document = await database_session.get(Document, document_id)
                if document is not None:
                    document.chunk_count = count

    async def _set_status(self, document_id: uuid.UUID, status: str) -> None:
        async with self._database.session() as database_session:
            async with database_session.begin():
                document = await database_session.get(Document, document_id)
                if document is not None:
                    document.status = status

    @staticmethod
    def _result(document: Document) -> IngestionResult:
        return IngestionResult(
            document_id=document.id,
            document_name=document.name,
            character_count=document.character_count,
            chunk_count=document.chunk_count,
            expires_at=document.expires_at,
        )
