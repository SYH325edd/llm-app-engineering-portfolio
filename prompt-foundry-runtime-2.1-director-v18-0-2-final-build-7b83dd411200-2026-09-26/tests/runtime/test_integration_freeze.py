from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import create_app
from app.store import RunStore
from runtime.checkpoints import CheckpointStore
from tests.runtime.test_runtime20_foundations import TwoShotModel


def test_runtime21_full_chain_is_strictly_ordered_and_produces_three_prompt_classes(tmp_path):
    app = create_app(
        model=TwoShotModel(),
        store=RunStore(tmp_path / "runs"),
        checkpoint_store=CheckpointStore(tmp_path / "checkpoints"),
        sync_runs=True,
    )
    client = TestClient(app)
    run = client.post(
        "/api/runs",
        json={"title": "Integration Freeze", "source_text": "阿宁站在窗边，手里拿着信封。阿宁转身。"},
    ).json()

    assert run["status"] == "completed"
    assert run["runtime_version"] == "2.1"
    assert run["framework_version"] == "1.3-frozen"

    unit_order = list(run["units"])
    expected = [
        "story_bible",
        "scene_plan",
        "script:SC001",
        "storyboard:SC001",
        "pvb:char_001",
        "psb:scene_001",
        "style_guide",
        "director:SH001",
        "director:SH002",
        "state_shotspec",
        "compile",
        "compile:assets",
    ]
    # compile:assets is an explicit deterministic sub-unit started by compile.
    for unit_id in expected:
        assert unit_id in unit_order
    assert unit_order.index("style_guide") < unit_order.index("director:SH001")
    assert unit_order.index("director:SH002") < unit_order.index("state_shotspec")
    assert unit_order.index("state_shotspec") < unit_order.index("compile")
    assert unit_order.index("style_guide") < unit_order.index("compile:assets")
    assert unit_order.index("compile:assets") < unit_order.index("director:SH001")
    assert unit_order.index("state_shotspec") < unit_order.index("compile")

    artifacts = run["artifacts"]
    compiled = artifacts["compiled_project"]
    assert len(compiled["character_prompts"]) == 1
    assert len(compiled["scene_prompts"]) == 1
    assert len(compiled["shot_prompts"]) == 2
    assert artifacts["static_evaluation"]["passed"] is True
    assert artifacts["production_lock_log"]["policy"] == "runtime_auto_production_lock.v1"
