from fastapi.testclient import TestClient
from pathlib import Path


def test_web_console_compatibility_import():
    import lakejob.app.console as web_console

    assert web_console.app is not None


def test_create_app_returns_application():
    from lakejob.app.web import create_app

    app = create_app()
    assert app.title == "LakeJob Web Console"


def test_health_returns_200():
    from lakejob.app.web import create_app

    response = TestClient(create_app()).get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_dashboard_returns_safe_response():
    from lakejob.app.web import create_app

    response = TestClient(create_app()).get("/")
    assert response.status_code == 200


def test_logs_returns_safe_response(monkeypatch):
    from lakejob.app.web import create_app
    from lakejob.app.routes import logs

    monkeypatch.setattr(logs, "fetch_dicts", lambda sql, params=(): [])
    response = TestClient(create_app()).get("/logs")
    assert response.status_code == 200


def test_match_analysis_returns_safe_response(monkeypatch):
    from lakejob.app.web import create_app
    from lakejob.app.routes import logs

    monkeypatch.setattr(logs, "fetch_one", lambda sql, params=(): None)
    response = TestClient(create_app()).get("/match-analysis/test-log")
    assert response.status_code == 200


def test_config_returns_safe_response(monkeypatch):
    from lakejob.app.web import create_app
    from lakejob.app.routes import settings

    monkeypatch.setattr(settings, "load_real_run_config", lambda: {})
    response = TestClient(create_app()).get("/config")
    assert response.status_code == 200


def test_settings_returns_safe_response():
    from lakejob.app.web import create_app

    response = TestClient(create_app()).get("/ai-settings")
    assert response.status_code == 200


def test_jobs_returns_safe_response():
    from lakejob.app.web import create_app

    response = TestClient(create_app()).get("/jobs")
    assert response.status_code == 200


def test_candidates_returns_safe_response():
    from lakejob.app.web import create_app

    response = TestClient(create_app()).get("/candidates")
    assert response.status_code == 200


def test_talent_pool_returns_safe_response():
    from lakejob.app.web import create_app

    response = TestClient(create_app()).get("/talent-pool")
    assert response.status_code == 200


def test_profiles_returns_safe_response():
    from lakejob.app.web import create_app

    response = TestClient(create_app()).get("/profiles")
    assert response.status_code == 200


def test_messages_returns_safe_response(monkeypatch):
    from lakejob.app.web import create_app
    from lakejob.app.routes import messages

    monkeypatch.setattr(messages, "list_message_conversations", lambda filters: [])
    response = TestClient(create_app()).get("/messages")
    assert response.status_code == 200


def test_message_drafts_remain_draft_only(monkeypatch):
    from lakejob.app.web import create_app
    from lakejob.app.routes import messages

    monkeypatch.setattr(
        messages,
        "list_message_drafts",
        lambda: [
            {
                "draft_id": "draft-1",
                "draft_type": "recruiter",
                "target_name": "Test Candidate",
                "summary": "Safe draft preview",
                "ai_provider": "mock",
                "status": "draft",
                "created_at": "2026-06-11",
            }
        ],
    )
    response = TestClient(create_app()).get("/message-drafts")
    assert response.status_code == 200
    assert '>draft</td>' in response.text
    assert '>sent</td>' not in response.text


def test_conversation_detail_returns_safe_response(monkeypatch):
    from lakejob.app.web import create_app
    from lakejob.app.routes import messages

    monkeypatch.setattr(messages, "get_message_conversation_detail", lambda conversation_id: None)
    response = TestClient(create_app()).get("/messages/conversation-1")
    assert response.status_code == 200


def test_job_flow_returns_safe_response(monkeypatch):
    from lakejob.app.web import create_app
    from lakejob.app.routes import flows

    monkeypatch.setattr(flows, "load_jobseeker_profile_for_flow", lambda: {})
    response = TestClient(create_app()).get("/job")
    assert response.status_code == 200


def test_recruit_flow_returns_safe_response(monkeypatch):
    from lakejob.app.web import create_app
    from lakejob.app.routes import flows

    monkeypatch.setattr(flows, "load_recruit_profile", lambda: {})
    response = TestClient(create_app()).get("/recruit")
    assert response.status_code == 200


def test_auth_center_returns_status_without_login(monkeypatch):
    from lakejob.app.web import create_app
    from lakejob.app.routes import auth

    monkeypatch.setattr(auth, "get_auth_center_status", lambda: {"status": "not_authenticated"})
    response = TestClient(create_app()).get("/auth-center")
    assert response.status_code == 200


def test_scheduler_returns_message_draft_status(monkeypatch):
    from lakejob.app.web import create_app
    from lakejob.app.routes import scheduler

    monkeypatch.setattr(
        scheduler,
        "load_scheduler_config",
        lambda: {"message_draft": {"enabled": False, "cron": "09:15", "dry_run": True, "message_limit": 1}},
    )
    response = TestClient(create_app()).get("/scheduler")
    assert response.status_code == 200
    assert "message_draft" in response.text
    assert "send_message" not in response.text


def test_local_control_returns_safe_status(monkeypatch):
    from lakejob.app.web import create_app
    from lakejob.app.routes import local_control

    monkeypatch.setattr(
        local_control,
        "load_local_control_config",
        lambda: {
            "jobradar": {"enabled": False},
            "recruitradar": {"enabled": False},
            "system": {"scheduler_enabled": False},
        },
    )
    monkeypatch.setattr(local_control, "resume_center_status", lambda: {})
    monkeypatch.setattr(local_control, "local_system_status", lambda: {})
    response = TestClient(create_app()).get("/control")
    assert response.status_code == 200


