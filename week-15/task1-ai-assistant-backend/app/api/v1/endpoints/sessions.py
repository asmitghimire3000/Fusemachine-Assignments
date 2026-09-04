from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.dependencies import get_current_user, get_session_service
from app.db.models import User
from app.schemas.session import (
    SessionCreate,
    SessionDetail,
    SessionSummary,
    SessionUpdate,
)
from app.services.sessions import SessionNotFound, SessionService

router = APIRouter(prefix="/sessions")


@router.post("", response_model=SessionSummary, status_code=status.HTTP_201_CREATED)
async def create_session(
    data: SessionCreate,
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[SessionService, Depends(get_session_service)],
) -> SessionSummary:
    return await service.create(user.id, data)


@router.get("", response_model=list[SessionSummary])
async def list_sessions(
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[SessionService, Depends(get_session_service)],
) -> list[SessionSummary]:
    return await service.list_sessions(user.id)


@router.get("/{session_id}", response_model=SessionDetail)
async def get_session(
    session_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[SessionService, Depends(get_session_service)],
) -> SessionDetail:
    try:
        return await service.get(user.id, session_id)
    except SessionNotFound as exc:
        raise _not_found() from exc


@router.patch("/{session_id}", response_model=SessionSummary)
async def update_session(
    session_id: uuid.UUID,
    data: SessionUpdate,
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[SessionService, Depends(get_session_service)],
) -> SessionSummary:
    try:
        return await service.update(user.id, session_id, data)
    except SessionNotFound as exc:
        raise _not_found() from exc


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(
    session_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[SessionService, Depends(get_session_service)],
) -> None:
    try:
        await service.delete(user.id, session_id)
    except SessionNotFound as exc:
        raise _not_found() from exc


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Chat session not found",
    )
