from __future__ import annotations

import asyncio

from app.core.config import get_settings
from app.db.session import Database
from app.rag.vector_store import VectorStore
from app.services.document_cleanup import DocumentCleanupService


async def main() -> None:
    settings = get_settings()
    database = Database(
        settings.database_url.get_secret_value(),
        echo=settings.database_echo,
    )
    vector_store = VectorStore(settings)
    service = DocumentCleanupService(
        database,
        vector_store,
        batch_size=settings.document_cleanup_batch_size,
        interval_seconds=settings.document_cleanup_interval_seconds,
    )

    try:
        deleted_count = await service.cleanup_expired()
        print(f"Deleted {deleted_count} expired document(s).")
    finally:
        await vector_store.close()
        await database.close()


if __name__ == "__main__":
    asyncio.run(main())
