from scripts import serve


class _Response:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return ('{"status":"ok","version":"2.1.0","framework":"1.3-frozen","build_id":"%s"}' % serve.BUILD_ID).encode('utf-8')


def test_browser_opens_only_after_health_endpoint_is_ready(monkeypatch):
    opened = []

    def fake_urlopen(url, timeout=0.8):
        assert url == "http://127.0.0.1:8000/api/health"
        return _Response()

    monkeypatch.setattr(serve.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(serve, "open_browser_url", lambda url: opened.append(url) or True)

    serve.open_browser_when_ready("http://127.0.0.1:8000", timeout_seconds=0.1)
    assert opened == ["http://127.0.0.1:8000"]


def test_windows_browser_open_prefers_os_startfile(monkeypatch):
    opened = []
    monkeypatch.setattr(serve.os, "name", "nt")
    monkeypatch.setattr(serve.os, "startfile", lambda url: opened.append(("startfile", url)), raising=False)
    monkeypatch.setattr(serve.webbrowser, "open", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("webbrowser fallback should not run")))

    assert serve.open_browser_url("http://127.0.0.1:8000") is True
    assert opened == [("startfile", "http://127.0.0.1:8000")]


def test_windows_browser_open_falls_back_when_startfile_fails(monkeypatch):
    opened = []
    monkeypatch.setattr(serve.os, "name", "nt")

    def fail_startfile(url):
        raise OSError("no shell association")

    monkeypatch.setattr(serve.os, "startfile", fail_startfile, raising=False)
    monkeypatch.setattr(serve.webbrowser, "open", lambda url, new=0: opened.append(("webbrowser", url, new)) or True)

    assert serve.open_browser_url("http://127.0.0.1:8000") is True
    assert opened == [("webbrowser", "http://127.0.0.1:8000", 2)]


def test_select_startup_port_skips_port_serving_different_version(monkeypatch):
    monkeypatch.setattr(serve, "APP_VERSION", "2.1.0")
    monkeypatch.setattr(serve, "_is_port_available", lambda host, port: port == 8001)
    monkeypatch.setattr(serve, "_running_prompt_foundry_identity", lambda base_url: {"version":"1.3.7","framework":"1.3-frozen","build_id":"old"} if base_url.endswith(":8000") else None)
    port, reuse_existing = serve.select_startup_port("127.0.0.1", 8000)
    assert port == 8001
    assert reuse_existing is False


def test_select_startup_port_reuses_same_version_instance(monkeypatch):
    monkeypatch.setattr(serve, "APP_VERSION", "2.1.0")
    monkeypatch.setattr(serve, "_is_port_available", lambda host, port: False)
    monkeypatch.setattr(serve, "_running_prompt_foundry_identity", lambda base_url: {"version":"2.1.0","framework":"1.3-frozen","build_id":serve.BUILD_ID})
    port, reuse_existing = serve.select_startup_port("127.0.0.1", 8000)
    assert port == 8000
    assert reuse_existing is True


def test_select_startup_port_does_not_reuse_same_version_with_different_build(monkeypatch):
    monkeypatch.setattr(serve, "APP_VERSION", "2.1.0")
    monkeypatch.setattr(serve, "BUILD_ID", "new-build")
    monkeypatch.setattr(serve, "_is_port_available", lambda host, port: port == 8001)
    monkeypatch.setattr(
        serve,
        "_running_prompt_foundry_identity",
        lambda base_url: {"version": "2.1.0", "framework": "1.3-frozen", "build_id": "old-build"},
    )
    port, reuse_existing = serve.select_startup_port("127.0.0.1", 8000)
    assert port == 8001
    assert reuse_existing is False


def test_select_startup_port_reuses_only_exact_same_build(monkeypatch):
    monkeypatch.setattr(serve, "APP_VERSION", "2.1.0")
    monkeypatch.setattr(serve, "BUILD_ID", "same-build")
    monkeypatch.setattr(serve, "_is_port_available", lambda host, port: False)
    monkeypatch.setattr(
        serve,
        "_running_prompt_foundry_identity",
        lambda base_url: {"version": "2.1.0", "framework": "1.3-frozen", "build_id": "same-build"},
    )
    port, reuse_existing = serve.select_startup_port("127.0.0.1", 8000)
    assert port == 8000
    assert reuse_existing is True
