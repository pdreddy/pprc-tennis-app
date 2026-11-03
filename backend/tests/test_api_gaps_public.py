# Public-URL regression tests for KNOWN_GAPS backend fixes (clubs 409, limits 413/429, TRIACE PATCH sync, playoff seeds)
import os
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest

if os.environ.get("PPRC_PREVIEW_DEV_HEADER") != "1":
    pytest.skip("hosted-preview regression; the preview now uses real sign-in (set PPRC_PREVIEW_DEV_HEADER=1 only against a dev-header preview)", allow_module_level=True)
import requests


def _base():
    url = os.environ.get("REACT_APP_BACKEND_URL")
    if not url:
        with open("/app/frontend/.env") as fh:
            for line in fh:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    url = line.split("=", 1)[1].strip()
    return url.rstrip("/") + "/api"


BASE = _base()
CLUB = "82a25bc1-9def-58d4-bc37-4be4c1b8fd6d"
ADMIN = {"X-PPRC-User": "admin"}


def H(user):
    return {"X-PPRC-User": user}


# Public endpoints
def test_public_events_listed():
    r = requests.get(f"{BASE}/v1/public/clubs/pprc/events", timeout=20)
    assert r.status_code == 200
    events = r.json()
    names = {e["name"] for e in events}
    assert "TRIACE 2.0" in names and "PPRC Open Singles" in names
    assert all(e["status"] == "published" for e in events)


# Club slug uniqueness
def test_duplicate_club_slug_409():
    slug = f"test-{uuid.uuid4().hex[:10]}"
    user = f"tst_{uuid.uuid4().hex[:8]}"
    r1 = requests.post(f"{BASE}/v1/clubs", json={"slug": slug, "name": "TEST Club"}, headers=H(user), timeout=20)
    assert r1.status_code == 201, r1.text
    assert r1.json()["slug"] == slug
    r2 = requests.post(f"{BASE}/v1/clubs", json={"slug": slug, "name": "TEST Club 2"}, headers=H(user), timeout=20)
    assert r2.status_code == 409
    assert "slug" in r2.json()["detail"].lower()


def test_duplicate_existing_pprc_slug_409():
    r = requests.post(f"{BASE}/v1/clubs", json={"slug": "pprc", "name": "Dup"}, headers=H("admin"), timeout=20)
    assert r.status_code == 409


# Body size limit
def test_body_over_1mb_413():
    big = "x" * (1024 * 1024 + 100)
    r = requests.post(f"{BASE}/v1/clubs", json={"slug": "test-big", "name": big}, headers=H("tst_big"), timeout=60)
    assert r.status_code == 413, r.status_code
    assert "large" in r.json()["detail"].lower()


# Write rate limit (600/min in preview) -- key is per X-PPRC-User
def test_rate_limit_429_only_above_600():
    # Public ingress is too slow/limits concurrency to fit 600 writes in 60s, so hit the internal port.
    user = f"rl_{uuid.uuid4().hex[:8]}"
    url = f"{os.environ.get('API_BASE_URL', 'http://localhost:8001/api')}/v1/notifications/{uuid.uuid4()}/read"

    def hit(_):
        return requests.post(url, headers=H(user), timeout=30).status_code

    with ThreadPoolExecutor(max_workers=80) as ex:
        codes = list(ex.map(hit, range(600)))
    assert 429 not in codes, f"429 before 600: {codes.count(429)}"
    extra = [requests.post(url, headers=H(user), timeout=30).status_code for _ in range(3)]
    assert 429 in extra, extra


# TRIACE event PATCH syncs rules to every TRIACE division
@pytest.fixture(scope="module")
def triace_event():
    payload = {
        "event": {"name": "TEST_TRIACE sync", "starts_at": "2026-06-01T10:00:00Z", "capacity": 12, "rules": {"format": "team"}},
        "division": {"name": "TEST Div A", "format": "triace", "capacity": 6},
    }
    r = requests.post(f"{BASE}/v1/clubs/{CLUB}/triace-events", json=payload, headers=ADMIN, timeout=20)
    assert r.status_code == 201, r.text
    ev = r.json()
    r2 = requests.post(f"{BASE}/v1/events/{ev['id']}/divisions", json={"name": "TEST Div B", "format": "triace", "capacity": 6}, headers=ADMIN, timeout=20)
    assert r2.status_code == 201, r2.text
    return ev


def test_patch_triace_event_syncs_all_divisions(triace_event):
    eid = triace_event["id"]
    r = requests.patch(f"{BASE}/v1/events/{eid}", json={"rules": {"pointsPerWin": 2, "teamMaxRating": 19.0}, "audit_reason": "TEST sync rules"}, headers=ADMIN, timeout=20)
    assert r.status_code == 200, r.text
    assert r.json()["rules"]["pointsPerWin"] == 2
    divs = requests.get(f"{BASE}/v1/clubs/{CLUB}/divisions", headers=ADMIN, timeout=20).json()
    mine = [d for d in divs if d["event_id"] == eid]
    assert len(mine) == 2
    for d in mine:
        assert d["rules"].get("pointsPerWin") == 2, d
        assert float(d["rules"].get("teamMaxRating")) == 19.0, d


def test_playoff_seeds_endpoint(triace_event):
    divs = requests.get(f"{BASE}/v1/clubs/{CLUB}/divisions", headers=ADMIN, timeout=20).json()
    seeded = [d for d in divs if d["event_id"] == "cb8569af-9686-537f-a95c-78345bdaec3d"]
    assert seeded
    r = requests.get(f"{BASE}/v1/divisions/{seeded[0]['id']}/playoff-seeds", headers=ADMIN, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, list)
    for i, s in enumerate(data, start=1):
        assert s["seed"] == i and "eligible" in s and "team_name" in s


def test_playoff_seeds_404_unknown():
    r = requests.get(f"{BASE}/v1/divisions/{uuid.uuid4()}/playoff-seeds", headers=ADMIN, timeout=20)
    assert r.status_code == 404
