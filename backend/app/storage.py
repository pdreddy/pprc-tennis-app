"""Emergent object storage for player photos. All reads go through the API (no public bucket URLs)."""
import os

import requests

_key: str | None = None


def _url() -> str:
    base = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
    return base.rstrip("/") + "/objstore/api/v1/storage"


def _storage_key(force: bool = False) -> str:
    global _key
    if _key and not force:
        return _key
    response = requests.post(f"{_url()}/init", json={"emergent_key": os.environ["EMERGENT_LLM_KEY"]}, timeout=30)
    response.raise_for_status()
    _key = response.json()["storage_key"]
    return _key


def _call(method: str, path: str, **kwargs) -> requests.Response:
    for force in (False, True):
        response = requests.request(method, f"{_url()}/objects/{path}", headers={"X-Storage-Key": _storage_key(force), **kwargs.pop("headers", {})}, **kwargs)
        if response.status_code != 404 or force:
            response.raise_for_status()
            return response
    raise RuntimeError("unreachable")


def put_object(path: str, data: bytes, content_type: str) -> str:
    return _call("PUT", path, data=data, headers={"Content-Type": content_type}, timeout=120).json()["path"]


def get_object(path: str) -> tuple[bytes, str]:
    response = _call("GET", path, timeout=60)
    return response.content, response.headers.get("Content-Type", "application/octet-stream")
