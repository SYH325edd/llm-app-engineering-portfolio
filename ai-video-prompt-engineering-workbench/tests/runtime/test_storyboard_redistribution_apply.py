from __future__ import annotations

import copy

from app.store import RunStore
from runtime.checkpoints import CheckpointStore
from runtime.orchestrator import RuntimeV20
from runtime.storyboard_redistribution import (
    apply_redistribution_fragments,
    build_redistribution_fragment_payload,
    build_storyboard_redistribution_plan,
    canonicalize_redistribution_fragment,
    validate_redistribution_fragment,
)
from runtime.stages.storyboard import build_frozen_text_units
from tests.api.fixtures.mock_story_run import MockModel, RESPONSES


def _segments_feedback():
    texts = [
        "九几年，我在这修鞋。",
        "有个小伙子，天天路过。",
        "后来他租了我隔壁的门面，开杂货铺。",
        "我俩常一起吃饭。",
    ]
    return {
        "contract_version": "storyboard_overload_feedback.v1-shadow",
        "mode": "shadow_only",
        "run_id": "run_test",
        "build_id": "build_test",
        "thresholds": {"calibrated_with_real_seedance": False},
        "shots": [{
            "shot_id": "SH001", "scene_id": "SC001", "beat_id": "B001",
            "classification": "overloaded", "planned_duration_seconds": 4.0,
            "provisional_shadow_estimate_seconds": 12.0,
            "resolution": {
                "status": "splittable_at_existing_unit_boundaries",
                "mode": "return_to_storyboard_allocator",
                "candidate_segments": [
                    {
                        "segment_id": f"SEG{i:02d}", "channel": "dialogue",
                        "utterance_group_id": "UTT_B001_001", "character_id": "char_001",
                        "unit_refs": [f"FTU_B001_D{i:03d}"], "texts": [text], "text": text,
                        "speech_char_count": len(text), "atomic": True,
                    }
                    for i, text in enumerate(texts, 1)
                ],
            },
        }],
    }


def _source_shot():
    return {
        "shot_id": "SH001", "scene_id": "SC001", "beat_id": "B001",
        "character_refs": ["char_001"], "prop_refs": ["prop_001"],
        "shot_size": "medium", "camera": "eye_level", "movement": "static",
        "composition": "阿宁位于画面中部。", "duration": 4.0,
        "description": "阿宁站在窗边，手里拿着信封。",
        "dialogue": [{"character_id": "char_001", "line": "九几年，我在这修鞋。有个小伙子，天天路过。后来他租了我隔壁的门面，开杂货铺。我俩常一起吃饭。"}],
        "narration": [],
        "frozen_text_unit_refs": {"dialogue": [f"FTU_B001_D{i:03d}" for i in range(1, 5)], "narration": []},
        "continuity": {"continuous_with_previous": False, "axis_side": "neutral", "eyeline_match": "not_applicable"},
        "source_evidence": [{"quote": "阿宁站在窗边，手里拿着信封。"}],
    }


def test_fragment_regenerates_storyboard_owned_fields_but_program_owns_text_allocation():
    plan = build_storyboard_redistribution_plan(_segments_feedback())
    source = _source_shot()
    scene_plan = {"character_refs": ["char_001"], "prop_refs": ["prop_001"]}
    script_scene = {
        "beats": [{
            "beat_id": "B001", "description": "阿宁站在窗边，手里拿着信封。",
            "dialogue": [{"character_id": "char_001", "line": "九几年，我在这修鞋。有个小伙子，天天路过。后来他租了我隔壁的门面，开杂货铺。我俩常一起吃饭。"}],
        }]
    }
    payload = build_redistribution_fragment_payload(
        shot_plan=plan["shot_plans"][0], source_shot=source,
        scene_plan_scene=scene_plan, script_scene=script_scene,
        unit_id="storyboard_redistribution:SH001",
    )
    raw = {"shots": [{
        "character_refs": ["char_001"], "prop_refs": ["prop_001"],
        "shot_size": "close", "camera": "eye_level", "movement": "static",
        "composition": f"构图{i}", "duration": 3.0,
        "description": "阿宁站在窗边，手里拿着信封。",
        "continuity": {"continuous_with_previous": True, "axis_side": "neutral", "eyeline_match": "not_applicable"},
        "source_evidence": [{"quote": "阿宁站在窗边，手里拿着信封。"}],
    } for i in range(4)]}
    canonical, _ = canonicalize_redistribution_fragment(raw, payload=payload)
    assert validate_redistribution_fragment(canonical, payload=payload) == []
    assert canonical["shots"][0]["continuity"]["continuous_with_previous"] is False
    assert [s["dialogue"][0]["line"] for s in canonical["shots"]] == [
        "九几年，我在这修鞋。", "有个小伙子，天天路过。",
        "后来他租了我隔壁的门面，开杂货铺。", "我俩常一起吃饭。",
    ]
    assert [s["frozen_text_unit_refs"]["dialogue"][0] for s in canonical["shots"]] == [
        "FTU_B001_D001", "FTU_B001_D002", "FTU_B001_D003", "FTU_B001_D004"
    ]


