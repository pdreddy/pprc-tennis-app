"""Request-size and write rate limits (in-process; use a shared store if running several workers)."""
import hashlib
import time
from collections import defaultdict, deque

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


class RequestLimitMiddleware:
    """Each write is counted against its caller's credential and, more loosely, against the network address.

    The address bucket (10x the limit) stops a caller minting fresh tokens or headers to dodge the per-credential
    bucket. X-Forwarded-For is only believed when `trust_proxy` is set, and then only its last entry (the one the
    trusted proxy appended)."""

    ADDRESS_FACTOR = 10
    SWEEP_EVERY = 1000

    def __init__(self, app: ASGIApp, writes_per_minute: int, max_body_bytes: int, trust_proxy: bool = False) -> None:
        self.app = app
        self.writes_per_minute = writes_per_minute
        self.max_body_bytes = max_body_bytes
        self.trust_proxy = trust_proxy
        self.hits: dict[str, deque[float]] = defaultdict(deque)
        self.calls = 0

    def keys(self, scope: Scope) -> list[tuple[str, int]]:
        """(bucket key, limit) pairs for this request."""
        headers = dict(scope.get("headers") or [])
        client = scope.get("client")
        address = client[0] if client else "unknown"
        if self.trust_proxy and headers.get(b"x-forwarded-for"):
            address = headers[b"x-forwarded-for"].decode(errors="ignore").split(",")[-1].strip() or address
        keys = [(f"ip:{address}", self.writes_per_minute * self.ADDRESS_FACTOR)]
        for name in (b"authorization", b"x-pprc-user"):
            if headers.get(name):
                keys.append((f"id:{hashlib.sha256(headers[name]).hexdigest()}", self.writes_per_minute))
                break
        return keys

    def sweep(self, now: float) -> None:
        """Drop buckets with no hit in the last minute so memory stays bounded."""
        for key in [k for k, window in self.hits.items() if not window or now - window[-1] > 60]:
            del self.hits[key]

    def over_limit(self, keys: list[tuple[str, int]]) -> bool:
        now = time.monotonic()
        self.calls += 1
        if self.calls % self.SWEEP_EVERY == 0:
            self.sweep(now)
        for key, limit in keys:
            window = self.hits[key]
            while window and now - window[0] > 60:
                window.popleft()
            if len(window) >= limit:
                return True
        for key, _ in keys:
            self.hits[key].append(now)
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
        if self.writes_per_minute and self.over_limit(self.keys(scope)):
            await JSONResponse({"detail": "Too many changes in a short time. Wait a minute and try again."}, status_code=429)(scope, receive, send)
            return
        await self.app(scope, receive, send)