def test_admin_read_only_pages_return_safe_status(monkeypatch):
    from lakejob.app.web import create_app
    from lakejob.app.routes import admin

    identity = {"user_id": "test-user", "organization_id": "test-org", "role": "platform_admin"}
    monkeypatch.setattr(admin, "_require_admin", lambda request, platform_only=False: identity)
    monkeypatch.setattr(admin, "_rows", lambda sql, params=(): [])
    client = TestClient(create_app())

    for path in ("/admin/users", "/admin/plans", "/admin/quotas", "/admin/task-runs", "/admin/audit-logs"):
        response = client.get(path)
        assert response.status_code == 200, path


def test_legacy_routes_module_removed(project_root: Path):
    assert not (project_root / "lakejob" / "app" / "routes" / "legacy.py").exists()

    app_source = (project_root / "lakejob" / "app" / "web.py").read_text(encoding="utf-8")
    assert "legacy_router" not in app_source
    assert "web.routes.legacy" not in app_source


def test_route_modules_no_longer_import_legacy_helpers(project_root: Path):
    offenders = []
    for path in (project_root / "web").rglob("*.py"):
        if path.name == "legacy.py" or "__pycache__" in path.parts:
            continue
        source = path.read_text(encoding="utf-8")
        if "web.routes.legacy" in source:
            offenders.append(str(path.relative_to(project_root)))
    assert offenders == []


def test_admin_mutation_routes_remain_in_admin_skill(project_root: Path):
    source = (project_root / "lakejob" / "app" / "admin.py").read_text(encoding="utf-8")

    assert '@router.post("/plans/{plan_id}")' in source
    assert '@router.post("/quotas/{quota_id}")' in source




def test_browser_agent_page_returns_safe_response():
    from lakejob.app.web import create_app

    response = TestClient(create_app()).get("/browser")
    assert response.status_code == 200
    assert "Browser Agent" in response.text


def test_browser_launch_post_redirects_without_real_browser(monkeypatch):
    from lakejob.infrastructure.browser.browser_launcher import BrowserLaunchResult
    from lakejob.app.web import create_app
    from lakejob.app.routes import browser

    monkeypatch.setattr(
        browser,
        "launch_boss_browser",
        lambda: BrowserLaunchResult(
            ok=True,
            url="https://www.zhipin.com/",
            message="mock launched",
            launched_at="2026-06-12T00:00:00+00:00",
        ),
    )
    response = TestClient(create_app()).post("/browser/launch", follow_redirects=False)
    assert response.status_code in {302, 303, 307}
    assert response.headers["location"].startswith("/browser")


def test_browser_route_file_does_not_import_legacy(project_root: Path):
    source = (project_root / "lakejob" / "app" / "routes" / "browser.py").read_text(encoding="utf-8")
    assert "web.routes.legacy" not in source
    assert "legacy import" not in source



def test_browser_agent_page_shows_session_status():
    from lakejob.app.web import create_app

    response = TestClient(create_app()).get("/browser")
    assert response.status_code == 200
    assert "Browser Session" in response.text
    assert "launcher_only" in response.text
    assert "not_integrated" in response.text


def test_browser_session_status_stub_contract():
    from lakejob.infrastructure.browser.browser_session import get_browser_session_status

    status = get_browser_session_status()
    data = status.to_dict()
    assert data["phase"] == "Phase 22A"
    assert data["mode"] == "launcher_only"
    assert data["launcher_available"] is True
    assert data["login_detection"] == "not_integrated"
    assert data["auto_search"] == "not_integrated"
    assert data["auto_apply"] == "not_integrated"
    assert data["auto_greeting"] == "not_integrated"



def test_browser_runtime_status_endpoint_returns_stub():
    from lakejob.app.web import create_app

    response = TestClient(create_app()).get("/browser/runtime/status")
    assert response.status_code == 200
    data = response.json()
    assert data["phase"] == "Phase 23A"
    assert data["mode"] == "playwright_runtime"
    assert data["is_running"] is False


def test_browser_runtime_start_post_redirects_without_real_browser(monkeypatch):
    from lakejob.infrastructure.browser.browser_runtime import BrowserRuntimeStatus
    from lakejob.app.web import create_app
    from lakejob.app.routes import browser

    fake_status = BrowserRuntimeStatus(
        phase="Phase 23A",
        mode="playwright_runtime",
        runtime_available=True,
        is_running=True,
        url="https://www.zhipin.com/",
        title="mock title",
        message="mock runtime started",
        updated_at="2026-06-12T00:00:00+00:00",
    )
    monkeypatch.setattr(browser, "start_boss_runtime_browser", lambda: fake_status)

    response = TestClient(create_app()).post("/browser/runtime/start", follow_redirects=False)
    assert response.status_code in {302, 303, 307}
    assert response.headers["location"].startswith("/browser")


def test_browser_runtime_stop_post_redirects_without_real_browser(monkeypatch):
    from lakejob.infrastructure.browser.browser_runtime import BrowserRuntimeStatus
    from lakejob.app.web import create_app
    from lakejob.app.routes import browser

    fake_status = BrowserRuntimeStatus(
        phase="Phase 23A",
        mode="playwright_runtime",
        runtime_available=True,
        is_running=False,
        url="",
        title="",
        message="mock runtime stopped",
        updated_at="2026-06-12T00:00:00+00:00",
    )
    monkeypatch.setattr(browser, "stop_boss_runtime_browser", lambda: fake_status)

    response = TestClient(create_app()).post("/browser/runtime/stop", follow_redirects=False)
    assert response.status_code in {302, 303, 307}
    assert response.headers["location"].startswith("/browser")
