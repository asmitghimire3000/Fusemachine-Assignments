from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.google import GoogleIdentity, GoogleTokenVerifier
from app.db.models import AuthSession, User
from app.db.session import Database


class AuthenticationRequired(ValueError):
    """Raised when a valid application session is not available."""


class AuthenticationUnavailable(RuntimeError):
    """Raised when Google authentication has not been configured."""


class AuthService:
    def __init__(
        self,
        database: Database,
        google_verifier: GoogleTokenVerifier | None,
        *,
        session_days: int,
    ) -> None:
        self._database = database
        self._google = google_verifier
        self._session_lifetime = timedelta(days=session_days)

    async def login_with_google(self, credential: str) -> tuple[User, str]:
        if self._google is None:
            raise AuthenticationUnavailable("Google authentication is not configured")

        identity = await self._google.verify(credential)
        session_token = secrets.token_urlsafe(32)

        async with self._database.session() as database_session:
            async with database_session.begin():
                user = await self._upsert_user(database_session, identity)
                database_session.add(
                    AuthSession(
                        user_id=user.id,
                        token_hash=self._hash_token(session_token),
                        expires_at=datetime.now(UTC) + self._session_lifetime,
                    )
                )

        return user, session_token

    async def authenticate(self, session_token: str | None) -> User:
        if not session_token:
            raise AuthenticationRequired("Authentication required")

        statement = (
            select(User)
            .join(AuthSession, AuthSession.user_id == User.id)
            .where(
                AuthSession.token_hash == self._hash_token(session_token),
                AuthSession.expires_at > datetime.now(UTC),
            )
        )

        async with self._database.session() as database_session:
            user = await database_session.scalar(statement)

        if user is None:
            raise AuthenticationRequired("Authentication required")
        return user

    async def logout(self, session_token: str | None) -> None:
        if not session_token:
            return

        statement = delete(AuthSession).where(
            AuthSession.token_hash == self._hash_token(session_token)
        )
        async with self._database.session() as database_session:
            async with database_session.begin():
                await database_session.execute(statement)

    @staticmethod
    async def _upsert_user(
        database_session: AsyncSession,
        identity: GoogleIdentity,
    ) -> User:
        statement = (
            insert(User)
            .values(
                auth_provider="google",
                provider_subject=identity.subject,
                email=identity.email,
                display_name=identity.display_name,
                avatar_url=identity.avatar_url,
            )
            .on_conflict_do_update(
                constraint="uq_users_auth_provider",
                set_={
                    "email": identity.email,
                    "display_name": identity.display_name,
                    "avatar_url": identity.avatar_url,
                    "updated_at": datetime.now(UTC),
                },
            )
            .returning(User)
        )
        result = await database_session.execute(statement)
        return result.scalar_one()

    @staticmethod
    def _hash_token(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()
