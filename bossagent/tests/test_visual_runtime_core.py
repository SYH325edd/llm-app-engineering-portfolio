from pathlib import Path

from lakejob.infrastructure.vision.runtime import ActionType, PageState, SimulatedScreenDriver, VisualAction, VisualActionRunner
from lakejob.infrastructure.vision.runtime.models import BoundingBox


def test_visual_runner_executes_actions_and_verifies_before_after_evidence(tmp_path: Path):
    driver = SimulatedScreenDriver()
    runner = VisualActionRunner(driver, evidence_dir=tmp_path / "evidence")
    result = runner.run(
        [
            VisualAction(
                action_id="A-1",
                action_type=ActionType.click,
                target_bbox=BoundingBox(x=120, y=80, width=100, height=36),
                success_signals=["已点击"],
            ),
            VisualAction(
                action_id="A-2",
                action_type=ActionType.type_text,
                input_text="AI设计",
                success_signals=["AI设计", "岗位结果"],
            ),
        ]
    )

    assert result.status == "completed"
    assert result.completed_actions == ["A-1", "A-2"]
    assert all(item.verification_passed for item in result.evidence)
    assert all(item.pre_snapshot is not None and item.post_snapshot is not None for item in result.evidence)


def test_visual_runner_pauses_on_captcha_without_action(tmp_path: Path):
    driver = SimulatedScreenDriver(initial_text="请完成验证码", state=PageState.captcha)
    runner = VisualActionRunner(driver, evidence_dir=tmp_path / "evidence")
    result = runner.run(
        [
            VisualAction(
                action_id="A-CAPTCHA",
                action_type=ActionType.click,
                target_bbox=BoundingBox(x=10, y=10, width=10, height=10),
            )
        ]
    )

    assert result.status == "needs_human"
    assert "CAPTCHA" in result.paused_reason
    assert driver.click_count == 0


def test_real_mode_requires_authorization_target_confirmation_and_daily_limit(tmp_path: Path):
    driver = SimulatedScreenDriver()
    runner = VisualActionRunner(
        driver,
        evidence_dir=tmp_path / "evidence",
        real_mode=True,
        user_authorized=False,
        daily_limit=1,
    )
    result = runner.run(
        [
            VisualAction(
                action_id="A-REAL",
                action_type=ActionType.click,
                target_bbox=BoundingBox(x=10, y=10, width=10, height=10),
                semantic_action="send_message",
                metadata={"target_confirmed": True},
            )
        ]
    )
    assert result.status == "needs_human"
    assert "授权" in result.paused_reason
    assert driver.click_count == 0
