from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import select

from app.db.models import Document
from app.db.session import Database
from app.rag.vector_store import VectorStore

logger = logging.getLogger(__name__)


class DocumentCleanupService:
    """Remove expired documents from Qdrant and PostgreSQL."""

    def __init__(
        self,
        database: Database,
        vector_store: VectorStore,
        *,
        batch_size: int,
        interval_seconds: int,
    ) -> None:
        self._database = database
        self._vector_store = vector_store
        self._batch_size = batch_size
        self._interval_seconds = interval_seconds

    async def cleanup_expired(self) -> int:
        """Delete one bounded batch and return the number removed."""

        document_ids = await self._find_expired_document_ids()
        deleted_count = 0

        for document_id in document_ids:
            if await self._delete_if_still_expired(document_id):
                deleted_count += 1

        if deleted_count:
            logger.info("Deleted %s expired document(s)", deleted_count)
        return deleted_count

    async def run_periodically(self, stop_event: asyncio.Event) -> None:
        """Run cleanup until application shutdown requests a stop."""

        while not stop_event.is_set():
            try:
                await self.cleanup_expired()
            except Exception:
                logger.exception("Expired document cleanup failed")

            try:
                await asyncio.wait_for(
                    stop_event.wait(),
                    timeout=self._interval_seconds,
                )
            except TimeoutError:
                continue

    async def _find_expired_document_ids(self) -> list[uuid.UUID]:
        statement = (
            select(Document.id)
            .where(Document.expires_at <= datetime.now(UTC))
            .order_by(Document.expires_at)
            .limit(self._batch_size)
        )
        async with self._database.session() as database_session:
            return list((await database_session.scalars(statement)).all())

    async def _delete_if_still_expired(self, document_id: uuid.UUID) -> bool:
        """Lock and recheck a document before deleting its vectors and row."""

        async with self._database.session() as database_session:
            async with database_session.begin():
                document = await database_session.scalar(
                    select(Document)
                    .where(
                        Document.id == document_id,
                        Document.expires_at <= datetime.now(UTC),
                    )
                    .with_for_update(skip_locked=True)
                )
                if document is None:
                    return False

                await self._vector_store.delete_document(
                    str(document.user_id),
                    str(document.id),
                )
                await database_session.delete(document)
                return True
