from __future__ import annotations

import argparse
import asyncio
import logging
import uuid
from pathlib import Path

from app.core.config import Settings, get_settings
from app.core.logging import configure_logging
from app.db.session import Database
from app.rag.chunker import TextChunker
from app.rag.embeddings import EmbeddingService
from app.rag.loader import SUPPORTED_EXTENSIONS, DocumentLoader
from app.rag.vector_store import VectorStore
from app.services.ingestion import IngestionService

logger = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Ingest documents into the configured Qdrant collection."
    )
    parser.add_argument(
        "paths",
        nargs="*",
        type=Path,
        help="Files or directories. Defaults to DOCUMENTS_DIRECTORY.",
    )
    parser.add_argument(
        "--user-id",
        required=True,
        type=uuid.UUID,
        help="Database user UUID that will own the documents.",
    )
    return parser.parse_args()


def discover_documents(paths: list[Path]) -> list[Path]:
    """Return supported files from explicit paths and recursive directories."""

    discovered: set[Path] = set()
    for path in paths:
        if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS:
            discovered.add(path.resolve())
        elif path.is_dir():
            discovered.update(
                candidate.resolve()
                for candidate in path.rglob("*")
                if candidate.is_file()
                and candidate.suffix.lower() in SUPPORTED_EXTENSIONS
            )
        else:
            logger.warning("Skipping missing or unsupported path: %s", path)

    return sorted(discovered)


def build_ingestion_service(
    settings: Settings,
) -> tuple[IngestionService, VectorStore, Database]:
    embeddings = EmbeddingService(
        settings.embedding_model,
        device=settings.embedding_device,
        batch_size=settings.embedding_batch_size,
        expected_dimension=settings.embedding_dimension,
    )
    vector_store = VectorStore(settings)
    database = Database(
        settings.database_url.get_secret_value(),
        echo=settings.database_echo,
    )
    service = IngestionService(
        DocumentLoader(),
        TextChunker(settings.rag_chunk_size, settings.rag_chunk_overlap),
        embeddings,
        vector_store,
        database,
        max_upload_size_mb=settings.max_upload_size_mb,
        max_batch_files=settings.max_batch_upload_files,
        retention_days=settings.document_retention_days,
    )
    return service, vector_store, database


async def ingest_documents(
    paths: list[Path],
    user_id: uuid.UUID,
    settings: Settings,
) -> int:
    """Discover, ingest, report, and clean up one batch of documents."""

    # Step 1: Discover supported documents from files and directories.
    input_paths = paths or [settings.documents_directory]
    documents = discover_documents(input_paths)
    if not documents:
        logger.error("No supported documents found in: %s", input_paths)
        return 1

    # Step 2: Build only the embedding and vector services required here.
    service, vector_store, database = build_ingestion_service(settings)
    failures = 0

    try:
        # Step 3: Ingest independently so one bad file does not stop the batch.
        for document in documents:
            try:
                result = await service.ingest(document, user_id=user_id)
                logger.info(
                    "Ingested %s (%s chunks)",
                    result.document_name,
                    result.chunk_count,
                )
            except (OSError, ValueError) as exc:
                failures += 1
                logger.error("Failed to ingest %s: %s", document, exc)
    finally:
        # Step 4: Always release the Qdrant HTTP client.
        await vector_store.close()
        await database.close()

    logger.info(
        "Ingestion complete: %s succeeded, %s failed",
        len(documents) - failures,
        failures,
    )
    return 1 if failures else 0


def main() -> int:
    settings = get_settings()
    configure_logging(settings.app_log_level)
    arguments = parse_args()
    return asyncio.run(ingest_documents(arguments.paths, arguments.user_id, settings))


if __name__ == "__main__":
    raise SystemExit(main())
