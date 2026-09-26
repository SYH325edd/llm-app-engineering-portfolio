from __future__ import annotations


def test_story_bible_normalizes_unambiguous_prop_boolean_representation():
    from runtime.stages.story_bible import canonicalize_story_bible

    candidate = {
        "characters": [],
        "scenes": [],
        "narrative_contexts": [],
        "props": [{"visual_asset_required": "false"}],
    }
    value, changes = canonicalize_story_bible(candidate, run_id="run_bool")
    assert changes >= 1
    assert value["props"][0]["visual_asset_required"] is False


def test_scene_plan_normalizes_unambiguous_continuity_representation():
    from runtime.stages.scene_plan import canonicalize_scene_plan

    candidate = {
        "scenes": [
            {"context_ref": "", "context_transition": "continue", "continuous_with_previous": False, "beat_list": []},
            {"context_ref": "", "context_transition": "continue", "continuous_with_previous": "true", "beat_list": []},
        ]
    }
    value, changes = canonicalize_scene_plan(candidate)
    assert changes >= 1
    assert value["scenes"][1]["continuous_with_previous"] is True


def test_storyboard_normalizes_unambiguous_continuity_representation():
    from runtime.stages.storyboard import canonicalize_storyboard_scene

    parent = {"scene_id": "SC001", "context_ref": "", "location_ref": "scene_001", "continuous_with_previous": False}
    candidate = {
        "shots": [
            {"continuity": {"continuous_with_previous": False}},
            {"continuity": {"continuous_with_previous": "true"}},
        ]
    }
    value, changes = canonicalize_storyboard_scene(parent, candidate)
    assert changes >= 1
    assert value["shots"][1]["continuity"]["continuous_with_previous"] is True
