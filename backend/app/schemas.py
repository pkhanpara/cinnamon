from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, BeforeValidator, ConfigDict, StringConstraints


def _normalize(v):
    # Runs before the pattern check (pydantic applies `pattern` before `to_lower`).
    return v.strip().lower() if isinstance(v, str) else v


Username = Annotated[
    str, BeforeValidator(_normalize), StringConstraints(pattern=r"^[a-z0-9_.-]{3,64}$")
]
Password = Annotated[str, StringConstraints(min_length=10, max_length=256)]
Platform = Annotated[
    str, BeforeValidator(_normalize), StringConstraints(pattern=r"^[a-z0-9_-]{2,32}$")
]
Nickname = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class Credentials(BaseModel):
    username: str
    password: str


class SetupRequest(BaseModel):
    username: Username
    password: Password


class UserCreate(SetupRequest):
    is_admin: bool = False


class UserUpdate(BaseModel):
    is_active: bool | None = None
    is_admin: bool | None = None
    password: Password | None = None


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    is_admin: bool
    is_active: bool


class AuthStatus(BaseModel):
    setup_required: bool


class AccountCreate(BaseModel):
    platform: Platform
    nickname: Nickname


class AccountUpdate(BaseModel):
    nickname: Nickname


class AccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    platform: str
    nickname: str
    created_at: datetime
