from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, cast

from google.auth.exceptions import GoogleAuthError
from google.auth.transport import requests
from google.oauth2 import id_token


class InvalidGoogleCredential(ValueError):
    """Raised when Google cannot verify the supplied ID credential."""


@dataclass(frozen=True, slots=True)
class GoogleIdentity:
    subject: str
    email: str
    display_name: str
    avatar_url: str | None


class GoogleTokenVerifier:
    def __init__(self, client_id: str) -> None:
        self._client_id = client_id

    async def verify(self, credential: str) -> GoogleIdentity:
        """Verify Google's signature and claims outside the event loop."""

        try:
            transport = requests.Request()  # type: ignore[no-untyped-call]
            claims = await asyncio.to_thread(
                id_token.verify_oauth2_token,
                credential,
                transport,
                self._client_id,
            )
        except (GoogleAuthError, ValueError) as exc:
            raise InvalidGoogleCredential("Invalid Google credential") from exc

        return self._build_identity(cast(dict[str, Any], claims))

    @staticmethod
    def _build_identity(claims: dict[str, Any]) -> GoogleIdentity:
        subject = claims.get("sub")
        email = claims.get("email")
        display_name = claims.get("name")

        if claims.get("email_verified") is not True:
            raise InvalidGoogleCredential("Google email is not verified")

        if not isinstance(subject, str) or not subject:
            raise InvalidGoogleCredential("Google credential is missing a subject")

        if not isinstance(email, str) or not email:
            raise InvalidGoogleCredential("Google credential is missing an email")

        picture = claims.get("picture")

        return GoogleIdentity(
            subject=subject,
            email=email.lower(),
            display_name=(
                display_name
                if isinstance(display_name, str) and display_name
                else email
            ),
            avatar_url=picture if isinstance(picture, str) else None,
        )
