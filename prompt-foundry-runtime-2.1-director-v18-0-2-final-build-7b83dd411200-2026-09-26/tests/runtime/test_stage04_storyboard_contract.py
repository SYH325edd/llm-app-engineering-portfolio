from __future__ import annotations

import copy

from runtime.model_schema import schema_from_output_template
from runtime.stages.storyboard import (
    CONTRACT_VERSION,
    SYSTEM_PROMPT,
    build_storyboard_scene_payload,
    canonicalize_storyboard_scene,
    validate_storyboard_scene_output,
)


def _plan_scene() -> dict:
    return {
        "scene_id": "SC001", "context_ref": "", "location_ref": "scene_001", "time": "夜晚",
        "character_refs": ["char_001", "char_002"], "prop_refs": ["prop_001"],
        "continuous_with_previous": False, "dramatic_goal": "推进谈话", "conflict": "", "turning_point": "",
        "beat_list": [
            {"beat_id": "B001", "description": "阿宁先开口。", "type": "dialogue"},
            {"beat_id": "B002", "description": "周野回应。", "type": "dialogue"},
        ],
    }


def _script_scene() -> dict:
    return {
        "scene_id": "SC001", "context_ref": "", "location_ref": "scene_001",
        "scene_heading": "厨房 - 夜晚", "scene_description": "阿宁和周野站在厨房里。",
        "beats": [
            {"beat_id": "B001", "description": "阿宁先开口。", "dialogue": [{"character_id": "char_001", "line": "你回来了。"}]},
            {"beat_id": "B002", "description": "周野回应。", "dialogue": [{"character_id": "char_002", "line": "我回来了。"}]},
        ],
    }


def _candidate() -> dict:
    return {
        "scene_id": "MODEL_SCENE", "context_ref": "context_bad", "location_ref": "scene_bad",
        "shots": [
            {
                "shot_id": "MODEL_SHOT", "scene_id": "MODEL_SCENE", "beat_id": "B001",
                "character_refs": ["char_001", "char_001"], "prop_refs": ["prop_001", "prop_001"],
                "shot_size": "medium", "camera": "eye_level", "movement": "static",
                "composition": "阿宁位于画面中部。", "duration": 4.0, "description": "阿宁先开口。",
                "dialogue": [{"character_id": "char_001", "line": "你回来了。"}],
                "continuity": {"continuous_with_previous": False, "axis_side": "neutral", "eyeline_match": "not_applicable"},
                "source_evidence": [{"quote": "阿宁先开口。"}],
            },
            {
                "shot_id": "MODEL_SHOT", "scene_id": "MODEL_SCENE", "beat_id": "B002",
                "character_refs": ["char_002"], "prop_refs": [],
                "shot_size": "close", "camera": "eye_level", "movement": "static",
                "composition": "周野近景。", "duration": 3.0, "description": "周野回应。",
                "dialogue": [{"character_id": "char_002", "line": "我回来了。"}],
                "continuity": {"continuous_with_previous": True, "axis_side": "neutral", "eyeline_match": "matched"},
                "source_evidence": [{"quote": "周野回应。"}],
            },
        ],
    }


def test_storyboard_payload_uses_only_plan_and_script_and_marks_parent_and_shot_ids_program_owned():
    payload = build_storyboard_scene_payload(_plan_scene(), _script_scene(), unit_id="storyboard:SC001")
    assert payload["contract_version"] == CONTRACT_VERSION
    assert "story_bible" not in payload
    template_scene = payload["output_template"]["scene"]
    assert set(template_scene) == {"shots"}
    shot = template_scene["shots"][0]
    assert "shot_id" not in shot
    assert "scene_id" not in shot
    assert payload["output_contract"]["program_owned_fields"] == [
        "scene_id", "context_ref", "location_ref", "shot_id", "shot.scene_id",
        "shot.frozen_text_unit_refs",
        "first_shot.continuity.continuous_with_previous",
    ]
    assert "不要输出 scene_id/context_ref/location_ref/shot_id" in SYSTEM_PROMPT
    assert "sentence-level FrozenTextUnits" in payload["output_contract"]["frozen_text_authority"]["dialogue"]
    assert "frozen_text_units" in payload
    assert "dialogue_unit_refs" in shot and "narration_unit_refs" in shot
    assert "dialogue" not in shot and "narration" not in shot
    manifest = payload["output_contract"]["authority_manifest"]
    assert manifest["scene.shots[].dialogue"]["mode"] == "frozen_source_allocation"
    assert manifest["scene.shots[].narration"]["mode"] == "frozen_source_allocation"


def test_storyboard_canonicalizer_owns_parent_refs_local_shot_ids_and_exact_ref_deduplication():
    normalized, changes = canonicalize_storyboard_scene(_plan_scene(), _candidate())
    assert changes > 0
    assert normalized["scene_id"] == "SC001"
    assert normalized["context_ref"] == ""
    assert normalized["location_ref"] == "scene_001"
    assert [x["shot_id"] for x in normalized["shots"]] == ["SH001", "SH002"]
    assert all(x["scene_id"] == "SC001" for x in normalized["shots"])
    assert normalized["shots"][0]["character_refs"] == ["char_001"]
    assert normalized["shots"][0]["prop_refs"] == ["prop_001"]


