from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, Field


class GoogleLoginRequest(BaseModel):
    credential: str = Field(min_length=1)


class AuthenticatedUser(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    display_name: str
    avatar_url: str | None


class LoginResponse(BaseModel):
    user: AuthenticatedUser
