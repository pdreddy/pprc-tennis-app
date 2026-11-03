"""DB-free tests for the write rate limiter."""
from app.limits import RequestLimitMiddleware


def scope(auth=b"", ip="1.1.1.1", xff=b""):
    headers = [(b"authorization", auth)] if auth else []
    if xff:
        headers.append((b"x-forwarded-for", xff))
    return {"headers": headers, "client": (ip, 1)}


def limiter(limit=3, **kw):
    return RequestLimitMiddleware(None, writes_per_minute=limit, max_body_bytes=1000, **kw)


def hit(mw, sc):
    return mw.over_limit(mw.keys(sc))


def test_same_credential_is_limited_and_others_are_not():
    mw = limiter()
    assert [hit(mw, scope(b"Bearer a")) for _ in range(4)] == [False, False, False, True]
    assert hit(mw, scope(b"Bearer b")) is False


def test_tokens_sharing_a_suffix_do_not_share_a_bucket():
    mw = limiter(1)
    assert hit(mw, scope(b"Bearer x" + b"s" * 70)) is False
    assert hit(mw, scope(b"Bearer y" + b"s" * 70)) is False


def test_spoofed_forwarded_for_is_ignored_unless_proxy_trusted():
    mw = limiter(1)  # address bucket allows 10
    results = [hit(mw, scope(xff=f"9.9.9.{i}".encode())) for i in range(12)]
    assert results[:10] == [False] * 10 and results[10] is True
    trusted = limiter(1, trust_proxy=True)
    assert all(hit(trusted, scope(xff=f"9.9.9.{i}".encode())) is False for i in range(12))


def test_fresh_tokens_cannot_escape_the_address_limit():
    mw = limiter(1)
    results = [hit(mw, scope(f"Bearer t{i}".encode())) for i in range(12)]
    assert results[10] is True


def test_idle_buckets_are_swept():
    mw = limiter()
    hit(mw, scope(b"Bearer a"))
    mw.sweep(10**9)
    assert not mw.hits