def test_storyboard_validator_rejects_bad_camera_duration_continuity_and_downstream_fields():
    value, _ = canonicalize_storyboard_scene(_plan_scene(), _candidate())
    shot = value["shots"][0]
    shot["shot_size"] = "portrait_magic"
    shot["camera"] = "random_camera"
    shot["movement"] = "teleport"
    shot["duration"] = 0
    shot["continuity"].pop("axis_side")
    shot["director"] = {"dramatic_intent": "越权"}
    errors = validate_storyboard_scene_output(_plan_scene(), _script_scene(), value)
    kinds = {e["type"] for e in errors}
    assert "invalid_shot_size" in kinds
    assert "invalid_camera" in kinds
    assert "invalid_movement" in kinds
    assert "invalid_shot_duration" in kinds
    assert "missing_storyboard_field" in kinds
    assert any(e["type"] == "extra_storyboard_field" and e.get("path") == "scene.shots[0].director" for e in errors)


def test_storyboard_validator_limits_refs_to_current_scene_but_allows_offscreen_dialogue_speaker():
    value, _ = canonicalize_storyboard_scene(_plan_scene(), _candidate())
    shot = value["shots"][0]
    shot["character_refs"] = ["char_999"]
    shot["prop_refs"] = ["prop_999"]
    errors = validate_storyboard_scene_output(_plan_scene(), _script_scene(), value)
    kinds = {e["type"] for e in errors}
    assert "storyboard_character_ref_not_in_scene" in kinds
    assert "storyboard_prop_ref_not_in_scene" in kinds
    assert "dialogue_speaker_not_in_shot" not in kinds


def test_storyboard_allows_dialogue_to_continue_over_reaction_shot_without_visible_speaker():
    value, _ = canonicalize_storyboard_scene(_plan_scene(), _candidate())
    shot = value["shots"][0]
    # The Script speaker remains frozen in dialogue, while current Shot visuals may
    # show someone/something else. Production Semantics derives offscreen later.
    shot["character_refs"] = []
    errors = validate_storyboard_scene_output(_plan_scene(), _script_scene(), value)
    kinds = {e["type"] for e in errors}
    assert "dialogue_speaker_not_in_shot" not in kinds
    assert "storyboard_dialogue_mismatch" not in kinds


def test_storyboard_validator_requires_exact_script_dialogue_reconstruction_per_beat():
    value, _ = canonicalize_storyboard_scene(_plan_scene(), _candidate())
    value["shots"][0]["dialogue"] = []
    errors = validate_storyboard_scene_output(_plan_scene(), _script_scene(), value)
    assert any(e["type"] == "storyboard_dialogue_mismatch" and e.get("beat_id") == "B001" for e in errors)


def test_storyboard_validator_requires_source_evidence_quote_anchored_to_current_script_beat_or_scene():
    value, _ = canonicalize_storyboard_scene(_plan_scene(), _candidate())
    value["shots"][0]["source_evidence"] = [{"quote": "脚本里完全不存在的证据"}]
    errors = validate_storyboard_scene_output(_plan_scene(), _script_scene(), value)
    assert any(e["type"] == "storyboard_evidence_not_in_script" for e in errors)


def test_storyboard_validator_accepts_multiple_shots_for_one_beat_when_dialogue_aggregate_is_exact():
    value, _ = canonicalize_storyboard_scene(_plan_scene(), _candidate())
    first = value["shots"][0]
    extra = copy.deepcopy(first)
    extra["shot_id"] = "SH002"
    extra["dialogue"] = []
    # This test is about multi-Shot dialogue aggregation, not directorial invention.
    # Keep the extra Shot description anchored to the same Script authority.
    extra["description"] = "阿宁先开口。"
    extra["source_evidence"] = [{"quote": "阿宁先开口。"}]
    second = value["shots"][1]
    second["shot_id"] = "SH003"
    value["shots"] = [first, extra, second]
    assert validate_storyboard_scene_output(_plan_scene(), _script_scene(), value) == []


def test_runtime_stage04_uses_canonical_storyboard_unit_without_repair(tmp_path):
    from app.store import RunStore
    from runtime.checkpoints import CheckpointStore
    from runtime.orchestrator import RuntimeV20
    from tests.api.fixtures.mock_story_run import MockModel

    class BadStoryboardMechanicalFieldsModel(MockModel):
        def __init__(self):
            super().__init__()
            self.storyboard_payload = None

        def generate_json(self, stage, system_prompt, user_payload):
            if stage == "storyboard_scene":
                self.storyboard_payload = copy.deepcopy(user_payload)
            value = super().generate_json(stage, system_prompt, user_payload)
            if stage == "storyboard_scene":
                value = copy.deepcopy(value)
                scene = value["scene"]
                scene["scene_id"] = "MODEL_SCENE"
                scene["context_ref"] = "context_wrong"
                scene["location_ref"] = "scene_wrong"
                shot = scene["shots"][0]
                shot["shot_id"] = "MODEL_SHOT"
                shot["scene_id"] = "MODEL_SCENE"
                shot["character_refs"] = ["char_001", "char_001"]
                shot["prop_refs"] = ["prop_001", "prop_001"]
            return value

    model = BadStoryboardMechanicalFieldsModel()
    runtime = RuntimeV20(
        model=model,
        store=RunStore(tmp_path / "runs"),
        checkpoints=CheckpointStore(tmp_path / "checkpoints"),
    )
    run = runtime.start("阿宁站在窗边，手里拿着信封。", title="Stage 4 wiring")

    assert run["status"] == "completed"
    scene = run["artifacts"]["storyboard_base"]["scenes"][0]
    assert scene["scene_id"] == "SC001"
    assert scene["context_ref"] == ""
    assert scene["location_ref"] == "scene_001"
    assert scene["shots"][0]["shot_id"] == "SH001"
    assert scene["shots"][0]["scene_id"] == "SC001"
    assert scene["shots"][0]["character_refs"] == ["char_001"]
    assert scene["shots"][0]["prop_refs"] == ["prop_001"]
    assert run["units"]["storyboard:SC001"]["repair_count"] == 0
    assert model.storyboard_payload is not None
    assert model.storyboard_payload["contract_version"] == CONTRACT_VERSION
    assert "story_bible" not in model.storyboard_payload