def test_apply_replaces_source_shot_and_reassigns_global_ids_without_text_loss():
    plan = build_storyboard_redistribution_plan(_segments_feedback())
    source = _source_shot()
    board = {"scenes": [{"scene_id": "SC001", "context_ref": "", "location_ref": "scene_001", "shots": [
        source,
        {**copy.deepcopy(source), "shot_id": "SH002", "dialogue": [], "frozen_text_unit_refs": {"dialogue": [], "narration": []}},
    ]}]}
    replacements = []
    for i, preview in enumerate(plan["shot_plans"][0]["preview_shots"], 1):
        replacements.append({
            "shot_id": preview["preview_shot_id"], "scene_id": "SC001", "beat_id": "B001",
            "character_refs": ["char_001"], "prop_refs": ["prop_001"],
            "shot_size": "medium", "camera": "eye_level", "movement": "static",
            "composition": f"构图{i}", "duration": 3.0, "description": "阿宁站在窗边，手里拿着信封。",
            "dialogue": [{"character_id": "char_001", "line": preview["text_preview"]}], "narration": [],
            "frozen_text_unit_refs": copy.deepcopy(preview["frozen_text_unit_refs"]),
            "continuity": {"continuous_with_previous": i > 1, "axis_side": "neutral", "eyeline_match": "not_applicable"},
            "source_evidence": [{"quote": "阿宁站在窗边，手里拿着信封。"}],
        })
    applied, report = apply_redistribution_fragments(board, plan, {"SH001": {"shots": replacements}})
    shots = applied["scenes"][0]["shots"]
    assert [s["shot_id"] for s in shots] == ["SH001", "SH002", "SH003", "SH004", "SH005"]
    assert report["old_to_new_shot_ids"]["SH001"] == ["SH001", "SH002", "SH003", "SH004"]
    assert report["old_to_new_shot_ids"]["SH002"] == ["SH005"]
    assert [s["dialogue"][0]["line"] for s in shots[:4]] == [x["text_preview"] for x in plan["shot_plans"][0]["preview_shots"]]


class RedistributionModel(MockModel):
    def generate_json(self, stage, system_prompt, user_payload):
        if stage == "storyboard_redistribution_fragment":
            self.calls.append(stage)
            shots = []
            for index, _segment in enumerate(user_payload["replacement_segments"]):
                shots.append({
                    "character_refs": ["char_001"], "prop_refs": ["prop_001"],
                    "shot_size": "medium_close" if index % 2 == 0 else "medium",
                    "camera": "eye_level", "movement": "static",
                    "composition": f"重分配构图{index + 1}", "duration": 3.0,
                    "description": "阿宁站在窗边，手里拿着信封。",
                    "continuity": {"continuous_with_previous": True, "axis_side": "neutral", "eyeline_match": "not_applicable"},
                    "source_evidence": [{"quote": "阿宁站在窗边，手里拿着信封。"}],
                })
            return {"replacement": {"shots": shots}}
        return super().generate_json(stage, system_prompt, user_payload)


def test_runtime_active_apply_regenerates_downstream_and_preserves_override_for_resume(tmp_path):
    model = RedistributionModel()
    store = RunStore(tmp_path / "runs")
    checkpoints = CheckpointStore(tmp_path / "checkpoints")
    rt = RuntimeV20(model=model, store=store, checkpoints=checkpoints)
    run = rt.start("阿宁站在窗边，手里拿着信封。", title="redistribution apply")
    assert run["status"] == "completed"

    long_line = "九几年，我在这修鞋。有个小伙子，天天路过。后来他租了我隔壁的门面，开杂货铺。我俩常一起吃饭。"
    script_scene = run["artifacts"]["script"]["scenes"][0]
    script_scene["beats"][0]["dialogue"] = [{"character_id": "char_001", "line": long_line}]
    frozen = build_frozen_text_units(script_scene)["B001"]["dialogue"]
    refs = [u["unit_id"] for u in frozen]
    assert len(refs) == 4

    base_shot = run["artifacts"]["storyboard_base"]["scenes"][0]["shots"][0]
    base_shot["duration"] = 4.0
    base_shot["dialogue"] = [{"character_id": "char_001", "line": long_line}]
    base_shot["frozen_text_unit_refs"] = {"dialogue": refs, "narration": []}
    spec = run["artifacts"]["shot_specs"][0]
    spec["duration"] = 4.0
    spec["dialogue"] = [{"character_id": "char_001", "line": long_line}]
    spec["frozen_text_unit_refs"] = {"dialogue": refs, "narration": []}
    store.save(run)

    calls_before = list(model.calls)
    updated = rt.redistribute_overloaded_shots(run["run_id"])
    assert updated["status"] == "completed", updated.get("error")
    assert updated["storyboard_redistribution"]["status"] == "completed"
    assert updated["storyboard_redistribution"]["post_apply_feedback"]["shot_count"] == 4
    assert isinstance(updated["storyboard_redistribution"]["residual_overloaded_shot_ids"], list)
    assert updated["counts"]["shots"] == 4
    new_base = updated["artifacts"]["storyboard_base"]["scenes"][0]["shots"]
    assert [x["shot_id"] for x in new_base] == ["SH001", "SH002", "SH003", "SH004"]
    assert [x["dialogue"][0]["line"] for x in new_base] == [u["text"] for u in frozen]
    assert "storyboard_redistribution_override" in updated["artifacts"]
    assert model.calls.count("storyboard_redistribution_fragment") == 1
    assert model.calls.count("story_bible") == calls_before.count("story_bible")
    assert model.calls.count("scene_plan") == calls_before.count("scene_plan")
    assert model.calls.count("script_scene") == calls_before.count("script_scene")
    assert model.calls.count("storyboard_scene") == calls_before.count("storyboard_scene")
    assert model.calls.count("production_semantics_shot") >= calls_before.count("production_semantics_shot") + 4
    assert model.calls.count("director_shot") >= calls_before.count("director_shot") + 4


