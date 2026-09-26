from __future__ import annotations

import copy
from typing import Any


def _pick(item: dict[str, Any], fields: tuple[str, ...]) -> dict[str, Any]:
    return {
        field: copy.deepcopy(item.get(field))
        for field in fields
        if item.get(field) not in (None, "", [], {})
    }


def project_character(item: dict[str, Any]) -> dict[str, Any]:
    """Authoritative character facts safe for downstream production models.

    inferred_facts and source_evidence intentionally stay out of the model payload:
    inference is advisory, while explicit/identity/visual locks are factual authority.
    """
    return _pick(item, (
        "character_id", "canonical_name", "aliases", "role_type",
        "explicit_facts", "identity_lock", "visual_lock",
    ))


def project_scene(item: dict[str, Any]) -> dict[str, Any]:
    return _pick(item, (
        "scene_id", "canonical_name", "name", "time", "weather",
        "explicit_facts", "visual_lock",
    ))


def project_prop(item: dict[str, Any]) -> dict[str, Any]:
    return _pick(item, (
        "prop_id", "canonical_name", "name", "aliases", "narrative_importance",
        "visual_presence", "visual_asset_required", "explicit_facts",
    ))


def project_context(item: dict[str, Any]) -> dict[str, Any]:
    return _pick(item, (
        "context_id", "reality_status", "temporal_mode", "representation_mode",
    ))


def project_story_bible(story: dict[str, Any]) -> dict[str, Any]:
    return {
        "characters": [project_character(x) for x in story.get("characters", []) or [] if isinstance(x, dict)],
        "scenes": [project_scene(x) for x in story.get("scenes", []) or [] if isinstance(x, dict)],
        "props": [project_prop(x) for x in story.get("props", []) or [] if isinstance(x, dict)],
        "narrative_contexts": [project_context(x) for x in story.get("narrative_contexts", []) or [] if isinstance(x, dict)],
    }