def test_storyboard_validator_rejects_out_of_order_beat_expansion():
    value, _ = canonicalize_storyboard_scene(_plan_scene(), _candidate())
    value["shots"] = [value["shots"][1], value["shots"][0]]
    value["shots"][0]["shot_id"] = "SH001"
    value["shots"][1]["shot_id"] = "SH002"
    errors = validate_storyboard_scene_output(_plan_scene(), _script_scene(), value)
    assert any(e["type"] == "storyboard_beat_order_violation" for e in errors)


def test_storyboard_first_shot_continuity_must_match_scene_plan_but_later_shots_remain_storyboard_owned():
    plan = _plan_scene()
    plan["continuous_with_previous"] = True
    value, _ = canonicalize_storyboard_scene(plan, _candidate())
    value["shots"][0]["continuity"]["continuous_with_previous"] = False
    value["shots"][1]["continuity"]["continuous_with_previous"] = False
    errors = validate_storyboard_scene_output(plan, _script_scene(), value)
    assert any(e["type"] == "storyboard_scene_boundary_continuity_mismatch" for e in errors)
    assert not any(e.get("shot_id") == value["shots"][1]["shot_id"] and e["type"] == "storyboard_scene_boundary_continuity_mismatch" for e in errors)


def test_storyboard_canonicalizer_owns_first_shot_scene_boundary_continuity():
    plan = _plan_scene()
    plan["continuous_with_previous"] = True
    candidate = _candidate()
    candidate["shots"][0]["continuity"]["continuous_with_previous"] = False
    normalized, changes = canonicalize_storyboard_scene(plan, candidate)
    assert changes > 0
    assert normalized["shots"][0]["continuity"]["continuous_with_previous"] is True


def _story_with_prop_manifest() -> dict:
    return {
        "props": [
            {"prop_id": "prop_001", "canonical_name": "饭盒", "aliases": [], "explicit_facts": ["阿宁把饭盒放到桌上。"]},
            {"prop_id": "prop_002", "canonical_name": "名片", "aliases": ["社区法律援助名片"], "explicit_facts": ["阿宁把名片攥在手里。"]},
        ]
    }


def test_storyboard_payload_exposes_prop_manifest_and_v4_contract():
    plan = _plan_scene()
    plan["prop_refs"] = ["prop_001", "prop_002"]
    payload = build_storyboard_scene_payload(plan, _script_scene(), story_bible=_story_with_prop_manifest(), unit_id="storyboard:SC001")
    assert payload["contract_version"] == "storyboard_scene.v16"
    assert "story_bible" not in payload
    assert payload["prop_manifest"]["prop_002"]["canonical_name"] == "名片"
    assert payload["prop_manifest"]["prop_002"]["aliases"] == ["社区法律援助名片"]
    assert "不得按 ID 顺序猜测道具" in SYSTEM_PROMPT


def test_storyboard_validator_rejects_wrong_visible_prop_binding():
    plan = _plan_scene()
    plan["prop_refs"] = ["prop_001", "prop_002"]
    value, _ = canonicalize_storyboard_scene(plan, _candidate())
    shot = value["shots"][0]
    shot["description"] = "阿宁把名片攥在手里。"
    shot["source_evidence"] = [{"quote": "阿宁先开口。"}]
    shot["prop_refs"] = ["prop_001"]
    payload = build_storyboard_scene_payload(plan, _script_scene(), story_bible=_story_with_prop_manifest(), unit_id="x")
    errors = validate_storyboard_scene_output(plan, _script_scene(), value, prop_manifest=payload["prop_manifest"])
    kinds = {e["type"] for e in errors}
    assert "storyboard_missing_visible_prop_ref" in kinds
    assert "storyboard_unsupported_prop_ref" in kinds


def test_storyboard_validator_uses_prop_explicit_fact_for_implicit_cup_action():
    plan = _plan_scene()
    plan["prop_refs"] = ["prop_001", "prop_002"]
    story = {
        "props": [
            {"prop_id": "prop_001", "canonical_name": "关东煮", "aliases": [], "explicit_facts": ["女人端着关东煮离开。"]},
            {"prop_id": "prop_002", "canonical_name": "纸杯", "aliases": [], "explicit_facts": ["周迟给自己也倒了一杯咖啡。"]},
        ]
    }
    value, _ = canonicalize_storyboard_scene(plan, _candidate())
    shot = value["shots"][0]
    shot["description"] = "周迟给自己倒了杯咖啡，说天亮之前最难熬。"
    shot["prop_refs"] = ["prop_001"]
    payload = build_storyboard_scene_payload(plan, _script_scene(), story_bible=story, unit_id="x")
    errors = validate_storyboard_scene_output(plan, _script_scene(), value, prop_manifest=payload["prop_manifest"])
    assert any(e["type"] == "storyboard_missing_visible_prop_ref" and e.get("prop_ref") == "prop_002" for e in errors)
    assert any(e["type"] == "storyboard_unsupported_prop_ref" and e.get("prop_ref") == "prop_001" for e in errors)


