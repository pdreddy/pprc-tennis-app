"""Authentication boundary for Firebase now and Supabase-compatible JWTs later."""
from dataclasses import dataclass

from fastapi import Header, HTTPException, status

from .config import get_settings


@dataclass(frozen=True)
class Actor:
    user_id: str
    email: str | None = None
    name: str | None = None


def _verify_firebase_token(token: str) -> Actor:
    settings = get_settings()
    if not settings.firebase_project_id:
        raise HTTPException(status_code=401, detail="Firebase token verification is not configured")
    try:
        import firebase_admin
        from firebase_admin import auth

        if not firebase_admin._apps:
            firebase_admin.initialize_app(options={"projectId": settings.firebase_project_id})
        claims = auth.verify_id_token(token, check_revoked=True)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired Firebase token") from exc
    return Actor(user_id=claims["uid"], email=claims.get("email"), name=claims.get("name"))


async def current_actor(
    authorization: str | None = Header(default=None),
    x_pprc_user: str | None = Header(default=None),
) -> Actor:
    """Accept real Firebase bearer tokens; permit the explicit demo header locally only."""
    if authorization and authorization.lower().startswith("bearer "):
        return _verify_firebase_token(authorization.split(" ", 1)[1].strip())
    if get_settings().allow_development_header and x_pprc_user:
        return Actor(user_id=x_pprc_user, name=x_pprc_user)
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Use a Firebase Bearer token, or X-PPRC-User in local development only",
    )
