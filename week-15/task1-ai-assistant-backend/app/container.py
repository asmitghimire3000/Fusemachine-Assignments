from __future__ import annotations

import asyncio

from app.assistant.agent import AssistantAgent
from app.auth.google import GoogleTokenVerifier
from app.core.config import Settings
from app.core.redis import RedisClient
from app.db.session import Database
from app.llm.client import LLMClient
from app.rag.chunker import TextChunker
from app.rag.embeddings import EmbeddingService
from app.rag.loader import DocumentLoader
from app.rag.retriever import Retriever
from app.rag.vector_store import VectorStore
from app.services.auth import AuthService
from app.services.chat import ChatService
from app.services.document_cleanup import DocumentCleanupService
from app.services.ingestion import IngestionService
from app.services.rate_limit import RateLimiter
from app.services.sessions import SessionService
from app.tools.builtin import create_default_tool_registry


class ApplicationContainer:
    """Construct and own the shared services used by API requests."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

        # Step 1: Create clients shared for the application's lifetime.
        self.llm_client = LLMClient(settings)
        self.vector_store = VectorStore(settings)
        self.database = Database(
            settings.database_url.get_secret_value(),
            echo=settings.database_echo,
        )
        self.redis = RedisClient(settings.redis_url.get_secret_value())
        self.rate_limiter = RateLimiter(
            self.redis.client,
            requests=settings.chat_rate_limit_requests,
            window_seconds=settings.chat_rate_limit_window_seconds,
        )
        google_verifier = (
            GoogleTokenVerifier(settings.google_client_id)
            if settings.google_client_id
            else None
        )
        self.auth_service = AuthService(
            self.database,
            google_verifier,
            session_days=settings.auth_session_days,
        )
        self.session_service = SessionService(self.database)
        self.document_cleanup_service = DocumentCleanupService(
            self.database,
            self.vector_store,
            batch_size=settings.document_cleanup_batch_size,
            interval_seconds=settings.document_cleanup_interval_seconds,
        )

        # Step 2: Assemble the retrieval pipeline.
        embeddings = EmbeddingService(
            settings.embedding_model,
            device=settings.embedding_device,
            batch_size=settings.embedding_batch_size,
            expected_dimension=settings.embedding_dimension,
        )
        retriever = Retriever(
            embeddings,
            self.vector_store,
            top_k=settings.rag_retrieval_top_k,
            score_threshold=settings.rag_score_threshold,
        )

        # Step 3: Assemble the model and tool-calling pipeline.
        agent = AssistantAgent(
            self.llm_client,
            create_default_tool_registry(settings),
            settings,
        )

        # Step 4: Expose use-case services consumed by API endpoints.
        self.chat_service = ChatService(retriever, agent, self.database)
        self.ingestion_service = IngestionService(
            DocumentLoader(),
            TextChunker(settings.rag_chunk_size, settings.rag_chunk_overlap),
            embeddings,
            self.vector_store,
            self.database,
            max_upload_size_mb=settings.max_upload_size_mb,
            max_batch_files=settings.max_batch_upload_files,
            retention_days=settings.document_retention_days,
        )

    async def close(self) -> None:
        await asyncio.gather(
            self.llm_client.close(),
            self.vector_store.close(),
            self.database.close(),
            self.redis.close(),
        )
