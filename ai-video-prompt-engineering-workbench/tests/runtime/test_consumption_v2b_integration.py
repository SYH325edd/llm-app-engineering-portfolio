from __future__ import annotations

import copy

from runtime.stages.compile_eval import compile_and_evaluate, lock_production_assets
from runtime.stages.state_shotspec import build_state_shot_specs
from tests.api.fixtures.mock_story_run import RESPONSES


def _locked_specs_and_semantics():
    locked, errors, _ = lock_production_assets(
        RESPONSES["story_bible"], copy.deepcopy(RESPONSES["pvb"]),
        copy.deepcopy(RESPONSES["psb"]), copy.deepcopy(RESPONSES["style_guide"]),
    )
    assert errors == []
    specs, spec_errors = build_state_shot_specs(copy.deepcopy(RESPONSES["director"]))
    assert spec_errors == []
    shots = []
    for shot in specs:
        shots.append({
            "shot_id": shot["shot_id"], "context_ref": shot.get("context_ref", ""),
            "visual_events": [{
                "action": "阿宁把信封放到桌面。",
                "character_refs": list(shot.get("character_refs") or []),
                "prop_refs": list(shot.get("prop_refs") or []),
                "source_evidence": [{"quote": "阿宁把信封放到桌面。"}],
            }],
            "audio_events": [], "renderability_status": "renderable", "renderability_issues": [],
            "dialogue": [], "diegetic_text": [], "production_choices": [], "appearance_overlays": [],
        })
    return locked, specs, {"shots": shots}


def test_compile_eval_switches_authoritative_output_to_v2b_and_keeps_v1_reference():
    locked, specs, semantics = _locked_specs_and_semantics()
    result, errors = compile_and_evaluate(
        project_id="p", story_bible=copy.deepcopy(RESPONSES["story_bible"]),
        script=copy.deepcopy(RESPONSES["script"]), storyboard=copy.deepcopy(RESPONSES["director"]),
        shot_specs=specs, pvb=locked["pvb"], psb=locked["psb"], style_guide=locked["style_guide"],
        production_semantics=semantics,
    )
    assert errors == []
    assert result["compiled_project"]["compiler_version"] == "consumption_v2m"
    assert result["consumption_evaluation"]["compiler_version"] == "consumption_v2m"
    assert result["consumption_v1_compiled_project"]["compiler_version"] == "consumption_v1"
    assert result["compiled_project"]["summary"]["fallback_used"] == 0


def test_runtime_v2b_is_authoritative_and_storyboard_quality_warnings_remain_diagnostic_only(tmp_path):
    from app.store import RunStore
    from runtime.checkpoints import CheckpointStore
    from runtime.orchestrator import RuntimeV20
    from tests.runtime.test_runtime20_recovery import NeverRepairsStoryboardQualityModel

    rt = RuntimeV20(
        model=NeverRepairsStoryboardQualityModel(),
        store=RunStore(tmp_path / "runs"), checkpoints=CheckpointStore(tmp_path / "checkpoints"),
    )
    run = rt.start("阿宁站在窗边，手里拿着信封。", "v2b warning separation")
    assert run["status"] == "completed"
    assert run["compiler_version"] == "consumption_v2m"
    assert any(w.get("stage") == "storyboard" for w in run.get("quality_warnings") or [])
    final_codes = {
        w.get("code")
        for shot in run["artifacts"]["compiled_project"].get("shot_prompts", []) or []
        for w in shot.get("warnings", []) or []
    }
    assert "W010_NON_ATOMIC_TIME_WINDOW" not in final_codes
    assert "W011_NON_VISUAL_DESCRIPTION" not in final_codes
    assert run["artifacts"]["consumption_v1_compiled_project"]["compiler_version"] == "consumption_v1"
