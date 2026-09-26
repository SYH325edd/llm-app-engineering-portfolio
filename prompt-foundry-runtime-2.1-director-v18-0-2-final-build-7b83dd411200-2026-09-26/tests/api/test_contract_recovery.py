from __future__ import annotations

import copy

from app.prompts import scene_plan_prompt, stage_payload
from app.upstream_validation import validate_scene_plan, validate_script, validate_story_bible, validate_storyboard_base
from tests.api.fixtures.mock_story_run import RESPONSES


def _story_with_contexts():
    story = copy.deepcopy(RESPONSES["story_bible"])
    story["narrative_contexts"] = [{"context_id": f"context_{i:03d}"} for i in range(1, 4)]
    return story


def test_scene_plan_contract_explicitly_requires_single_context_and_global_unique_beats():
    prompt = scene_plan_prompt()
    assert "只能是一个" in prompt
    assert "多个 context" in prompt
    assert "全项目唯一" in prompt
    assert "不得在新 Scene 中从 B001 重新开始" in prompt


def test_scene_plan_payload_contains_authoritative_reference_manifest():
    payload = stage_payload("scene_plan", source_text="x", artifacts={"story_bible": _story_with_contexts()})
    manifest = payload["reference_manifest"]
    assert manifest["character_refs"] == ["char_001"]
    assert manifest["location_refs"] == ["scene_001"]
    assert manifest["prop_refs"] == ["prop_001"]
    assert manifest["context_refs"] == ["context_001", "context_002", "context_003"]


def test_scene_plan_validator_rejects_multi_context_string_and_duplicate_global_beats():
    story = _story_with_contexts()
    plan = {"scenes": [
        {"scene_id":"SC001","context_ref":"context_001, context_002","location_ref":"scene_001","character_refs":["char_001"],"prop_refs":[],"beat_list":[{"beat_id":"B001","description":"a","type":"setup"}]},
        {"scene_id":"SC002","context_ref":"context_002","location_ref":"scene_001","character_refs":["char_001"],"prop_refs":[],"beat_list":[{"beat_id":"B001","description":"b","type":"setup"}]},
    ]}
    kinds = {e["type"] for e in validate_scene_plan(story, plan)}
    assert "multiple_context_refs" in kinds
    assert "duplicate_beat_id" in kinds


def test_story_bible_rejects_duplicate_context_ids():
    story = _story_with_contexts()
    story["narrative_contexts"].append({"context_id":"context_001"})
    assert any(e["type"] == "duplicate_context_id" for e in validate_story_bible(story))


def test_script_rejects_duplicate_or_extra_scene_and_beat_ids():
    story=copy.deepcopy(RESPONSES["story_bible"]); plan=copy.deepcopy(RESPONSES["scene_plan"]); script=copy.deepcopy(RESPONSES["script"])
    duplicate=copy.deepcopy(script["scenes"][0]); duplicate["beats"].append({"beat_id":"B999","description":"extra","dialogue":[]}); script["scenes"].append(duplicate)
    kinds={e["type"] for e in validate_script(story, plan, script)}
    assert "duplicate_script_scene_id" in kinds
    assert "unknown_script_beat" in kinds


def test_storyboard_rejects_unknown_beat_and_context_mismatch():
    story=copy.deepcopy(RESPONSES["story_bible"]); plan=copy.deepcopy(RESPONSES["scene_plan"]); board=copy.deepcopy(RESPONSES["storyboard_base"])
    board["scenes"][0]["context_ref"]="context_999"; board["scenes"][0]["shots"][0]["beat_id"]="B999"
    kinds={e["type"] for e in validate_storyboard_base(story, plan, board)}
    assert "storyboard_context_mismatch" in kinds
    assert "unknown_storyboard_beat" in kinds


def test_storyboard_shot_ids_are_normalized_globally():
    from app.normalization import normalize_storyboard_shot_ids
    board={"scenes":[{"scene_id":"SC001","shots":[{"shot_id":"SH001"},{"shot_id":"SH001"}]},{"scene_id":"SC002","shots":[{"shot_id":"SH001"}]}]}
    normalized, changes=normalize_storyboard_shot_ids(board)
    assert [shot["shot_id"] for scene in normalized["scenes"] for shot in scene["shots"]] == ["SH001","SH002","SH003"]
    assert changes == 2