def test_storyboard_validator_allows_additional_related_prop_when_required_prop_is_present():
    plan = _plan_scene()
    plan["prop_refs"] = ["prop_001", "prop_002"]
    story = {
        "props": [
            {"prop_id": "prop_001", "canonical_name": "关东煮", "aliases": [], "explicit_facts": ["关东煮装在纸碗里。"]},
            {"prop_id": "prop_002", "canonical_name": "鱼丸", "aliases": ["一串鱼丸"], "explicit_facts": ["周迟多夹了一串鱼丸放进纸碗。"]},
        ]
    }
    value, _ = canonicalize_storyboard_scene(plan, _candidate())
    shot = value["shots"][0]
    shot["description"] = "周迟多夹了一串鱼丸放进纸碗。"
    shot["source_evidence"] = [{"quote": "阿宁先开口。"}]
    shot["prop_refs"] = ["prop_001", "prop_002"]
    payload = build_storyboard_scene_payload(plan, _script_scene(), story_bible=story, unit_id="x")
    errors = validate_storyboard_scene_output(plan, _script_scene(), value, prop_manifest=payload["prop_manifest"])
    assert not any(e["type"] == "storyboard_unsupported_prop_ref" for e in errors)


def test_storyboard_validator_rejects_narrative_summary_description_that_is_not_directly_visualizable():
    value, _ = canonicalize_storyboard_scene(_plan_scene(), _candidate())
    value["shots"][0]["description"] = "之后她每天来，老张每天都多给她一根油条。"
    errors = validate_storyboard_scene_output(_plan_scene(), _script_scene(), value)
    assert any(e["type"] == "storyboard_non_visual_description" for e in errors)



def test_storyboard_prompt_prefers_chinese_but_allows_authorized_proper_nouns():
    assert "composition 与 description 以简体中文描述为主" in SYSTEM_PROMPT
    assert "已授权专有名词可保留原写法" in SYSTEM_PROMPT
    assert "composition 只描述画面布局" in SYSTEM_PROMPT


def test_storyboard_prop_validation_error_includes_stable_shot_index_and_beat_id_for_repair():
    plan = _plan_scene()
    plan["prop_refs"] = ["prop_001", "prop_002"]
    value, _ = canonicalize_storyboard_scene(plan, _candidate())
    shot = value["shots"][0]
    shot["description"] = "阿宁把名片攥在手里。"
    shot["source_evidence"] = [{"quote": "阿宁先开口。"}]
    shot["prop_refs"] = ["prop_001"]
    payload = build_storyboard_scene_payload(plan, _script_scene(), story_bible=_story_with_prop_manifest(), unit_id="x")
    errors = validate_storyboard_scene_output(plan, _script_scene(), value, prop_manifest=payload["prop_manifest"])
    missing = next(e for e in errors if e["type"] == "storyboard_missing_visible_prop_ref")
    unsupported = next(e for e in errors if e["type"] == "storyboard_unsupported_prop_ref")
    assert missing["shot_index"] == 0
    assert missing["beat_id"] == "B001"
    assert missing["prop_ref"] == "prop_002"
    assert unsupported["shot_index"] == 0
    assert unsupported["beat_id"] == "B001"
    assert "invalid_output.scene.shots[shot_index].prop_refs" in SYSTEM_PROMPT


def test_storyboard_validator_rejects_single_shot_that_compresses_long_narrative_time():
    value, _ = canonicalize_storyboard_scene(_plan_scene(), _candidate())
    value["shots"][0]["description"] = "人物蹲下寻找零件，摸索了近一个小时，最后才找到。"
    errors = validate_storyboard_scene_output(_plan_scene(), _script_scene(), value)
    assert any(e["type"] == "storyboard_non_atomic_time_window" for e in errors)


def test_storyboard_validator_rejects_non_visual_cognition_authorial_commentary_and_audio_only_description():
    samples = [
        "人物盯着旧物，仿佛想起很多年前的往事。",
        "人物停在门口，这一刻和多年以前一样。",
        "房间里传来远处的叫喊声。",
    ]
    for text in samples:
        value, _ = canonicalize_storyboard_scene(_plan_scene(), _candidate())
        value["shots"][0]["description"] = text
        errors = validate_storyboard_scene_output(_plan_scene(), _script_scene(), value)
        assert any(e["type"] == "storyboard_non_visual_description" for e in errors), (text, errors)


def test_storyboard_time_atomicity_does_not_treat_historical_time_anchor_as_duration():
    value, _ = canonicalize_storyboard_scene(_plan_scene(), _candidate())
    value["shots"][0]["description"] = "人物盯着旧物，画面切到四十年前的夏天。"
    errors = validate_storyboard_scene_output(_plan_scene(), _script_scene(), value)
    assert not any(e["type"] == "storyboard_non_atomic_time_window" for e in errors)


def test_storyboard_v7_declares_quality_checks_advisory_not_repair_drivers():
    from runtime.stages.storyboard import SYSTEM_PROMPT
    assert "质量告警" in SYSTEM_PROMPT
    assert "不得因为质量告警触发 Repair" in SYSTEM_PROMPT


def test_storyboard_validator_does_not_hard_fail_authorized_latin_visual_wording():
    value, _ = canonicalize_storyboard_scene(_plan_scene(), _candidate())
    value["shots"][0]["composition"] = "medium shot, centered subject"
    value["shots"][1]["description"] = "周野 looks toward 阿宁。"
    errors = validate_storyboard_scene_output(_plan_scene(), _script_scene(), value)
    bad = [e for e in errors if e.get("type") == "storyboard_non_chinese_text"]
    assert bad == []


