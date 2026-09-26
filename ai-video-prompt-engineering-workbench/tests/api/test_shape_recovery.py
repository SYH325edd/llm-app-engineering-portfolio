from __future__ import annotations

import copy

from app.prompts import director_prompt, stage_payload
from tests.api.fixtures.mock_story_run import RESPONSES


def test_director_prompt_explicitly_constrains_nested_json_types():
    prompt=director_prompt()
    assert "body_regions" in prompt and "JSON object" in prompt
    assert "performance_actions" in prompt and "JSON object" in prompt
    assert "action_delta" in prompt and "characters/props/environment" in prompt
    assert "inherit.characters" in prompt and "JSON object" in prompt


def test_director_payload_contains_output_template():
    artifacts={"story_bible":copy.deepcopy(RESPONSES["story_bible"]),"scene_plan":copy.deepcopy(RESPONSES["scene_plan"]),"script":copy.deepcopy(RESPONSES["script"]),"storyboard_base":copy.deepcopy(RESPONSES["storyboard_base"])}
    d=stage_payload("director", source_text="x", artifacts=artifacts)["output_template"]["scenes"][0]["shots"][0]["director"]
    assert isinstance(d["visual_focus"]["body_regions"], dict)
    assert isinstance(d["action_delta"]["characters"], dict)
    assert isinstance(d["state_out"]["environment"], dict)
    assert isinstance(d["performance_actions"], list)


def test_shape_gate_covers_all_semantic_stages_without_raising():
    from app.shape_validation import validate_stage_shape
    malformed={
      "story_bible":{"characters":{},"scenes":[],"props":[],"narrative_contexts":[]},
      "scene_plan":{"scenes":{}},
      "script":{"scenes":[{"beats":{}}]},
      "storyboard_base":{"scenes":[{"shots":{}}]},
      "director":{"scenes":[{"shots":[{"character_refs":[],"prop_refs":[],"dialogue":[],"source_evidence":[],"continuity":{},"director":{"primary_subject_refs":[],"speaker_target_refs":[],"reaction_target_refs":[],"performance_actions":[],"visual_focus":{"subject_refs":[],"prop_refs":[],"environment_keys":[],"body_regions":[]},"action_delta":{"characters":{},"props":{},"environment":{}},"state_out":{"characters":{},"props":{},"environment":{}},"continuity_scope":{"mode":"reset"}}}]}]},
      "pvb":{"characters":[{"visual_identity":[],"wardrobe":{}}]},
      "psb":{"scenes":[{"production_visual":[]}]},
      "style_guide":{"era":[],"region":{},"genre":{},"tone":{},"visual_reference":{}},
    }
    for stage,value in malformed.items():
        errors=validate_stage_shape(stage,value)
        assert errors, stage
        assert all(e["type"].startswith("shape_") for e in errors), (stage,errors)


def test_all_stage_output_contracts_publish_container_types():
    from app.prompts import output_contract
    for stage in ("story_bible","scene_plan","script","storyboard_base","director","pvb","psb","style_guide"):
        types=output_contract(stage).get("container_types")
        assert isinstance(types,dict) and types, stage
