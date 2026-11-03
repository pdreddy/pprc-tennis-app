"""Request-size and write rate limits (in-process; use a shared store if running several workers)."""
import time
from collections import defaultdict, deque

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


class RequestLimitMiddleware:
    def __init__(self, app: ASGIApp, writes_per_minute: int, max_body_bytes: int) -> None:
        self.app = app
        self.writes_per_minute = writes_per_minute
        self.max_body_bytes = max_body_bytes
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def client_key(self, scope: Scope) -> str:
        headers = dict(scope.get("headers") or [])
        for name in (b"authorization", b"x-pprc-user", b"x-forwarded-for"):
            if headers.get(name):
                return headers[name].decode(errors="ignore")[-64:]
        client = scope.get("client")
        return client[0] if client else "unknown"

    def over_limit(self, key: str) -> bool:
        now = time.monotonic()
        window = self.hits[key]
        while window and now - window[0] > 60:
            window.popleft()
        if len(window) >= self.writes_per_minute:
            return True
        window.append(now)
        return False

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] not in WRITE_METHODS or scope["path"].endswith("/webhooks/stripe"):
            await self.app(scope, receive, send)
            return
        length = dict(scope.get("headers") or []).get(b"content-length")
        limit = max(self.max_body_bytes, 4_000_000) if scope["path"].endswith("/photo") else self.max_body_bytes
        if length and length.isdigit() and int(length) > limit:
            await JSONResponse({"detail": "Request body is too large"}, status_code=413)(scope, receive, send)
            return
        if self.writes_per_minute and self.over_limit(self.client_key(scope)):
            await JSONResponse({"detail": "Too many changes in a short time. Wait a minute and try again."}, status_code=429)(scope, receive, send)
            return
        await self.app(scope, receive, send)