def test_storyboard_validator_accepts_narration_split_across_multiple_shots_when_joined_stream_is_exact():
    plan = _plan_scene()
    script = _script_scene()
    script["beats"][0]["narration"] = ["甲。乙。丙。"]
    value, _ = canonicalize_storyboard_scene(plan, _candidate())
    first = value["shots"][0]
    first["narration"] = ["甲。"]
    extra_1 = copy.deepcopy(first)
    extra_1["shot_id"] = "SH002"
    extra_1["dialogue"] = []
    extra_1["narration"] = ["乙。"]
    extra_2 = copy.deepcopy(first)
    extra_2["shot_id"] = "SH003"
    extra_2["dialogue"] = []
    extra_2["narration"] = ["丙。"]
    second = value["shots"][1]
    second["shot_id"] = "SH004"
    value["shots"] = [first, extra_1, extra_2, second]

    assert validate_storyboard_scene_output(plan, script, value) == []


def test_storyboard_validator_rejects_resegmentation_across_frozen_narration_units_even_when_joined_stream_is_exact():
    plan = _plan_scene()
    script = _script_scene()
    script["beats"][0]["narration"] = ["甲乙", "丙丁"]
    value, _ = canonicalize_storyboard_scene(plan, _candidate())
    first = value["shots"][0]
    first["narration"] = ["甲"]
    extra_1 = copy.deepcopy(first)
    extra_1["shot_id"] = "SH002"
    extra_1["dialogue"] = []
    extra_1["narration"] = ["乙丙"]
    extra_2 = copy.deepcopy(first)
    extra_2["shot_id"] = "SH003"
    extra_2["dialogue"] = []
    extra_2["narration"] = ["丁"]
    second = value["shots"][1]
    second["shot_id"] = "SH004"
    value["shots"] = [first, extra_1, extra_2, second]

    errors = validate_storyboard_scene_output(plan, script, value)
    assert any(e["type"] == "storyboard_narration_mismatch" and e.get("beat_id") == "B001" for e in errors)


def test_storyboard_validator_rejects_changed_narration_stream_and_reports_joined_and_segmented_forms():
    plan = _plan_scene()
    script = _script_scene()
    script["beats"][0]["narration"] = ["甲乙丙"]
    value, _ = canonicalize_storyboard_scene(plan, _candidate())
    value["shots"][0]["narration"] = ["甲", "丙"]

    errors = validate_storyboard_scene_output(plan, script, value)
    error = next(e for e in errors if e["type"] == "storyboard_narration_mismatch" and e.get("beat_id") == "B001")
    assert error["expected_joined"] == "甲乙丙"
    assert error["got_joined"] == "甲丙"
    assert error["expected_segments"] == ["甲乙丙"]
    assert error["got_segments"] == ["甲", "丙"]


def test_storyboard_description_binding_gap_is_distinct_from_unsupported_description():
    plan = _plan_scene()
    script = _script_scene()
    script["beats"][0]["description"] = "阿宁抬手关门。周野转身坐下。"
    value, _ = canonicalize_storyboard_scene(plan, _candidate(), script)
    shot = value["shots"][0]
    shot["description"] = "周野转身坐下。"
    shot["source_evidence"] = [{"quote": "阿宁抬手关门。"}]

    errors = validate_storyboard_scene_output(plan, script, value)
    gap = next(e for e in errors if e["type"] == "storyboard_description_evidence_binding_gap")
    assert gap["shot_index"] == 0
    assert gap["beat_id"] == "B001"
    assert gap["bound_evidence"] == ["阿宁抬手关门。"]
    assert not any(e["type"] == "storyboard_description_not_supported_by_evidence" and e.get("shot_id") == shot["shot_id"] for e in errors)


def test_storyboard_dialogue_rejects_splitting_one_frozen_dialogue_line_across_shots():
    plan = _plan_scene()
    script = _script_scene()
    script["beats"][0]["dialogue"] = [{"character_id": "char_001", "line": "你终于回来了。"}]
    value, _ = canonicalize_storyboard_scene(plan, _candidate(), script)
    first = value["shots"][0]
    first["dialogue"] = [{"character_id": "char_001", "line": "你终于"}]
    extra = copy.deepcopy(first)
    extra["shot_id"] = "SH002"
    extra["dialogue"] = [{"character_id": "char_001", "line": "回来了。"}]
    second = value["shots"][1]
    second["shot_id"] = "SH003"
    value["shots"] = [first, extra, second]

    errors = validate_storyboard_scene_output(plan, script, value)
    assert any(e["type"] == "storyboard_dialogue_mismatch" and e.get("beat_id") == "B001" for e in errors)


def test_storyboard_dialogue_split_still_rejects_speaker_change_or_text_change():
    plan = _plan_scene()
    script = _script_scene()
    script["beats"][0]["dialogue"] = [{"character_id": "char_001", "line": "你终于回来了。"}]
    value, _ = canonicalize_storyboard_scene(plan, _candidate(), script)
    first = value["shots"][0]
    first["character_refs"] = ["char_001", "char_002"]
    first["dialogue"] = [{"character_id": "char_001", "line": "你终于"}]
    extra = copy.deepcopy(first)
    extra["shot_id"] = "SH002"
    extra["dialogue"] = [{"character_id": "char_002", "line": "回来了。"}]
    second = value["shots"][1]
    second["shot_id"] = "SH003"
    value["shots"] = [first, extra, second]

    errors = validate_storyboard_scene_output(plan, script, value)
    assert any(e["type"] == "storyboard_dialogue_mismatch" and e.get("beat_id") == "B001" for e in errors)


