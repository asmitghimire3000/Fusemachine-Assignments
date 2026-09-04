from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.container import ApplicationContainer
from app.core.config import get_settings
from app.core.logging import configure_logging

logger = logging.getLogger(__name__)
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    configure_logging(settings.app_log_level)
    container = ApplicationContainer(settings)
    app.state.container = container
    stop_cleanup = asyncio.Event()
    cleanup_task = (
        asyncio.create_task(
            container.document_cleanup_service.run_periodically(stop_cleanup)
        )
        if settings.document_cleanup_interval_seconds > 0
        else None
    )
    logger.info("Application started with %s backend", settings.llm_backend)

    try:
        yield
    finally:
        stop_cleanup.set()
        if cleanup_task is not None:
            await cleanup_task
        await container.close()
        logger.info("Application shutdown complete")


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(api_router, prefix=settings.app_api_v1_prefix)
    return app


app = create_app()
