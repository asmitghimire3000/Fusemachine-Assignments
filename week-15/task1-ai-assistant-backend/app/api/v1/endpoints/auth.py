from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.api.dependencies import get_auth_service, get_current_user
from app.auth.google import InvalidGoogleCredential
from app.core.config import Settings
from app.db.models import User
from app.schemas.auth import AuthenticatedUser, GoogleLoginRequest, LoginResponse
from app.services.auth import AuthenticationUnavailable, AuthService

router = APIRouter(prefix="/auth")


@router.post("/google", response_model=LoginResponse)
async def login_with_google(
    login: GoogleLoginRequest,
    request: Request,
    response: Response,
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
) -> LoginResponse:
    """Exchange a verified Google ID credential for an application session."""

    settings: Settings = request.app.state.container.settings

    try:
        user, session_token = await auth_service.login_with_google(login.credential)
    except InvalidGoogleCredential as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
        ) from exc
    except AuthenticationUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    response.set_cookie(
        key=settings.auth_cookie_name,
        value=session_token,
        max_age=settings.auth_session_days * 24 * 60 * 60,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite=settings.auth_cookie_samesite,
        path="/",
    )
    return LoginResponse(user=AuthenticatedUser.model_validate(user))


@router.get("/me", response_model=AuthenticatedUser)
async def get_authenticated_user(
    user: Annotated[User, Depends(get_current_user)],
) -> AuthenticatedUser:
    return AuthenticatedUser.model_validate(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    response: Response,
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
) -> None:
    settings: Settings = request.app.state.container.settings
    await auth_service.logout(request.cookies.get(settings.auth_cookie_name))
    response.delete_cookie(
        key=settings.auth_cookie_name,
        secure=settings.auth_cookie_secure,
        httponly=True,
        samesite=settings.auth_cookie_samesite,
        path="/",
    )
