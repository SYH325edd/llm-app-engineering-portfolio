from __future__ import annotations

from runtime.consumption_lint import estimate_min_duration
from runtime.duration_calibration import (
    MIN_CALIBRATION_SAMPLES,
    build_calibration_report,
    build_duration_sample,
    extract_duration_features,
)


def _shot() -> dict:
    return {
        "shot_id": "SH001",
        "scene_id": "SC001",
        "duration": 6.0,
        "movement": "push_in",
        "dialogue": [{"character_id": "char_001", "line": "我回来拿钥匙。"}],
        "narration": ["他停了一秒，又走了。"],
        "director": {
            "reaction_target_refs": ["char_002"],
            "performance_actions": [
                {"character_ref": "char_001", "action": "把钥匙放到桌上"},
                {"character_ref": "char_002", "action": "抬眼看向他"},
            ],
        },
    }


def test_duration_calibration_extracts_features_without_changing_w003():
    shot = _shot()
    features = extract_duration_features(shot)
    assert features == {
        "dialogue_char_count": 6,
        "narration_char_count": 8,
        "speech_char_count": 14,
        "visible_action_count": 1,
        "reaction_count": 1,
        "transition_count": 2,
    }
    sample = build_duration_sample(shot, run_id="run_test", build_id="build_test")
    assert sample["current_w003_estimate_seconds"] == estimate_min_duration(shot)
    assert sample["overall_renderable"] is None


def test_duration_calibration_stays_collecting_below_real_sample_threshold():
    sample = build_duration_sample(_shot(), run_id="run_test")
    sample.update({
        "rendered_duration_seconds": 6.0,
        "speech_completed": True,
        "action_completed": True,
        "reaction_completed": True,
        "overall_renderable": True,
    })
    report = build_calibration_report([sample])
    assert report["status"] == "collecting"
    assert report["samples_needed"] == MIN_CALIBRATION_SAMPLES - 1
    assert report["candidate_calibration"] is None
    assert report["policy"]["automatic_w003_parameter_update"] is False


def test_duration_calibration_emits_candidate_only_after_threshold():
    samples = []
    for index in range(MIN_CALIBRATION_SAMPLES):
        shot = _shot()
        shot["shot_id"] = f"SH{index + 1:03d}"
        shot["duration"] = 4.0 if index % 3 == 0 else 8.0
        sample = build_duration_sample(shot, run_id="run_threshold")
        sample.update({
            "rendered_duration_seconds": shot["duration"],
            "speech_completed": shot["duration"] >= 6.0,
            "action_completed": True,
            "reaction_completed": True,
            "overall_renderable": shot["duration"] >= 6.0,
        })
        samples.append(sample)
    report = build_calibration_report(samples)
    assert report["status"] == "candidate_ready"
    assert report["candidate_calibration"]["status"] == "candidate_only"
    assert report["candidate_calibration"]["applied_to_w003"] is False
    assert report["policy"]["automatic_storyboard_feedback"] is False


def _selection_sample(index: int, ratio: float) -> dict:
    planned = 10.0
    return {
        "schema_version": "duration_calibration.v1",
        "sample_id": f"run_select:SH{index:03d}",
        "run_id": "run_select",
        "build_id": "build_select",
        "shot_id": f"SH{index:03d}",
        "scene_id": "SC001",
        "planned_duration_seconds": planned,
        "rendered_duration_seconds": None,
        "dialogue_char_count": 10 if index % 2 else 0,
        "narration_char_count": 0,
        "speech_char_count": 10 if index % 2 else 0,
        "visible_action_count": 1 if index % 3 else 0,
        "reaction_count": 1 if index % 4 == 0 else 0,
        "transition_count": 0,
        "current_w003_estimate_seconds": planned * ratio,
        "speech_completed": None,
        "action_completed": None,
        "reaction_completed": None,
        "overall_renderable": None,
        "actual_notes": "",
    }


def test_duration_calibration_selects_stratified_batch_without_production_changes():
    from runtime.duration_calibration import select_calibration_samples

    samples = []
    for index, ratio in enumerate(
        [0.50, 0.65, 0.80, 0.92, 1.00, 1.10, 1.25, 1.40, 1.60, 1.80, 2.00, 2.20],
        start=1,
    ):
        samples.append(_selection_sample(index, ratio))

    selected = select_calibration_samples(samples, batch_size=10)
    assert len(selected) == 10
    ratios = [sample["current_w003_estimate_seconds"] / sample["planned_duration_seconds"] for sample in selected]
    assert sum(ratio <= 0.85 for ratio in ratios) >= 3
    assert sum(0.85 < ratio <= 1.15 for ratio in ratios) >= 3
    assert sum(ratio > 1.15 for ratio in ratios) >= 4
    assert all(sample["overall_renderable"] is None for sample in selected)


def test_duration_calibration_batch_carries_exact_compiled_prompt_for_real_render():
    from runtime.duration_calibration import build_calibration_batch

    shot = _shot()
    run = {
        "run_id": "run_batch",
        "build_id": "build_batch",
        "artifacts": {
            "shot_specs": [shot],
            "compiled_project": {
                "shot_prompts": [
                    {"shot_id": "SH001", "prompt_seedance": "镜号：01\n时长：6s\n画面内容：测试"}
                ]
            },
        },
    }
    batch = build_calibration_batch(run, batch_size=1)
    assert batch["selected_count"] == 1
    assert batch["samples"][0]["prompt_seedance"] == "镜号：01\n时长：6s\n画面内容：测试"
    assert batch["policy"] == {
        "sampling_only": True,
        "automatic_storyboard_feedback": False,
        "automatic_w003_parameter_update": False,
    }


def test_duration_calibration_safe_selection_prefers_informative_shots():
    from runtime.duration_calibration import select_calibration_samples

    empty_safe = _selection_sample(1, 0.20)
    empty_safe.update({"speech_char_count": 0, "visible_action_count": 0, "reaction_count": 0})
    informative_safe = [_selection_sample(i, 0.60 + i * 0.01) for i in range(2, 6)]
    borderline = [_selection_sample(i, 1.0) for i in range(6, 9)]
    risk = [_selection_sample(i, 1.5) for i in range(9, 14)]
    selected = select_calibration_samples([empty_safe, *informative_safe, *borderline, *risk], batch_size=10)
    selected_safe = [s for s in selected if s["current_w003_estimate_seconds"] / s["planned_duration_seconds"] <= 0.85]
    assert len(selected_safe) == 3
    assert all(
        s["speech_char_count"] > 0 or s["visible_action_count"] > 0 or s["reaction_count"] > 0
        for s in selected_safe
    )