class NativeLongDialoguePauseModel(RedistributionModel):
    long_line = "九几年，我在这修鞋。有个小伙子，天天路过。后来他租了我隔壁的门面，开杂货铺。我俩常一起吃饭。"

    def __init__(self):
        super().__init__()
        self.redistribution_started = False
        self.failed_after_apply = False

    def generate_json(self, stage, system_prompt, user_payload):
        if stage == "scene_plan":
            self.calls.append(stage)
            value = copy.deepcopy(RESPONSES["scene_plan"])
            refs = [
                str(item.get("source_ref"))
                for item in (user_payload.get("source_index") or [])
                if isinstance(item, dict) and item.get("source_ref")
            ]
            value["scenes"][0]["beat_list"][0]["source_refs"] = refs
            return value
        if stage == "script_scene":
            self.calls.append(stage)
            scene = copy.deepcopy(RESPONSES["script"]["scenes"][0])
            scene["beats"][0]["dialogue"] = [{"character_id": "char_001", "line": self.long_line}]
            return {"scene": scene}
        if stage == "storyboard_redistribution_fragment":
            self.redistribution_started = True
            return super().generate_json(stage, system_prompt, user_payload)
        if (
            stage == "director_shot"
            and self.redistribution_started
            and not self.failed_after_apply
            and str((user_payload.get("shot") or {}).get("shot_id") or "") == "SH003"
        ):
            self.calls.append(stage)
            self.failed_after_apply = True
            raise RuntimeError("temporary downstream director failure after redistribution")
        return super().generate_json(stage, system_prompt, user_payload)


def test_redistribution_override_survives_downstream_pause_and_normal_resume(tmp_path):
    model = NativeLongDialoguePauseModel()
    store = RunStore(tmp_path / "runs")
    checkpoints = CheckpointStore(tmp_path / "checkpoints")
    rt = RuntimeV20(model=model, store=store, checkpoints=checkpoints)
    source = "阿宁站在窗边，手里拿着信封。\n“" + model.long_line + "”"

    # Production Closeout v1 makes duration authority active before Director.
    # The long dialogue is therefore redistributed during the first run, and this
    # fixture intentionally pauses later at director:SH003.
    paused = rt.start(source, title="redistribution resume")
    assert paused["status"] == "paused", paused.get("error")
    assert paused["current_unit"] == "director:SH003"
    frozen = build_frozen_text_units(paused["artifacts"]["script"]["scenes"][0])["B001"]["dialogue"]
    assert len(frozen) == 4
    assert len(paused["artifacts"]["storyboard_base"]["scenes"][0]["shots"]) == 4
    report = paused["artifacts"].get("duration_authority_report") or {}
    apply_report = report.get("redistribution_apply_report") or {}
    assert apply_report.get("applied") is True
    assert apply_report.get("old_shot_count") == 1
    assert apply_report.get("new_shot_count") == 4

    storyboard_calls_before = model.calls.count("storyboard_scene")
    redistribution_calls_before = model.calls.count("storyboard_redistribution_fragment")
    resumed = rt.resume(paused["run_id"])
    assert resumed["status"] == "completed", resumed.get("error")
    assert resumed["counts"]["shots"] == 4
    assert len(resumed["artifacts"]["storyboard_base"]["scenes"][0]["shots"]) == 4
    # Resume must preserve the already-applied duration allocation rather than
    # rerunning Storyboard or spending another redistribution model call.
    assert model.calls.count("storyboard_scene") == storyboard_calls_before
    assert model.calls.count("storyboard_redistribution_fragment") == redistribution_calls_before
    assert [
        x["dialogue"][0]["line"]
        for x in resumed["artifacts"]["storyboard_base"]["scenes"][0]["shots"]
    ] == [u["text"] for u in frozen]