def test_storyboard_prop_visibility_does_not_treat_broad_evidence_as_current_shot_content():
    plan = _plan_scene()
    plan["prop_refs"] = ["prop_001", "prop_002"]
    story = {
        "props": [
            {"prop_id": "prop_001", "canonical_name": "钥匙", "aliases": [], "explicit_facts": ["人物拿起钥匙。"]},
            {"prop_id": "prop_002", "canonical_name": "杯子", "aliases": [], "explicit_facts": ["人物放下杯子。"]},
        ]
    }
    script = _script_scene()
    script["beats"][0]["description"] = "人物拿起钥匙，随后放下杯子。"
    value, _ = canonicalize_storyboard_scene(plan, _candidate(), script)
    shot = value["shots"][0]
    shot["description"] = "人物拿起钥匙。"
    shot["source_evidence"] = [{"quote": "人物拿起钥匙，随后放下杯子。"}]
    shot["prop_refs"] = ["prop_001"]
    payload = build_storyboard_scene_payload(plan, script, story_bible=story, unit_id="x")

    errors = validate_storyboard_scene_output(plan, script, value, prop_manifest=payload["prop_manifest"])
    assert not any(e["type"] == "storyboard_missing_visible_prop_ref" and e.get("prop_ref") == "prop_002" for e in errors)


def test_storyboard_validator_rejects_comma_boundary_narration_split_even_after_exact_punctuation_restore():
    plan = _plan_scene()
    script = _script_scene()
    script["beats"][0]["narration"] = ["人物停了一秒，又继续向前走。"]

    candidate = _candidate()
    first = candidate["shots"][0]
    first["narration"] = ["人物停了一秒。"]
    extra = copy.deepcopy(first)
    extra["dialogue"] = []
    extra["narration"] = ["又继续向前走。"]
    second = candidate["shots"][1]
    candidate["shots"] = [first, extra, second]

    value, changes = canonicalize_storyboard_scene(plan, candidate, script)
    assert changes > 0
    b1_shots = [shot for shot in value["shots"] if shot["beat_id"] == "B001"]
    assert [text for shot in b1_shots for text in shot["narration"]] == ["人物停了一秒，", "又继续向前走。"]
    assert any(
        e["type"] == "storyboard_narration_mismatch"
        for e in validate_storyboard_scene_output(plan, script, value)
    )


def test_storyboard_canonicalizer_does_not_hide_changed_narration_words():
    plan = _plan_scene()
    script = _script_scene()
    script["beats"][0]["narration"] = ["人物停了一秒，又继续向前走。"]

    candidate = _candidate()
    first = candidate["shots"][0]
    first["narration"] = ["人物停了两秒。"]
    extra = copy.deepcopy(first)
    extra["dialogue"] = []
    extra["narration"] = ["又继续向前走。"]
    second = candidate["shots"][1]
    candidate["shots"] = [first, extra, second]

    value, _ = canonicalize_storyboard_scene(plan, candidate, script)
    errors = validate_storyboard_scene_output(plan, script, value)
    mismatch = next(e for e in errors if e["type"] == "storyboard_narration_mismatch")
    assert mismatch["path"] == "scene.shots"
    assert mismatch["expected_joined"] == "人物停了一秒，又继续向前走。"
    assert mismatch["got_joined"] == "人物停了两秒。又继续向前走。"


def test_storyboard_validator_rejects_splitting_one_dialogue_line_at_comma_even_after_punctuation_restore():
    plan = _plan_scene()
    script = _script_scene()
    script["beats"][0]["dialogue"] = [{"character_id": "char_001", "line": "你停一下，再过来。"}]

    candidate = _candidate()
    first = candidate["shots"][0]
    first["dialogue"] = [{"character_id": "char_001", "line": "你停一下。"}]
    extra = copy.deepcopy(first)
    extra["dialogue"] = [{"character_id": "char_001", "line": "再过来。"}]
    second = candidate["shots"][1]
    candidate["shots"] = [first, extra, second]

    value, changes = canonicalize_storyboard_scene(plan, candidate, script)
    assert changes > 0
    b1_shots = [shot for shot in value["shots"] if shot["beat_id"] == "B001"]
    assert [item["line"] for shot in b1_shots for item in shot["dialogue"]] == ["你停一下，", "再过来。"]
    assert any(
        e["type"] == "storyboard_dialogue_mismatch"
        for e in validate_storyboard_scene_output(plan, script, value)
    )


def test_storyboard_v15_materializes_frozen_text_unit_refs_without_model_copying_text():
    plan = _plan_scene()
    script = _script_scene()
    script["beats"][0]["dialogue"] = [{"character_id": "char_001", "line": "你停一下，再过来。"}]
    script["beats"][0]["narration"] = ["他停了一秒，又走了。第二句完整旁白。"]
    payload = build_storyboard_scene_payload(plan, script, unit_id="storyboard:SC001")
    units = payload["frozen_text_units"]["B001"]
    assert [u["text"] for u in units["dialogue"]] == ["你停一下，再过来。"]
    assert [u["text"] for u in units["narration"]] == ["他停了一秒，又走了。", "第二句完整旁白。"]

    candidate = _candidate()
    first = candidate["shots"][0]
    first.pop("dialogue", None)
    first.pop("narration", None)
    first["dialogue_unit_refs"] = [units["dialogue"][0]["unit_id"]]
    first["narration_unit_refs"] = [u["unit_id"] for u in units["narration"]]
    second = candidate["shots"][1]
    second.pop("dialogue", None)
    second.pop("narration", None)
    b2 = payload["frozen_text_units"]["B002"]
    second["dialogue_unit_refs"] = [u["unit_id"] for u in b2["dialogue"]]
    second["narration_unit_refs"] = [u["unit_id"] for u in b2["narration"]]

    value, _ = canonicalize_storyboard_scene(plan, candidate, script)
    assert value["shots"][0]["dialogue"] == [{"character_id": "char_001", "line": "你停一下，再过来。"}]
    assert value["shots"][0]["narration"] == ["他停了一秒，又走了。", "第二句完整旁白。"]
    assert "dialogue_unit_refs" not in value["shots"][0]
    assert "narration_unit_refs" not in value["shots"][0]
    errors = validate_storyboard_scene_output(plan, script, value, model_allocation=candidate)
    assert not [e for e in errors if e["type"] in {"storyboard_dialogue_mismatch", "storyboard_narration_mismatch", "storyboard_frozen_text_unit_allocation_mismatch"}]


