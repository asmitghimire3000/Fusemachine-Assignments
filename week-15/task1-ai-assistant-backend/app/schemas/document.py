from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class DocumentChunk(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chunk_id: str
    document_id: str
    user_id: str
    document_name: str
    chunk_index: int = Field(ge=0)
    text: str = Field(min_length=1)
    char_start: int = Field(ge=0)
    char_end: int = Field(gt=0)


class RetrievedChunk(DocumentChunk):
    score: float


class IngestionResult(BaseModel):
    document_id: uuid.UUID
    document_name: str
    character_count: int
    chunk_count: int
    expires_at: datetime


class DocumentUploadResult(BaseModel):
    document_name: str
    status: Literal["success", "error"]
    ingestion: IngestionResult | None = None
    error: str | None = None


class BatchIngestionResult(BaseModel):
    total_files: int
    successful_files: int
    failed_files: int
    files: list[DocumentUploadResult]
