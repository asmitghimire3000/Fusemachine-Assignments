from __future__ import annotations

from typing import Annotated, cast

from fastapi import Depends, HTTPException, Request, status

from app.container import ApplicationContainer
from app.db.models import User
from app.services.auth import AuthenticationRequired, AuthService
from app.services.chat import ChatService
from app.services.ingestion import IngestionService
from app.services.rate_limit import RateLimiter
from app.services.sessions import SessionService


def get_container(request: Request) -> ApplicationContainer:
    return cast(ApplicationContainer, request.app.state.container)


def get_chat_service(request: Request) -> ChatService:
    return get_container(request).chat_service


def get_ingestion_service(request: Request) -> IngestionService:
    return get_container(request).ingestion_service


def get_auth_service(request: Request) -> AuthService:
    return get_container(request).auth_service


def get_session_service(request: Request) -> SessionService:
    return get_container(request).session_service


def get_rate_limiter(request: Request) -> RateLimiter:
    return get_container(request).rate_limiter


async def get_current_user(
    request: Request,
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
) -> User:
    cookie_name = get_container(request).settings.auth_cookie_name

    try:
        return await auth_service.authenticate(request.cookies.get(cookie_name))
    except AuthenticationRequired as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        ) from exc


async def enforce_chat_rate_limit(
    user: Annotated[User, Depends(get_current_user)],
    rate_limiter: Annotated[RateLimiter, Depends(get_rate_limiter)],
) -> None:
    """Reject chat requests after a user consumes the configured allowance."""

    result = await rate_limiter.check(user.id)
    if result.allowed:
        return

    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail="Too many chat requests. Please try again shortly.",
        headers={"Retry-After": str(result.retry_after_seconds)},
    )
