from __future__ import annotations

import copy
import re
from typing import Any


_EMBEDDED_QUOTE_RE = re.compile(
    r"‘(?P<single>[^‘’\n]+)’|“(?P<double>[^“”\n]+)”|「(?P<corner>[^「」\n]+)」|『(?P<white_corner>[^『』\n]+)』|\"(?P<ascii_double>[^\"\n]+)\""
)


def _embedded_quote_candidates(line: str) -> list[dict[str, Any]]:
    """Extract exact inner quote text without assigning delivery semantics.

    Full-line wrappers are ignored: the candidate must be embedded inside the frozen
    dialogue item. Runtime owns candidate text; the model may only select indices.
    """
    text = line if isinstance(line, str) else ""
    out: list[dict[str, Any]] = []
    for match in _EMBEDDED_QUOTE_RE.finditer(text):
        if match.start() == 0 and match.end() == len(text):
            continue
        inner = next((value for value in match.groupdict().values() if value is not None), "")
        if not inner.strip():
            continue
        out.append({"quote_index": len(out), "text": inner})
    return out


class ContextBuilder:
    """Select minimal authoritative context for one semantic unit."""

    def __init__(self, *, story_bible: dict[str, Any], script: dict[str, Any] | None = None, storyboard_base: dict[str, Any] | None = None):
        self.story_bible = story_bible or {}
        self.script = script or {}
        self.storyboard_base = storyboard_base or {}
        self.characters = {str(x.get("character_id")): x for x in self.story_bible.get("characters", []) or [] if x.get("character_id")}
        self.props = {str(x.get("prop_id")): x for x in self.story_bible.get("props", []) or [] if x.get("prop_id")}
        self.scenes = {str(x.get("scene_id")): x for x in self.story_bible.get("scenes", []) or [] if x.get("scene_id")}
        self.contexts = {str(x.get("context_id")): x for x in self.story_bible.get("narrative_contexts", []) or [] if x.get("context_id")}

    def _script_beat(self, scene_id: str, beat_id: str) -> dict[str, Any]:
        for scene in self.script.get("scenes", []) or []:
            if scene.get("scene_id") != scene_id:
                continue
            for beat in scene.get("beats", []) or []:
                if beat.get("beat_id") == beat_id:
                    return copy.deepcopy(beat)
        return {}

    def _find_shot(self, shot_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
        for scene in self.storyboard_base.get("scenes", []) or []:
            for shot in scene.get("shots", []) or []:
                if shot.get("shot_id") == shot_id:
                    return scene, shot
        raise KeyError(f"unknown shot_id: {shot_id}")

    def _storyboard_scene(self, scene_id: str) -> dict[str, Any]:
        for scene in self.storyboard_base.get("scenes", []) or []:
            if str(scene.get("scene_id") or "") == scene_id:
                return copy.deepcopy(scene)
        raise KeyError(f"unknown scene_id: {scene_id}")

    def _script_scene(self, scene_id: str) -> dict[str, Any]:
        for scene in self.script.get("scenes", []) or []:
            if str(scene.get("scene_id") or "") == scene_id:
                return copy.deepcopy(scene)
        return {}

    def director_scene_context(
        self,
        scene_id: str,
        *,
        scene_plan: dict[str, Any],
        production_semantics: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Build the minimum sufficient, read-only Scene Director context."""
        storyboard_scene = self._storyboard_scene(scene_id)
        script_scene = self._script_scene(scene_id)
        location_ref = str(storyboard_scene.get("location_ref") or "")
        context_ref = str(storyboard_scene.get("context_ref") or "")

        allowed_shot_refs: list[str] = []
        allowed_beat_refs: list[str] = []
        allowed_character_refs: list[str] = []
        semantics_by_shot = {
            str(item.get("shot_id") or ""): item
            for item in production_semantics
            if isinstance(item, dict) and item.get("shot_id")
        }
        digest: list[dict[str, Any]] = []
        for shot in storyboard_scene.get("shots", []) or []:
            if not isinstance(shot, dict):
                continue
            shot_id = str(shot.get("shot_id") or "")
            beat_id = str(shot.get("beat_id") or "")
            if shot_id and shot_id not in allowed_shot_refs:
                allowed_shot_refs.append(shot_id)
            if beat_id and beat_id not in allowed_beat_refs:
                allowed_beat_refs.append(beat_id)
            for ref in shot.get("character_refs") or []:
                ref = str(ref)
                if ref and ref not in allowed_character_refs:
                    allowed_character_refs.append(ref)
            semantics = semantics_by_shot.get(shot_id, {})
            semantic_chars: list[str] = []
            for event in (semantics.get("visual_events") or []) if isinstance(semantics, dict) else []:
                if isinstance(event, dict):
                    for ref in event.get("character_refs") or []:
                        ref = str(ref)
                        if ref and ref not in semantic_chars:
                            semantic_chars.append(ref)
            dialogue_speakers: list[str] = []
            for line in (semantics.get("dialogue") or []) if isinstance(semantics, dict) else []:
                if isinstance(line, dict):
                    ref = str(line.get("character_id") or "")
                    if ref and ref not in dialogue_speakers:
                        dialogue_speakers.append(ref)
            visual_summary = [
                str(event.get("action") or "").strip()
                for event in (semantics.get("visual_events") or [])
                if isinstance(event, dict) and str(event.get("action") or "").strip()
            ] if isinstance(semantics, dict) else []
            digest.append({
                "shot_id": shot_id,
                "beat_id": beat_id,
                "character_refs": semantic_chars or [str(x) for x in shot.get("character_refs") or []],
                "dialogue_speaker_refs": dialogue_speakers,
                "visual_event_summary": visual_summary,
                "renderability_status": str(semantics.get("renderability_status") or "") if isinstance(semantics, dict) else "",
            })

        for beat in script_scene.get("beats", []) or []:
            if isinstance(beat, dict):
                beat_id = str(beat.get("beat_id") or "")
                if beat_id and beat_id not in allowed_beat_refs:
                    allowed_beat_refs.append(beat_id)
        for beat in scene_plan.get("beat_list", []) or []:
            if isinstance(beat, dict):
                beat_id = str(beat.get("beat_id") or "")
            else:
                beat_id = str(beat or "")
            if beat_id and beat_id not in allowed_beat_refs:
                allowed_beat_refs.append(beat_id)

        allowed_evidence_refs: list[dict[str, str]] = []
        def add_evidence(source_type: str, source_ref: str) -> None:
            if not source_ref:
                return
            item = {"source_type": source_type, "source_ref": source_ref}
            if item not in allowed_evidence_refs:
                allowed_evidence_refs.append(item)

        for beat_ref in allowed_beat_refs:
            add_evidence("scene_plan_beat", beat_ref)
            add_evidence("script_beat", beat_ref)
        for shot_ref in allowed_shot_refs:
            add_evidence("storyboard_shot", shot_ref)
            add_evidence("production_semantics_shot", shot_ref)
        for char_ref in allowed_character_refs:
            add_evidence("story_character", char_ref)
        add_evidence("story_context", context_ref)

        return {
            "scene": {
                "scene_id": scene_id,
                "location_ref": location_ref,
                "context_ref": context_ref,
            },
            "scene_plan": copy.deepcopy(scene_plan),
            "script_scene": script_scene,
            "storyboard_scene": storyboard_scene,
            "production_semantics_digest": digest,
            "assets": {
                "characters": {ref: copy.deepcopy(self.characters[ref]) for ref in allowed_character_refs if ref in self.characters},
                "scene": copy.deepcopy(self.scenes.get(location_ref, {})),
                "context": copy.deepcopy(self.contexts.get(context_ref, {})) if context_ref else {},
            },
            "program_owned": {
                "allowed_character_refs": allowed_character_refs,
                "allowed_beat_refs": allowed_beat_refs,
                "allowed_shot_refs": allowed_shot_refs,
                "allowed_evidence_refs": allowed_evidence_refs,
            },
        }


    def production_semantics_context(self, shot_id: str) -> dict[str, Any]:
        scene, shot = self._find_shot(shot_id)
        character_refs = [str(x) for x in shot.get("character_refs", []) or []]
        prop_refs = [str(x) for x in shot.get("prop_refs", []) or []]
        location_ref = str(scene.get("location_ref") or "")
        context_ref = str(scene.get("context_ref") or "")

        evidence: list[str] = []
        for item in shot.get("source_evidence", []) or []:
            if isinstance(item, dict) and isinstance(item.get("quote"), str) and item.get("quote", "").strip():
                quote = item["quote"].strip()
                if quote not in evidence:
                    evidence.append(quote)
        dialogue_pairs: list[dict[str, Any]] = []
        for line in shot.get("dialogue", []) or []:
            if not isinstance(line, dict):
                continue
            character_id = str(line.get("character_id") or "")
            text = str(line.get("line") or "").strip()
            if character_id and text:
                dialogue_pairs.append({
                    "character_id": character_id,
                    "line": text,
                    "embedded_quote_candidates": _embedded_quote_candidates(text),
                })
                if text not in evidence:
                    evidence.append(text)

        return {
            "shot": copy.deepcopy(shot),
            "context_ref": context_ref,
            "assets": {
                "characters": {ref: copy.deepcopy(self.characters[ref]) for ref in character_refs if ref in self.characters},
                "props": {ref: copy.deepcopy(self.props[ref]) for ref in prop_refs if ref in self.props},
                "scene": copy.deepcopy(self.scenes.get(location_ref, {})),
                "context": copy.deepcopy(self.contexts.get(context_ref, {})) if context_ref else {},
            },
            "program_owned": {
                "allowed_character_refs": character_refs,
                "allowed_prop_refs": prop_refs,
                "current_location_ref": location_ref,
                "current_narrative_context_ref": context_ref,
                # Provenance authority: exact upstream Script/Beat/dialogue evidence.
                # Keep this separate from the frozen Base Shot visual wording so
                # downstream stages cannot mistake a model-authored Shot description
                # for raw source evidence.
                "current_shot_evidence": evidence,
                # Visual semantic authority: the already-validated/frozen Base Shot
                # description. Production Semantics compiles visual_events from this
                # Shot-level authority while source_evidence continues to carry the
                # original Script provenance above.
                "current_shot_visual_authority": [str(shot.get("description") or "").strip()]
                if str(shot.get("description") or "").strip() else [],
                "dialogue_pairs": dialogue_pairs,
            },
        }

    def director_context(self, shot_id: str, *, previous_state_out: dict[str, Any], production_semantics: dict[str, Any] | None = None) -> dict[str, Any]:
        scene, shot = self._find_shot(shot_id)
        character_refs = [str(x) for x in shot.get("character_refs", []) or []]
        prop_refs = [str(x) for x in shot.get("prop_refs", []) or []]
        location_ref = str(scene.get("location_ref") or "")
        context_ref = str(scene.get("context_ref") or "")
        dialogue = shot.get("dialogue", []) or []
        speaker_refs: list[str] = []
        for line in dialogue:
            if isinstance(line, dict) and line.get("character_id") and line.get("character_id") not in speaker_refs:
                speaker_refs.append(str(line["character_id"]))
        semantics = copy.deepcopy(production_semantics or {})
        objective_visible_events: list[dict[str, Any]] = []
        for event in semantics.get("visual_events") or []:
            if not isinstance(event, dict):
                continue
            action = str(event.get("action") or "").strip()
            if not action:
                continue
            objective_visible_events.append({
                "action": action,
                "character_refs": [str(ref) for ref in event.get("character_refs") or []],
                "prop_refs": [str(ref) for ref in event.get("prop_refs") or []],
            })

        base_fact_constraints = {
            "scene_id": str(shot.get("scene_id") or scene.get("scene_id") or ""),
            "shot_id": str(shot.get("shot_id") or ""),
            "beat_id": str(shot.get("beat_id") or ""),
            "required_character_refs": character_refs,
            "required_prop_refs": prop_refs,
            "required_object_refs": [str(ref) for ref in shot.get("object_refs") or []],
            "objective_visible_events": objective_visible_events,
            "required_spatial_relation": str(shot.get("spatial_blocking") or ""),
            "dialogue_unit_refs": [str(ref) for ref in shot.get("dialogue_unit_refs") or []],
            "narration_unit_refs": [str(ref) for ref in shot.get("narration_unit_refs") or []],
            "source_evidence": copy.deepcopy(shot.get("source_evidence") or []),
        }
        base_execution_fallback = {
            "shot_size": shot.get("shot_size"),
            "camera": shot.get("camera"),
            "movement": shot.get("movement"),
        }
        if shot.get("framing_type"):
            base_execution_fallback["framing_type"] = shot.get("framing_type")

        return {
            "shot": copy.deepcopy(shot),
            "script_beat": self._script_beat(str(shot.get("scene_id") or scene.get("scene_id") or ""), str(shot.get("beat_id") or "")),
            "assets": {
                "characters": {ref: copy.deepcopy(self.characters[ref]) for ref in character_refs if ref in self.characters},
                "props": {ref: copy.deepcopy(self.props[ref]) for ref in prop_refs if ref in self.props},
                "scene": copy.deepcopy(self.scenes.get(location_ref, {})),
                "context": copy.deepcopy(self.contexts.get(context_ref, {})) if context_ref else {},
            },
            "production_semantics": semantics,
            "previous_state_out": copy.deepcopy(previous_state_out),
            "program_owned": {
                "speaker_target_refs": speaker_refs,
                "allowed_character_refs": character_refs,
                "allowed_prop_refs": prop_refs,
                "base_shot_fact_constraints": base_fact_constraints,
                "base_execution_fallback": base_execution_fallback,
            },
        }

    def character_context(self, character_id: str) -> dict[str, Any]:
        return {"character": copy.deepcopy(self.characters[character_id])}

    def scene_context(self, scene_id: str) -> dict[str, Any]:
        return {"scene": copy.deepcopy(self.scenes[scene_id])}
