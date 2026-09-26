from __future__ import annotations

import copy

from prompt_foundry_v1_3.state_resolver import empty_state


def _director_context():
    return {
        "shot": {
            "shot_id": "SH001",
            "scene_id": "SC001",
            "beat_id": "B001",
            "character_refs": ["char_001"],
            "prop_refs": ["prop_001"],
            "description": "这是基础分镜旧描述，不再作为 Director 动作证据。",
            "dialogue": [{"character_id": "char_001", "line": "我回来了。"}],
            "source_evidence": [{"quote": "原文只说他留下联系方式。"}],
        },
        "script_beat": {"beat_id": "B001", "description": "上下文而非动作证据"},
        "assets": {
            "characters": {"char_001": {"character_id": "char_001"}},
            "props": {"prop_001": {"prop_id": "prop_001"}},
            "scene": {"scene_id": "scene_001"},
            "context": {"context_id": "context_001"},
        },
        "production_semantics": {
            "shot_id": "SH001",
            "context_ref": "context_001",
            "visual_events": [{
                "action": "甲把现有纸条放到桌面。",
                "character_refs": ["char_001"],
                "prop_refs": ["prop_001"],
                "source_evidence": [{"quote": "原文只说他留下联系方式。"}],
            }],
            "audio_events": [{
                "audio_type": "diegetic",
                "content": "走廊外传来脚步声。",
                "source_evidence": [{"quote": "走廊外传来脚步声。"}],
            }],
            "renderability_status": "renderable",
            "renderability_issues": [],
            "dialogue": [{"character_id": "char_001", "line": "我回来了。", "offscreen": False}],
            "diegetic_text": [],
            "production_choices": [{
                "type": "minimal_action_mechanism",
                "choice": "甲把现有纸条放到桌面。",
                "affected_character_refs": ["char_001"],
                "affected_prop_refs": ["prop_001"],
                "narrative_context_ref": "context_001",
                "impact": "no_story_change",
                "rationale": "最小可拍机制",
                "story_changes": {
                    "new_characters": [], "new_relationships": [], "new_plot_outcomes": [],
                    "new_dialogue_information": [], "new_locations": [], "new_key_props": [],
                },
                "source_evidence": [{"quote": "原文只说他留下联系方式。"}],
            }],
            "appearance_overlays": [],
        },
        "previous_state_out": empty_state(),
        "program_owned": {
            "speaker_target_refs": ["char_001"],
            "allowed_character_refs": ["char_001"],
            "allowed_prop_refs": ["prop_001"],
        },
    }


def test_director_v11_action_evidence_is_semantics_scoped_not_raw_description_or_audio():
    from runtime.stages.director import CONTRACT_VERSION, build_director_shot_payload

    payload = build_director_shot_payload(_director_context(), unit_id="director:SH001", is_first_global_shot=True)
    assert CONTRACT_VERSION == "director_shot.v18_0_2"
    anchors = payload["program_owned"]["current_shot_action_evidence"]
    assert "原文只说他留下联系方式。" in anchors
    assert "我回来了。" in anchors
    assert "这是基础分镜旧描述，不再作为 Director 动作证据。" not in anchors
    assert "走廊外传来脚步声。" not in anchors
    assert payload["production_semantics"]["visual_events"][0]["action"] == "甲把现有纸条放到桌面。"


def test_director_v11_keeps_v10_program_derived_state_contract():
    from runtime.stages.director import build_director_shot_payload

    payload = build_director_shot_payload(_director_context(), unit_id="director:SH001", is_first_global_shot=True)
    contract = payload["output_contract"]
    assert "state_out" not in contract["model_owned_fields"]
    assert "state_out" in contract["program_owned_fields"]
    assert "persistent end-of-shot changes" in contract["state"]


def test_context_builder_attaches_matching_production_semantics_without_mutating_base_shot():
    from runtime.context_builder import ContextBuilder

    story = {
        "characters": [{"character_id": "char_001"}],
        "props": [{"prop_id": "prop_001"}],
        "scenes": [{"scene_id": "scene_001"}],
        "narrative_contexts": [{"context_id": "context_001"}],
    }
    script = {"scenes": [{"scene_id": "SC001", "beats": [{"beat_id": "B001", "description": "甲行动", "dialogue": []}]}]}
    board = {"scenes": [{"scene_id": "SC001", "context_ref": "context_001", "location_ref": "scene_001", "shots": [{
        "shot_id": "SH001", "scene_id": "SC001", "beat_id": "B001", "character_refs": ["char_001"], "prop_refs": ["prop_001"],
        "description": "旧描述", "dialogue": [],
    }]}]}
    semantics = {"shot_id": "SH001", "context_ref": "context_001", "visual_events": [], "audio_events": [], "renderability_status": "renderable", "renderability_issues": [], "dialogue": [], "diegetic_text": [], "production_choices": [], "appearance_overlays": []}
    before = copy.deepcopy(board)
    ctx = ContextBuilder(story_bible=story, script=script, storyboard_base=board).director_context(
        "SH001", previous_state_out=empty_state(), production_semantics=semantics
    )
    assert ctx["production_semantics"] == semantics
    assert board == before