def test_storyboard_v15_rejects_unknown_duplicate_or_cross_beat_frozen_text_refs():
    plan = _plan_scene()
    script = _script_scene()
    payload = build_storyboard_scene_payload(plan, script, unit_id="storyboard:SC001")
    candidate = _candidate()
    for shot in candidate["shots"]:
        shot.pop("dialogue", None)
        shot.pop("narration", None)
        shot["dialogue_unit_refs"] = []
        shot["narration_unit_refs"] = []
    b1 = payload["frozen_text_units"]["B001"]["dialogue"][0]["unit_id"]
    b2 = payload["frozen_text_units"]["B002"]["dialogue"][0]["unit_id"]
    candidate["shots"][0]["dialogue_unit_refs"] = [b1, b1, b2, "FTU_UNKNOWN"]
    candidate["shots"][1]["dialogue_unit_refs"] = []
    value, _ = canonicalize_storyboard_scene(plan, candidate, script)
    errors = validate_storyboard_scene_output(plan, script, value, model_allocation=candidate)
    kinds = {e["type"] for e in errors}
    assert "unknown_storyboard_frozen_text_unit_ref" in kinds
    assert "storyboard_frozen_text_unit_beat_mismatch" in kinds
    assert "storyboard_frozen_text_unit_allocation_mismatch" in kinds


def test_storyboard_v15_narration_units_split_only_at_strong_boundaries_outside_quotes():
    plan = _plan_scene()
    script = _script_scene()
    script["beats"][0]["narration"] = ["他说：“等我。别走。”然后转身。她停下；又回头。人物停了一秒，又走了。"]
    payload = build_storyboard_scene_payload(plan, script, unit_id="storyboard:SC001")
    texts = [unit["text"] for unit in payload["frozen_text_units"]["B001"]["narration"]]
    assert texts == [
        "他说：“等我。别走。”然后转身。",
        "她停下；",
        "又回头。",
        "人物停了一秒，又走了。",
    ]


def test_storyboard_v15_provider_schema_requires_string_unit_ref_items():
    payload = build_storyboard_scene_payload(_plan_scene(), _script_scene(), unit_id="storyboard:SC001")
    schema = schema_from_output_template(payload["output_template"])
    shot_schema = schema["properties"]["scene"]["properties"]["shots"]["items"]
    assert shot_schema["properties"]["dialogue_unit_refs"]["items"]["type"] == "string"
    assert shot_schema["properties"]["narration_unit_refs"]["items"]["type"] == "string"


def test_storyboard_v16_merges_comma_continuation_before_semantic_split():
    plan = _plan_scene()
    script = _script_scene()
    script["beats"][0]["dialogue"] = [
        {"character_id": "char_001", "line": "师傅，"},
        {"character_id": "char_001", "line": "那件东西呢？"},
        {"character_id": "char_001", "line": "我只是问问。"},
    ]
    payload = build_storyboard_scene_payload(plan, script, unit_id="storyboard:SC001")
    units = payload["frozen_text_units"]["B001"]["dialogue"]
    assert [u["text"] for u in units] == ["师傅，那件东西呢？", "我只是问问。"]
    assert units[0]["utterance_group_id"] != units[1]["utterance_group_id"]

    candidate = _candidate()
    first = candidate["shots"][0]
    first.pop("dialogue", None)
    first.pop("narration", None)
    first["dialogue_unit_refs"] = [units[0]["unit_id"]]
    first["narration_unit_refs"] = []
    continuation = copy.deepcopy(first)
    continuation["dialogue_unit_refs"] = [units[1]["unit_id"]]
    second = candidate["shots"][1]
    second.pop("dialogue", None)
    second.pop("narration", None)
    b2 = payload["frozen_text_units"]["B002"]
    second["dialogue_unit_refs"] = [u["unit_id"] for u in b2["dialogue"]]
    second["narration_unit_refs"] = [u["unit_id"] for u in b2["narration"]]
    candidate["shots"] = [first, continuation, second]

    value, _ = canonicalize_storyboard_scene(plan, candidate, script)
    errors = validate_storyboard_scene_output(plan, script, value, model_allocation=candidate)
    assert not [e for e in errors if e["type"] in {"storyboard_dialogue_mismatch", "storyboard_frozen_text_unit_allocation_mismatch"}]


