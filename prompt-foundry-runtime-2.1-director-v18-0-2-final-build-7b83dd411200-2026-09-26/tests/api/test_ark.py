import pytest

from app.ark import ArkClient, ArkConfigurationError, extract_json_object


def test_extract_json_object_accepts_plain_json():
    assert extract_json_object('{"ok": true}') == {"ok": True}


def test_extract_json_object_accepts_fenced_json():
    text = '```json\n{"stage": "story_bible"}\n```'
    assert extract_json_object(text) == {"stage": "story_bible"}


def test_ark_client_requires_key_and_model(monkeypatch):
    monkeypatch.delenv("ARK_API_KEY", raising=False)
    monkeypatch.delenv("ARK_MODEL", raising=False)
    with pytest.raises(ArkConfigurationError):
        ArkClient.from_env()


def test_ark_client_default_timeout_is_300():
    assert ArkClient(api_key="k", model="m").timeout_seconds == 300.0
