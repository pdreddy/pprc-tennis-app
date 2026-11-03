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


def test_environment_defaults_to_production_without_dev_header():
    assert make().allow_development_header is False
    assert make(pprc_environment="development").allow_development_header is True


def test_bootstrap_schema_defaults_to_development_only():
    assert make().bootstrap_schema is False
    assert make(pprc_environment="development").bootstrap_schema is True
    assert make(pprc_bootstrap_schema=True).bootstrap_schema is True


def test_app_origin_has_no_trailing_slash(monkeypatch):
    from app import config

    monkeypatch.setattr(config, "get_settings", lambda: make(pprc_app_origin="https://x.example/"))
    assert config.app_origin() == "https://x.example"