def test_storyboard_v16_splits_long_dialogue_at_strong_boundaries_and_preserves_nested_quote():
    script = _script_scene()
    script["beats"][0]["dialogue"] = [{
        "character_id": "char_001",
        "line": "半夜跑了。临走把钥匙塞给我，说‘周哥，帮我收着，我回来拿’。",
    }]
    payload = build_storyboard_scene_payload(_plan_scene(), script, unit_id="storyboard:SC001")
    units = payload["frozen_text_units"]["B001"]["dialogue"]
    assert [u["text"] for u in units] == [
        "半夜跑了。",
        "临走把钥匙塞给我，说‘周哥，帮我收着，我回来拿’。",
    ]
    assert units[0]["utterance_group_id"] == units[1]["utterance_group_id"]
    assert "‘周哥，帮我收着，我回来拿’" in units[1]["text"]


def test_storyboard_v16_allows_one_source_utterance_semantic_units_across_consecutive_shots():
    plan = _plan_scene()
    script = _script_scene()
    script["beats"][0]["dialogue"] = [{
        "character_id": "char_001",
        "line": "第一句说完了。第二句继续说。",
    }]
    payload = build_storyboard_scene_payload(plan, script, unit_id="storyboard:SC001")
    b1_units = payload["frozen_text_units"]["B001"]["dialogue"]
    assert len(b1_units) == 2
    assert b1_units[0]["utterance_group_id"] == b1_units[1]["utterance_group_id"]

    candidate = _candidate()
    first = candidate["shots"][0]
    first.pop("dialogue", None)
    first.pop("narration", None)
    first["dialogue_unit_refs"] = [b1_units[0]["unit_id"]]
    first["narration_unit_refs"] = []
    second_b1 = copy.deepcopy(first)
    second_b1["dialogue_unit_refs"] = [b1_units[1]["unit_id"]]

    b2 = payload["frozen_text_units"]["B002"]
    b2_shot = candidate["shots"][1]
    b2_shot.pop("dialogue", None)
    b2_shot.pop("narration", None)
    b2_shot["dialogue_unit_refs"] = [u["unit_id"] for u in b2["dialogue"]]
    b2_shot["narration_unit_refs"] = [u["unit_id"] for u in b2["narration"]]
    candidate["shots"] = [first, second_b1, b2_shot]

    value, _ = canonicalize_storyboard_scene(plan, candidate, script)
    errors = validate_storyboard_scene_output(plan, script, value, model_allocation=candidate)
    forbidden = {
        "storyboard_dialogue_mismatch",
        "storyboard_frozen_text_unit_allocation_mismatch",
        "storyboard_utterance_group_split",
    }
    assert not [e for e in errors if e["type"] in forbidden]
    assert [
        item["line"]
        for shot in value["shots"][:2]
        for item in shot["dialogue"]
    ] == ["第一句说完了。", "第二句继续说。"]


def test_storyboard_v16_key_style_long_dialogue_exposes_four_safe_sentence_units():
    script = _script_scene()
    script["beats"][0]["dialogue"] = [{
        "character_id": "char_001",
        "line": "九几年，我在这修鞋。有个小伙子，天天路过。后来他租了我隔壁的门面，开杂货铺。我俩常一起吃饭。",
    }]
    payload = build_storyboard_scene_payload(_plan_scene(), script, unit_id="storyboard:SC001")
    units = payload["frozen_text_units"]["B001"]["dialogue"]
    assert [u["text"] for u in units] == [
        "九几年，我在这修鞋。",
        "有个小伙子，天天路过。",
        "后来他租了我隔壁的门面，开杂货铺。",
        "我俩常一起吃饭。",
    ]
    assert len({u["utterance_group_id"] for u in units}) == 1
    assert all(u["character_id"] == "char_001" for u in units)


def test_storyboard_canonicalizer_narrows_overwide_evidence_to_exact_current_authority_fragment():
    plan = _plan_scene()
    script = _script_scene()
    candidate = _candidate()
    candidate["shots"][0]["source_evidence"] = [{
        "quote": "上一拍的无关动作。他停了一下，说：“你回来了。”"
    }]

    normalized, changes = canonicalize_storyboard_scene(
        plan,
        candidate,
        script,
        {"B001": "当前 Beat 只保留另一条原文动作。"},
    )

    assert changes > 0
    assert normalized["shots"][0]["source_evidence"] == [{"quote": "你回来了。"}]
    errors = validate_storyboard_scene_output(
        plan,
        script,
        normalized,
        beat_source_authority={"B001": "当前 Beat 只保留另一条原文动作。"},
    )
    assert not any(e["type"] == "storyboard_evidence_not_in_script" for e in errors)


def test_storyboard_invalid_evidence_exposes_precise_repair_target_and_candidates():
    value, _ = canonicalize_storyboard_scene(_plan_scene(), _candidate(), _script_scene())
    value["shots"][0]["source_evidence"] = [{"quote": "完全不属于当前 Beat 的句子"}]

    errors = validate_storyboard_scene_output(_plan_scene(), _script_scene(), value)
    error = next(e for e in errors if e["type"] == "storyboard_evidence_not_in_script")

    assert error["path"] == "scene.shots[0].source_evidence[0].quote"
    assert error["repair_targets"] == ["scene.shots[0].source_evidence[0].quote"]
    assert error["shot_index"] == 0
    assert error["evidence_index"] == 0
    assert "阿宁先开口。" in error["allowed_evidence_quotes"]
    assert "$" not in error["repair_targets"]

    from runtime.orchestrator import RuntimeV20
    policy = RuntimeV20._repair_policy("storyboard_scene", [error])
    assert policy["repair_targets"] == ["scene.shots[0].source_evidence[0].quote"]
    assert policy["must_change_targeted_fields"] is True
