from app.upstream_validation import (
    validate_scene_plan,
    validate_script,
    validate_storyboard_base,
)


def _story_bible():
    return {
        "characters": [{"character_id": "char_001", "role_type": "main"}],
        "scenes": [{"scene_id": "scene_001"}],
        "props": [{"prop_id": "prop_001"}],
        "narrative_contexts": [],
    }


def _scene_plan():
    return {
        "scenes": [{
            "scene_id": "SC001",
            "context_ref": "",
            "location_ref": "scene_001",
            "character_refs": ["char_001"],
            "prop_refs": ["prop_001"],
            "beat_list": [{"beat_id": "B001", "description": "x", "type": "setup"}],
        }]
    }


def test_scene_plan_rejects_unknown_location_ref():
    plan = _scene_plan()
    plan["scenes"][0]["location_ref"] = "scene_999"
    errors = validate_scene_plan(_story_bible(), plan)
    assert any(e["type"] == "unknown_location_ref" for e in errors)


def test_script_rejects_dialogue_speaker_not_in_story_bible():
    script = {
        "scenes": [{
            "scene_id": "SC001",
            "context_ref": "",
            "location_ref": "scene_001",
            "beats": [{
                "beat_id": "B001",
                "description": "x",
                "dialogue": [{"character_id": "char_999", "line": "hi"}],
            }],
        }]
    }
    errors = validate_script(_story_bible(), _scene_plan(), script)
    assert any(e["type"] == "unknown_dialogue_speaker" for e in errors)


def test_script_rejects_missing_beat():
    script = {"scenes": [{"scene_id": "SC001", "context_ref": "", "location_ref": "scene_001", "beats": []}]}
    errors = validate_script(_story_bible(), _scene_plan(), script)
    assert any(e["type"] == "missing_script_beat" for e in errors)


def test_storyboard_rejects_final_prompt_fields_and_missing_beat_coverage():
    storyboard = {
        "scenes": [{
            "scene_id": "SC001",
            "context_ref": "",
            "location_ref": "scene_001",
            "shots": [{
                "shot_id": "SH001",
                "scene_id": "SC001",
                "beat_id": "B999",
                "character_refs": ["char_001"],
                "prop_refs": [],
                "video_prompt": "legacy",
            }],
        }]
    }
    errors = validate_storyboard_base(_story_bible(), _scene_plan(), storyboard)
    kinds = {e["type"] for e in errors}
    assert "forbidden_final_prompt_field" in kinds
    assert "missing_storyboard_beat" in kinds


def test_script_rejects_dialogue_not_found_in_source_text():
    script = {
        "scenes": [{
            "scene_id": "SC001", "context_ref": "", "location_ref": "scene_001",
            "beats": [{"beat_id": "B001", "description": "x", "dialogue": [{"character_id": "char_001", "line": "原文没有这句话"}]}],
        }]
    }
    errors = validate_script(_story_bible(), _scene_plan(), script, source_text="这里只说了另一句话。")
    assert any(e["type"] == "dialogue_not_in_source" for e in errors)


def test_storyboard_base_requires_exact_script_dialogue_coverage_per_beat():
    script = {
        "scenes": [{
            "scene_id": "SC001", "context_ref": "", "location_ref": "scene_001",
            "beats": [{
                "beat_id": "B001", "description": "x",
                "dialogue": [
                    {"character_id": "char_001", "line": "第一句。"},
                    {"character_id": "char_001", "line": "第二句。"},
                ],
            }],
        }]
    }
    storyboard = {
        "scenes": [{
            "scene_id": "SC001", "context_ref": "", "location_ref": "scene_001",
            "shots": [{
                "shot_id": "SH001", "scene_id": "SC001", "beat_id": "B001",
                "character_refs": ["char_001"], "prop_refs": [],
                "dialogue": [{"character_id": "char_001", "line": "第一句。"}],
            }],
        }]
    }
    errors = validate_storyboard_base(_story_bible(), _scene_plan(), storyboard, script=script)
    assert any(e["type"] == "storyboard_dialogue_mismatch" for e in errors)
