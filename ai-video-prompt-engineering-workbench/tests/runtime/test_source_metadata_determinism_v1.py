from __future__ import annotations

from runtime.source_index import build_source_index, model_source_units, normalize_document_title
from runtime.stages.scene_plan import build_scene_plan_payload, canonicalize_scene_plan, validate_scene_plan_output
from runtime.stages.story_bible import build_story_bible_payload


def _minimal_story_bible() -> dict:
    return {
        "characters": [],
        "scenes": [{"scene_id": "scene_001", "canonical_name": "修鞋摊"}],
        "props": [],
        "narrative_contexts": [],
    }


def test_matching_explicit_project_title_is_audited_as_heading_but_excluded_from_story_inputs():
    source = "《钥匙》\n\n老周坐在修鞋摊前。"
    index = build_source_index(
        source,
        project_title="钥匙",
        title_is_explicit=True,
    )

    assert normalize_document_title("  《钥匙》  ") == "钥匙"
    assert [item["source_type"] for item in index] == ["document_heading", "narrative"]
    assert index[0]["text"] == "《钥匙》"
    assert [item["source_ref"] for item in model_source_units(source, project_title="钥匙", title_is_explicit=True, narrative_only=True)] == ["SRC0002"]

    story_payload = build_story_bible_payload(source, unit_id="story_bible:global", source_index=index)
    assert [item["source_ref"] for item in story_payload["source_index"]] == ["SRC0002"]
    assert story_payload["output_template"]["characters"][0]["source_evidence"][0]["source_refs"] == ["SRC0002"]

    story = _minimal_story_bible()
    plan_payload = build_scene_plan_payload(
        source,
        story,
        unit_id="scene_plan:global",
        source_index=index,
    )
    assert [item["source_ref"] for item in plan_payload["source_index"]] == ["SRC0002"]
    assert plan_payload["output_template"]["scenes"][0]["source_refs"] == ["SRC0002"]
    assert plan_payload["output_template"]["scenes"][0]["beat_list"][0]["source_refs"] == ["SRC0002"]

    # Coverage is computed over narrative refs only: the retained audit heading must
    # not become a hidden required Scene/Beat ref.
    candidate = {
        "scenes": [{
            "context_ref": "",
            "context_transition": "continue",
            "location_ref": "scene_001",
            "time": "",
            "character_refs": [],
            "prop_refs": [],
            "continuous_with_previous": False,
            "dramatic_goal": "",
            "conflict": "",
            "turning_point": "",
            "source_refs": ["SRC0002"],
            "beat_list": [{
                "description": "老周坐在修鞋摊前。",
                "type": "setup",
                "source_refs": ["SRC0002"],
            }],
        }],
    }
    canonical, _ = canonicalize_scene_plan(candidate, source_text=source, source_index=index, story_bible=story)
    assert validate_scene_plan_output(
        story,
        canonical,
        source_text=source,
        require_beat_provenance=True,
        source_index=index,
    ) == []


def test_ordinary_first_prose_line_is_narrative_and_is_not_removed():
    source = "雨停了\n甲推门出去。"
    index = build_source_index(
        source,
        project_title="钥匙",
        title_is_explicit=True,
    )
    assert all(item["source_type"] == "narrative" for item in index)
    assert [item["text"] for item in index] == ["雨停了", "甲推门出去。"]


def test_inline_or_uncertain_title_is_conservatively_retained_as_narrative():
    source = "钥匙 老周坐在修鞋摊前。"
    index = build_source_index(
        source,
        project_title="钥匙",
        title_is_explicit=True,
    )
    assert len(index) == 1
    assert index[0]["source_type"] == "narrative"
    assert index[0]["text"] == source
