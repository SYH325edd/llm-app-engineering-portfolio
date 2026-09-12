from pathlib import Path

from fastapi.testclient import TestClient

from lakejob.orchestration.engine import SerialOrchestrationEngine
from lakejob.orchestration.store import OrchestrationStore


def test_orchestration_page_and_api_run_complete_closed_loop(monkeypatch, tmp_path: Path):
    from lakejob.app.web import create_app
    from lakejob.app.routes import orchestration

    engine = SerialOrchestrationEngine(store=OrchestrationStore(tmp_path / "runtime"))
    monkeypatch.setattr(orchestration, "_ENGINE", engine)
    client = TestClient(create_app())

    page = client.get("/orchestration")
    assert page.status_code == 200
    assert "五角色闭环作业系统" in page.text

    response = client.post(
        "/api/orchestration/tasks",
        json={
            "objective": "完成双端视觉招聘智能体五角色闭环验证",
            "task_type": "double_end_visual_agent",
            "business_domain": "shared",
            "priority": "P0",
            "risk_level": "medium",
            "automation_mode": "supervised",
            "scope_included": [],
            "scope_excluded": [],
            "inputs": [],
            "constraints": [],
            "prohibited_actions": [],
            "payload": {"keyword": "AI视频设计师"},
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "LOCKED"
    assert data["final_result"]["scores"]["overall"] >= 95
    assert data["final_result"]["lock"]["locked"] is True
