from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / "apps" / "web"


def test_web_exposes_local_model_configuration_form():
    html = (WEB / "index.html").read_text(encoding="utf-8")
    js = (WEB / "app.js").read_text(encoding="utf-8")
    assert 'id="arkApiKeyInput"' in html
    assert 'type="password"' in html
    assert 'id="arkModelInput"' in html
    assert 'id="arkBaseUrlInput"' in html
    assert "method: 'PUT'" in js
    assert "'/api/config'" in js


def test_windows_launcher_requests_browser_auto_open():
    batch = (ROOT / "start_windows.bat").read_text(encoding="utf-8")
    start = (ROOT / "start.bat").read_text(encoding="utf-8")
    serve = (ROOT / "scripts" / "serve.py").read_text(encoding="utf-8")
    assert "--open-browser" in batch
    assert "start_windows.bat" in start
    assert "os.startfile" not in serve  # accessed safely with getattr for non-Windows test environments
    assert 'getattr(os, "startfile"' in serve
    assert "webbrowser.open" in serve
    assert '"cmd", "/c", "start"' in serve
    assert "api/health" in serve
    assert "pause" in batch.lower()
    assert "SERVE_EXIT" in batch
