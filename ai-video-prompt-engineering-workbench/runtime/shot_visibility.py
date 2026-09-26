from __future__ import annotations

from typing import Any


def visible_character_refs(
    shot: dict[str, Any],
    *,
    director: dict[str, Any] | None = None,
    state_in: dict[str, Any] | None = None,
    legacy_fallback: bool = True,
) -> list[str]:
    """Return the frozen Production Candidate definition of a visible character.

    Visible Character = primary_subject_refs U reaction_target_refs U characters
    with an explicit resolved ``position`` in spatial state. Merely being present
    in ``character_refs``, dialogue speakers, narration or asset context does not
    make a character visible.

    ``legacy_fallback`` exists only for pre-v16 checkpoints / isolated compiler
    fixtures that do not yet carry the visibility fields at all. Current Director
    outputs always carry them, so an explicitly empty visibility declaration stays
    empty rather than silently widening to every allowed character.
    """
    allowed = [str(x) for x in shot.get("character_refs", []) or [] if isinstance(x, str) and x]
    allowed_set = set(allowed)
    d = director if isinstance(director, dict) else (shot.get("director") if isinstance(shot.get("director"), dict) else {})

    has_visibility_contract = "primary_subject_refs" in d or "reaction_target_refs" in d
    visible: set[str] = set()
    for field in ("primary_subject_refs", "reaction_target_refs"):
        for ref in d.get(field, []) or []:
            if isinstance(ref, str) and ref in allowed_set:
                visible.add(ref)

    resolved_state = state_in if isinstance(state_in, dict) else (shot.get("state_in") if isinstance(shot.get("state_in"), dict) else {})
    char_state = resolved_state.get("characters") if isinstance(resolved_state.get("characters"), dict) else {}
    for ref in allowed:
        fields = char_state.get(ref) if isinstance(char_state.get(ref), dict) else {}
        if str(fields.get("position") or "").strip():
            visible.add(ref)

    if legacy_fallback and not has_visibility_contract and not visible:
        return allowed
    return [ref for ref in allowed if ref in visible]
