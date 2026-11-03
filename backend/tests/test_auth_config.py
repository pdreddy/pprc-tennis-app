"""DB-free tests for how the bearer-token verifier is chosen."""
import pytest

from app.config import Settings


def make(**values) -> Settings:
    return Settings(_env_file=None, **values)


def test_auto_prefers_clerk_when_secret_set():
    assert make(clerk_secret_key="sk", firebase_project_id="p").auth_provider == "clerk"


def test_auto_falls_back_to_firebase_then_none():
    assert make(firebase_project_id="p").auth_provider == "firebase"
    assert make().auth_provider is None


def test_pinned_provider_ignores_other_credentials():
    assert make(pprc_auth_provider="firebase", clerk_secret_key="sk", firebase_project_id="p").auth_provider == "firebase"
    assert make(pprc_auth_provider="clerk", clerk_secret_key="sk", firebase_project_id="p").auth_provider == "clerk"


@pytest.mark.parametrize("values,message", [
    ({"pprc_auth_provider": "clerk"}, "CLERK_SECRET_KEY"),
    ({"pprc_auth_provider": "firebase"}, "FIREBASE_PROJECT_ID"),
])
def test_pinned_provider_without_credentials_is_an_error(values, message):
    assert message in make(**values).auth_config_error()


def test_valid_configs_have_no_error():
    assert make().auth_config_error() is None
    assert make(pprc_auth_provider="clerk", clerk_secret_key="sk").auth_config_error() is None
