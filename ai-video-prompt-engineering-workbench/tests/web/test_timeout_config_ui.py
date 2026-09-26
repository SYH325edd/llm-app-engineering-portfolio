from pathlib import Path

WEB = Path(__file__).resolve().parents[2] / "apps" / "web"


def test_model_config_exposes_timeout_and_does_not_hardcode_120():
    html = (WEB / "index.html").read_text(encoding="utf-8")
    js = (WEB / "app.js").read_text(encoding="utf-8")
    assert 'id="arkTimeoutInput"' in html
    assert "timeout_seconds: Number($('arkTimeoutInput').value)" in js
    assert "timeout_seconds: 120" not in js

def test_model_config_exposes_max_completion_tokens_field():
    html = Path("apps/web/index.html").read_text(encoding="utf-8")
    js = Path("apps/web/app.js").read_text(encoding="utf-8")
    assert 'id="arkMaxTokensInput"' in html
    assert "max_completion_tokens" in js
