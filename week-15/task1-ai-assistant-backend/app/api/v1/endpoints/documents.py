from __future__ import annotations

import asyncio
import os
import tempfile
import uuid
from pathlib import Path
from typing import Annotated, BinaryIO

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from app.api.dependencies import get_current_user, get_ingestion_service
from app.db.models import User
from app.schemas.document import (
    BatchIngestionResult,
    DocumentUploadResult,
    IngestionResult,
)
from app.services.ingestion import IngestionService

router = APIRouter()
COPY_BUFFER_SIZE = 1024 * 1024
BATCH_CONCURRENCY = 3


def _copy_upload(source: BinaryIO, destination: Path, max_bytes: int) -> None:
    copied_bytes = 0
    with destination.open("wb") as target:
        while chunk := source.read(COPY_BUFFER_SIZE):
            copied_bytes += len(chunk)
            if copied_bytes > max_bytes:
                raise ValueError("Document exceeds the configured upload size limit")
            target.write(chunk)


def _create_temporary_path(filename: str) -> Path:
    file_descriptor, temporary_name = tempfile.mkstemp(suffix=Path(filename).suffix)
    os.close(file_descriptor)
    return Path(temporary_name)


async def _save_upload(file: UploadFile, destination: Path, max_bytes: int) -> None:
    await file.seek(0)
    await asyncio.to_thread(_copy_upload, file.file, destination, max_bytes)


def _upload_error(exc: ValueError | UnicodeError) -> HTTPException:
    status_code = (
        status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
        if "size limit" in str(exc)
        else status.HTTP_400_BAD_REQUEST
    )
    return HTTPException(status_code=status_code, detail=str(exc))


@router.post(
    "/documents",
    response_model=IngestionResult,
    status_code=status.HTTP_201_CREATED,
)
async def upload_document(
    file: Annotated[
        UploadFile,
        File(description="Markdown, text, or PDF document to ingest."),
    ],
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[IngestionService, Depends(get_ingestion_service)],
) -> IngestionResult:
    """Ingest one uploaded document."""

    try:
        return await _ingest_upload(file, user.id, service)
    except (ValueError, UnicodeError) as exc:
        raise _upload_error(exc) from exc


@router.post(
    "/documents/batch",
    response_model=BatchIngestionResult,
    status_code=status.HTTP_200_OK,
)
async def upload_documents(
    files: Annotated[
        list[UploadFile],
        File(description="Markdown, text, or PDF documents to ingest."),
    ],
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[IngestionService, Depends(get_ingestion_service)],
) -> BatchIngestionResult:
    """Ingest several documents and report each file independently."""

    if not files:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one document is required",
        )

    if len(files) > service.max_batch_files:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"A batch can contain at most {service.max_batch_files} files",
        )

    # Bound parallel work to protect memory and the external vector service.
    semaphore = asyncio.Semaphore(BATCH_CONCURRENCY)

    async def ingest_one(file: UploadFile) -> DocumentUploadResult:
        document_name = Path(file.filename or "document.txt").name

        async with semaphore:
            try:
                ingestion = await _ingest_upload(file, user.id, service)
                return DocumentUploadResult(
                    document_name=document_name,
                    status="success",
                    ingestion=ingestion,
                )
            except (ValueError, UnicodeError) as exc:
                return DocumentUploadResult(
                    document_name=document_name,
                    status="error",
                    error=str(exc),
                )

    file_results = list(await asyncio.gather(*(ingest_one(file) for file in files)))

    successful_files = sum(result.status == "success" for result in file_results)

    return BatchIngestionResult(
        total_files=len(file_results),
        successful_files=successful_files,
        failed_files=len(file_results) - successful_files,
        files=file_results,
    )


async def _ingest_upload(
    file: UploadFile,
    user_id: uuid.UUID,
    service: IngestionService,
) -> IngestionResult:
    """Save, ingest, and clean up one uploaded file."""

    safe_name = Path(file.filename or "document.txt").name
    temporary_path = _create_temporary_path(safe_name)

    try:
        # Step 1: Copy the upload without loading the entire file into memory.
        await _save_upload(file, temporary_path, service.max_upload_bytes)

        # Step 2: Load, chunk, embed, and store the temporary document.
        return await service.ingest(
            temporary_path,
            user_id=user_id,
            document_name=safe_name,
        )
    finally:
        # Step 3: Always close and remove temporary resources.
        await file.close()
        await asyncio.to_thread(temporary_path.unlink, missing_ok=True)
