from pathlib import Path

from lakejob.orchestration import SerialOrchestrationEngine, TaskRequest
from lakejob.orchestration.public_view import public_task_payload
from lakejob.orchestration.store import OrchestrationStore


def test_public_view_hides_intermediate_role_outputs(tmp_path: Path):
    store = OrchestrationStore(tmp_path / "orchestration")
    engine = SerialOrchestrationEngine(store=store)
    record = engine.create_and_run(
        TaskRequest(
            objective="完成双端视觉招聘智能体的五角色严格串行闭环验证",
            task_type="double_end_visual_agent",
        )
    )

    payload = public_task_payload(record, store)

    assert payload["status"] == "LOCKED"
    assert payload["final_result"]["status"] == "COMPLETED_AND_LOCKED"
    assert payload["integrity"]["audit_chain_verified"] is True
    assert payload["integrity"]["lock_verified"] is True
    assert "manifest" not in payload
    assert "executor_outputs" not in payload
    assert "supervisor_outputs" not in payload
    assert "validator_outputs" not in payload
    assert "auditor_outputs" not in payload
    assert "rework_orders" not in payload
    assert {item["role_label"] for item in payload["workflow_log"] if item["role"] != "system"} == {
        "总指挥",
        "执行员",
        "监督员",
        "合验员",
        "终审审计员",
    }
