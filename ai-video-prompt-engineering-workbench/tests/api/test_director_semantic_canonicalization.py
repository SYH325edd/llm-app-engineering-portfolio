from __future__ import annotations

import copy

from app.normalization import normalize_director_semantics
from app.prompts import stage_payload, director_prompt
from tests.api.fixtures.mock_story_run import RESPONSES


def _board_with_dialogue():
    board = copy.deepcopy(RESPONSES["director"])
    shot = board["scenes"][0]["shots"][0]
    shot["dialogue"] = [{"character_id": "char_001", "line": "我知道。"}]
    return board


def test_director_semantic_normalization_sets_exact_speakers():
    board = _board_with_dialogue()
    board["scenes"][0]["shots"][0]["director"]["speaker_target_refs"] = []
    normalized, changes = normalize_director_semantics(board)
    refs = normalized["scenes"][0]["shots"][0]["director"]["speaker_target_refs"]
    assert refs == ["char_001"]
    assert changes >= 1


def test_director_semantic_normalization_filters_prop_from_primary_subjects():
    board = copy.deepcopy(RESPONSES["director"])
    shot = board["scenes"][0]["shots"][0]
    shot["director"]["primary_subject_refs"] = ["prop_001", "char_001"]
    normalized, changes = normalize_director_semantics(board)
    assert normalized["scenes"][0]["shots"][0]["director"]["primary_subject_refs"] == ["char_001"]
    assert changes >= 1


def test_director_semantic_normalization_drops_reaction_without_same_character_performance():
    board = copy.deepcopy(RESPONSES["director"])
    shot = board["scenes"][0]["shots"][0]
    shot["director"]["reaction_target_refs"] = ["char_001"]
    shot["director"]["performance_actions"] = []
    normalized, changes = normalize_director_semantics(board)
    assert normalized["scenes"][0]["shots"][0]["director"]["reaction_target_refs"] == []
    assert changes >= 1


def test_director_payload_contains_per_shot_semantic_constraints():
    artifacts = {
        "story_bible": copy.deepcopy(RESPONSES["story_bible"]),
        "script": copy.deepcopy(RESPONSES["script"]),
        "storyboard_base": copy.deepcopy(RESPONSES["storyboard_base"]),
        "scene_plan": copy.deepcopy(RESPONSES["scene_plan"]),
    }
    artifacts["storyboard_base"]["scenes"][0]["shots"][0]["dialogue"] = [
        {"character_id": "char_001", "line": "我知道。"}
    ]
    payload = stage_payload("director", source_text="x", artifacts=artifacts)
    constraints = payload["director_shot_constraints"]
    assert constraints[0]["shot_id"] == "SH001"
    assert constraints[0]["allowed_character_refs"] == ["char_001"]
    assert constraints[0]["allowed_prop_refs"] == ["prop_001"]
    assert constraints[0]["required_speaker_target_refs"] == ["char_001"]


def test_director_prompt_states_cross_field_semantic_rules():
    prompt = director_prompt()
    assert "speaker_target_refs 必须精确等于当前 Shot 对白 speaker" in prompt
    assert "primary_subject_refs 只能来自当前 Shot 的 character_refs" in prompt
    assert "reaction_target_refs 中每个角色都必须有同角色 performance_action" in prompt


def test_director_semantic_normalization_uses_authoritative_base_for_refs_and_speakers():
    candidate = _board_with_dialogue()
    base = _board_with_dialogue()
    # Model illegally mutates base fields. Canonicalization must still use authoritative base.
    cshot = candidate["scenes"][0]["shots"][0]
    cshot["character_refs"] = ["prop_001"]
    cshot["dialogue"] = []
    cshot["director"]["primary_subject_refs"] = ["prop_001", "char_001"]
    cshot["director"]["speaker_target_refs"] = []
    normalized, _ = normalize_director_semantics(candidate, base)
    director = normalized["scenes"][0]["shots"][0]["director"]
    assert director["primary_subject_refs"] == ["char_001"]
    assert director["speaker_target_refs"] == ["char_001"]



def test_director_prompt_declares_only_director_field_is_model_owned():
    prompt = director_prompt()
    assert "只拥有每个 Shot 的 director 字段" in prompt
    assert "Base Storyboard 为权威" in prompt
