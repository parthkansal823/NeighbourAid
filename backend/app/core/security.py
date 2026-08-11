"""Password hashing and JWT issue/verify.

Uses PyJWT rather than python-jose. python-jose 3.3.0 was pinned here with
five known CVEs, and it pulls in `ecdsa`, which carries a timing-attack
advisory (CVE-2024-23342) its maintainers have stated will not be fixed —
there is no patched version to upgrade to. PyJWT delegates crypto to
`cryptography` instead, so that dependency disappears entirely.
"""

from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from bson import ObjectId
from jwt import PyJWTError
from fastapi import HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from .config import settings

bearer_scheme = HTTPBearer()

_BCRYPT_MAX = 72


def _clip(password: str) -> bytes:
    return password.encode("utf-8")[:_BCRYPT_MAX]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_clip(password), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_clip(plain), hashed.encode("utf-8"))
    except ValueError:
        return False


def create_token(data: dict) -> str:
    payload = data.copy()
    payload["exp"] = datetime.now(timezone.utc) + timedelta(
        minutes=settings.JWT_EXPIRE_MINUTES
    )
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )


def decode_token_safe(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except PyJWTError:
        return None


async def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict:
    payload = decode_token(creds.credentials)
    # Every route turns `sub` into an ObjectId to query Mongo. Validating it
    # once here means a token carrying a malformed subject is rejected as
    # 401 instead of raising InvalidId deep inside a handler and surfacing
    # as a 500.
    if not ObjectId.is_valid(payload.get("sub") or ""):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )
    return payload


def require_role(role: str):
    async def _dep(payload: dict = Depends(get_current_user)) -> dict:
        if payload.get("role") != role:
            raise HTTPException(status_code=403, detail=f"Requires {role} role")
        return payload

    return _dep
