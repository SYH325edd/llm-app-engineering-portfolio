from __future__ import annotations

from typing import Any


def _ordered(values: Any) -> list[str]:
    out: list[str] = []
    for value in values or []:
        text = str(value or "")
        if text and text not in out:
            out.append(text)
    return out


def _fallback_framing(program_owned: dict[str, Any]) -> str:
    base = program_owned.get("base_execution_fallback")
    if isinstance(base, dict) and str(base.get("framing_type") or ""):
        return str(base.get("framing_type") or "")
    facts = program_owned.get("base_shot_fact_constraints")
    facts = facts if isinstance(facts, dict) else {}
    chars = _ordered(facts.get("required_character_refs"))
    props = _ordered(facts.get("required_prop_refs"))
    if len(chars) >= 2:
        return "two_shot"
    if len(chars) == 1:
        return "single"
    if props:
        return "detail"
    return "environment"


def build_shot_context_effect_audit(
    shot: dict[str, Any],
    director: dict[str, Any],
    program_owned: dict[str, Any],
) -> dict[str, Any]:
    """Read-only v18.0_1 observer. Never participates in production decisions."""
    base = program_owned.get("base_execution_fallback")
    base = base if isinstance(base, dict) else {}
    facts = program_owned.get("base_shot_fact_constraints")
    facts = facts if isinstance(facts, dict) else {}
    execution = director.get("execution_shot_design")
    execution = execution if isinstance(execution, dict) else {}
    framing = director.get("execution_framing")
    framing = framing if isinstance(framing, dict) else {}
    visual_target = director.get("visual_target")
    visual_target = visual_target if isinstance(visual_target, dict) else {}

    base_chars = _ordered(facts.get("required_character_refs"))
    base_props = _ordered(facts.get("required_prop_refs"))
    primary_subjects = _ordered(director.get("primary_subject_refs"))
    target_chars = _ordered(visual_target.get("character_refs"))
    target_props = _ordered(visual_target.get("prop_refs"))

    # Dialogue ownership is program-owned Director input. Storyboard Shot may only
    # carry FrozenText unit refs and therefore cannot be the primary speaker source
    # for this audit. Keep the legacy shot.dialogue fallback for old fixtures only.
    dialogue_speakers = _ordered(program_owned.get("speaker_target_refs"))
    if not dialogue_speakers:
        dialogue_speakers = _ordered(
            item.get("character_id")
            for item in (shot.get("dialogue") or [])
            if isinstance(item, dict)
        )
    reaction_visualized: bool | None
    if not dialogue_speakers:
        reaction_visualized = None
    else:
        if "reaction_candidate_refs" in program_owned:
            # Current v18.0_2+ payloads carry the precision-first candidate set.
            # An empty set is meaningful ambiguity and must not be widened back to
            # every non-speaker, otherwise the audit can manufacture false reactions.
            reaction_targets = set(_ordered(program_owned.get("reaction_candidate_refs")))
        else:
            # Backward-compatible observer behavior for old fixtures/runs that predate
            # the runtime candidate field. Do not infer from allowed_character_refs.
            reaction_targets = set(_ordered(director.get("reaction_target_refs")))
        visible_subjects = set(primary_subjects) | set(target_chars)
        reaction_visualized = bool((visible_subjects - set(dialogue_speakers)) & reaction_targets)

    base_framing = _fallback_framing(program_owned)
    deltas = {
        "primary_subject_changed": bool(base_chars) and set(primary_subjects) != set(base_chars),
        "visual_target_changed": (
            (bool(base_chars) or bool(base_props))
            and (set(target_chars) != set(base_chars) or set(target_props) != set(base_props))
        ),
        "framing_changed": bool(base_framing) and str(framing.get("framing_type") or "") != base_framing,
        "shot_size_changed": bool(base.get("shot_size")) and str(execution.get("shot_size") or "") != str(base.get("shot_size") or ""),
        "camera_changed": bool(base.get("camera")) and str(execution.get("camera") or "") != str(base.get("camera") or ""),
        "movement_changed": bool(base.get("movement")) and str(execution.get("movement") or "") != str(base.get("movement") or ""),
    }
    reaction_candidates = _ordered(program_owned.get("reaction_candidate_refs"))
    return {
        "shot_id": str(shot.get("shot_id") or ""),
        "scene_position": str(director.get("scene_position") or ""),
        "scene_position_source": str(program_owned.get("scene_position_source") or "legacy_model"),
        "reaction_opportunity": bool(program_owned.get("reaction_opportunity")),
        "reaction_candidate_available": bool(reaction_candidates),
        "reaction_visualized": reaction_visualized,
        "base_execution_available": bool(base),
        "scene_context_usage_empty": not bool(director.get("scene_context_usage")),
        "base_to_execution_delta": deltas,
    }


def aggregate_scene_context_effect(
    scene_id: str,
    scene_context_status: str,
    audits: list[dict[str, Any]],
    *,
    phase_count: int,
) -> dict[str, Any]:
    delta_keys = (
        "primary_subject_changed", "visual_target_changed", "framing_changed",
        "shot_size_changed", "camera_changed", "movement_changed",
    )
    counts = {key: 0 for key in delta_keys}
    for audit in audits:
        delta = audit.get("base_to_execution_delta") if isinstance(audit.get("base_to_execution_delta"), dict) else {}
        for key in delta_keys:
            counts[key] += int(bool(delta.get(key)))
    return {
        "scene_id": scene_id,
        "scene_context_status": scene_context_status,
        "shot_count": len(audits),
        "phase_count": int(phase_count),
        "context_usage_empty_shots": [str(a.get("shot_id") or "") for a in audits if a.get("scene_context_usage_empty")],
        "reaction_opportunity_count": sum(1 for a in audits if a.get("reaction_opportunity")),
        "reaction_candidate_available_count": sum(1 for a in audits if a.get("reaction_candidate_available")),
        "reaction_visualized_count": sum(1 for a in audits if a.get("reaction_visualized") is True),
        "execution_delta": counts,
    }
