from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class SessionCreate(BaseModel):
    title: str = Field(default="New chat", min_length=1, max_length=200)
    use_rag: bool = True

    @field_validator("title")
    @classmethod
    def clean_title(cls, title: str) -> str:
        if not title.strip():
            raise ValueError("Session title cannot be empty")
        return title.strip()


class SessionUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    use_rag: bool | None = None

    @field_validator("title")
    @classmethod
    def clean_title(cls, title: str | None) -> str | None:
        if title is not None and not title.strip():
            raise ValueError("Session title cannot be empty")
        return title.strip() if title is not None else None

    @model_validator(mode="after")
    def require_change(self) -> SessionUpdate:
        if self.title is None and self.use_rag is None:
            raise ValueError("At least one session field must be provided")
        return self


class SessionSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    use_rag: bool
    created_at: datetime
    updated_at: datetime


class AttachedDocument(BaseModel):
    id: uuid.UUID
    name: str
    chunk_count: int


class StoredMessage(BaseModel):
    id: uuid.UUID
    role: str
    status: str
    content: str
    details: dict[str, Any]
    created_at: datetime
    documents: list[AttachedDocument] = Field(default_factory=list)


class SessionDetail(SessionSummary):
    messages: list[StoredMessage]
