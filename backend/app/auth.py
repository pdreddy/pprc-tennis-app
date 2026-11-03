"""Authentication boundary: Emergent-managed (Clerk) sessions, Firebase ID tokens, or the local demo header."""
from dataclasses import dataclass

from fastapi import Header, HTTPException, status
from starlette.concurrency import run_in_threadpool

from .config import get_settings


@dataclass(frozen=True)
class Actor:
    user_id: str
    email: str | None = None
    name: str | None = None
    email_verified: bool = False


_clerk_users: dict[str, Actor] = {}


def _clerk_actor(token: str) -> Actor:
    """Emergent-managed (Clerk) session token -> Actor; profile looked up once per user and cached."""
    import requests

    try:
        from clerk_auth import verify_session_token
    except ModuleNotFoundError:
        from backend.clerk_auth import verify_session_token

    user_id = verify_session_token(token)["sub"]
    if user_id not in _clerk_users:
        try:
            response = requests.get(
                f"https://api.clerk.com/v1/users/{user_id}", timeout=10,
                headers={"Authorization": f"Bearer {get_settings().clerk_secret_key}", "User-Agent": "pprc-api"},
            )
        except requests.RequestException as exc:
            raise HTTPException(status_code=503, detail="Sign-in service is busy. Please try again in a moment.") from exc
        if not response.ok:
            raise HTTPException(status_code=503, detail="Sign-in service is busy. Please try again in a moment.")
        data = response.json()
        primary = next((e for e in data.get("email_addresses", []) if e["id"] == data.get("primary_email_address_id")), None)
        name = " ".join(part for part in (data.get("first_name"), data.get("last_name")) if part) or None
        _clerk_users[user_id] = Actor(
            user_id=user_id,
            email=primary["email_address"] if primary else None,
            name=name or (primary["email_address"].split("@")[0] if primary else None),
            email_verified=bool(primary and (primary.get("verification") or {}).get("status") == "verified"),
        )
    actor = _clerk_users[user_id]
    if not actor.email_verified:
        _clerk_users.pop(user_id)  # look again next time until the email is verified
    return actor


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
    """Accept Emergent-managed (Clerk) or Firebase bearer tokens; permit the demo header in local development only."""
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        provider = get_settings().auth_provider
        if provider == "clerk":
            return await run_in_threadpool(_clerk_actor, token)
        if provider == "firebase":
            return _verify_firebase_token(token)
        raise HTTPException(status_code=401, detail="Token verification is not configured")
    if get_settings().allow_development_header and x_pprc_user:
        return Actor(user_id=x_pprc_user, name=x_pprc_user)
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Sign in required",
    )
