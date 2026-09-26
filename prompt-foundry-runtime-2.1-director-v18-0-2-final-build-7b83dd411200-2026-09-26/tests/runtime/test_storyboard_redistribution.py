import copy

from runtime.storyboard_redistribution import (
    build_storyboard_redistribution_plan,
    validate_redistribution_plan,
)


def _segment(index: int, text: str, *, channel: str = "dialogue", utterance_group_id: str = "UTT_B001_001"):
    prefix = "D" if channel == "dialogue" else "N"
    return {
        "segment_id": f"SEG{index:02d}",
        "channel": channel,
        "utterance_group_id": utterance_group_id if channel == "dialogue" else None,
        "character_id": "char_001" if channel == "dialogue" else None,
        "unit_refs": [f"FTU_B001_{prefix}{index:03d}"],
        "texts": [text],
        "speech_char_count": len(text),
        "text": text,
        "atomic": True,
    }


def _feedback(status: str = "splittable_at_existing_unit_boundaries", segments=None):
    return {
        "contract_version": "storyboard_overload_feedback.v1-shadow",
        "mode": "shadow_only",
        "run_id": "run_test",
        "build_id": "build_test",
        "thresholds": {"calibrated_with_real_seedance": False},
        "shots": [{
            "shot_id": "SH016",
            "scene_id": "SC003",
            "beat_id": "B009",
            "classification": "overloaded",
            "planned_duration_seconds": 8.0,
            "provisional_shadow_estimate_seconds": 15.02,
            "resolution": {
                "status": status,
                "mode": "return_to_storyboard_allocator",
                "candidate_segments": segments or [],
            },
        }],
    }


def test_key_style_long_dialogue_builds_four_ordered_preview_shots_without_mutating_feedback():
    feedback = _feedback(segments=[
        _segment(1, "九几年，我在这修鞋。"),
        _segment(2, "有个小伙子，天天路过。"),
        _segment(3, "后来他租了我隔壁的门面，开杂货铺。"),
        _segment(4, "我俩常一起吃饭。"),
    ])
    before = copy.deepcopy(feedback)
    plan = build_storyboard_redistribution_plan(feedback)
    assert feedback == before
    assert plan["mode"] == "preview_only"
    assert plan["automatic_storyboard_mutation"] is False
    assert plan["apply_enabled"] is False
    assert plan["preview_ready_count"] == 1
    item = plan["shot_plans"][0]
    assert item["plan_status"] == "preview_ready"
    assert [x["preview_shot_id"] for x in item["preview_shots"]] == [
        "SH016.R01", "SH016.R02", "SH016.R03", "SH016.R04"
    ]
    assert [x["text_preview"] for x in item["preview_shots"]] == [
        "九几年，我在这修鞋。",
        "有个小伙子，天天路过。",
        "后来他租了我隔壁的门面，开杂货铺。",
        "我俩常一起吃饭。",
    ]
    assert item["coverage_check"]["passed"] is True
    assert plan["validation"]["passed"] is True


def test_atomic_or_cross_channel_feedback_is_blocked_not_guessed():
    atomic = build_storyboard_redistribution_plan(_feedback(
        status="unsplittable_under_current_frozen_units",
        segments=[_segment(1, "完整长句。")],
    ))
    assert atomic["shot_plans"][0]["plan_status"] == "blocked"
    assert atomic["shot_plans"][0]["blocked_reason"] == "atomic_frozen_text_unit"

    mixed_segments = [
        _segment(1, "对白。", channel="dialogue"),
        _segment(2, "旁白。", channel="narration"),
    ]
    mixed = build_storyboard_redistribution_plan(_feedback(
        status="allocator_required",
        segments=mixed_segments,
    ))
    assert mixed["shot_plans"][0]["plan_status"] == "blocked"
    assert mixed["shot_plans"][0]["blocked_reason"] == "cross_channel_order_storyboard_owned"


def test_validator_rejects_duplicate_or_reordered_frozen_text_refs():
    plan = build_storyboard_redistribution_plan(_feedback(segments=[
        _segment(1, "第一句。"),
        _segment(2, "第二句。"),
    ]))
    item = plan["shot_plans"][0]
    item["coverage_check"]["planned_unit_refs"] = ["FTU_B001_D002", "FTU_B001_D002"]
    errors = validate_redistribution_plan(plan)
    kinds = {error["type"] for error in errors}
    assert "redistribution_frozen_text_coverage_mismatch" in kinds
    assert "redistribution_duplicate_frozen_text_unit" in kinds
