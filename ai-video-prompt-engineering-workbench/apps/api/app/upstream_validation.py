from __future__ import annotations

import re
from typing import Any

PVB_IDENTITY_FIELDS = {"age_appearance", "face", "hair", "body", "skin"}
PVB_WARDROBE_FIELDS = {"default", "outerwear", "shirt", "footwear", "accessory"}
PSB_FIELDS = {"space", "layout", "materials", "lighting", "color", "environment"}
STYLE_FIELDS = {"era", "region", "genre", "tone", "visual_reference"}


def _error(errors: list[dict[str, Any]], etype: str, detail: str, **context: Any) -> None:
    item: dict[str, Any] = {"type": etype, "detail": detail}
    item.update(context)
    errors.append(item)


def _ids(items: list[dict] | None, key: str) -> set[str]:
    return {str(item.get(key)) for item in items or [] if item.get(key)}


def _duplicate_or_missing_ids(errors: list[dict[str, Any]], items: list[dict] | None, key: str, label: str) -> set[str]:
    seen: set[str] = set()
    for item in items or []:
        value = item.get(key)
        if not value:
            _error(errors, f"missing_{label}_id", f"{label} id is required")
        elif value in seen:
            _error(errors, f"duplicate_{label}_id", f"duplicate {label} id: {value}")
        else:
            seen.add(str(value))
    return seen


def validate_story_bible(story_bible: dict) -> list[dict]:
    errors: list[dict] = []
    _duplicate_or_missing_ids(errors, story_bible.get("characters"), "character_id", "character")
    _duplicate_or_missing_ids(errors, story_bible.get("scenes"), "scene_id", "scene")
    _duplicate_or_missing_ids(errors, story_bible.get("props"), "prop_id", "prop")
    _duplicate_or_missing_ids(errors, story_bible.get("narrative_contexts"), "context_id", "context")

    valid_roles = {"main", "supporting", "background", "referenced_only"}
    for char in story_bible.get("characters", []) or []:
        if char.get("role_type") not in valid_roles:
            _error(errors, "invalid_role_type", f"unsupported role_type: {char.get('role_type')}", character_id=char.get("character_id"))
    return errors


def _looks_like_multiple_contexts(value: Any) -> bool:
    if isinstance(value, (list, tuple, set, dict)):
        return True
    if not isinstance(value, str):
        return bool(value)
    text = value.strip()
    if not text:
        return False
    # Multiple explicit context tokens or common separators indicate an illegal multi-ref payload.
    tokens = re.findall(r"context_\d+", text)
    return len(tokens) > 1 or any(sep in text for sep in [",", "，", "/", "、", ";", "；"])


def validate_scene_plan(story_bible: dict, scene_plan: dict) -> list[dict]:
    errors: list[dict] = []
    sb_chars = _ids(story_bible.get("characters"), "character_id")
    sb_scenes = _ids(story_bible.get("scenes"), "scene_id")
    sb_props = _ids(story_bible.get("props"), "prop_id")
    contexts = _ids(story_bible.get("narrative_contexts"), "context_id")
    seen_scenes: set[str] = set()
    seen_beats: set[str] = set()
    for scene in scene_plan.get("scenes", []) or []:
        sid = scene.get("scene_id")
        if not sid:
            _error(errors, "missing_scene_plan_id", "scene_id is required")
        elif sid in seen_scenes:
            _error(errors, "duplicate_scene_plan_id", f"duplicate scene plan id: {sid}", scene_id=sid)
        else:
            seen_scenes.add(sid)
        if scene.get("location_ref") not in sb_scenes:
            _error(errors, "unknown_location_ref", f"unknown location_ref: {scene.get('location_ref')}", scene_id=sid)
        cref = scene.get("context_ref") or ""
        if _looks_like_multiple_contexts(scene.get("context_ref")):
            _error(errors, "multiple_context_refs", f"context_ref must contain exactly one context id or empty string: {scene.get('context_ref')}", scene_id=sid)
        elif cref and cref not in contexts:
            _error(errors, "unknown_context_ref", f"unknown context_ref: {cref}", scene_id=sid)
        for cid in scene.get("character_refs", []) or []:
            if cid not in sb_chars:
                _error(errors, "unknown_character_ref", f"unknown character_ref: {cid}", scene_id=sid)
        for pid in scene.get("prop_refs", []) or []:
            if pid not in sb_props:
                _error(errors, "unknown_prop_ref", f"unknown prop_ref: {pid}", scene_id=sid)
        for beat in scene.get("beat_list", []) or []:
            bid = beat.get("beat_id")
            if not bid:
                _error(errors, "missing_beat_id", "beat_id is required", scene_id=sid)
            elif bid in seen_beats:
                _error(errors, "duplicate_beat_id", f"duplicate beat id: {bid}", scene_id=sid)
            else:
                seen_beats.add(bid)
    return errors


def validate_script(story_bible: dict, scene_plan: dict, script: dict, source_text: str = "") -> list[dict]:
    errors: list[dict] = []
    sb_chars = _ids(story_bible.get("characters"), "character_id")
    plan_scenes = scene_plan.get("scenes", []) or []
    plan_by_scene = {s.get("scene_id"): s for s in plan_scenes if s.get("scene_id")}
    seen_script_scenes: set[str] = set()
    seen_script_beats: set[str] = set()
    script_by_scene: dict[str, dict] = {}

    for script_scene in script.get("scenes", []) or []:
        sid = script_scene.get("scene_id")
        if not sid:
            _error(errors, "missing_script_scene_id", "script scene_id is required")
            continue
        if sid in seen_script_scenes:
            _error(errors, "duplicate_script_scene_id", f"duplicate script scene id: {sid}", scene_id=sid)
        else:
            seen_script_scenes.add(sid)
            script_by_scene[sid] = script_scene
        plan_scene = plan_by_scene.get(sid)
        if not plan_scene:
            _error(errors, "unknown_script_scene", f"script contains scene not present in scene plan: {sid}", scene_id=sid)
            continue

        if script_scene.get("location_ref") != plan_scene.get("location_ref"):
            _error(errors, "script_location_mismatch", "script location_ref must match scene plan", scene_id=sid)
        if (script_scene.get("context_ref") or "") != (plan_scene.get("context_ref") or ""):
            _error(errors, "script_context_mismatch", "script context_ref must match scene plan", scene_id=sid)

        allowed_beats = {b.get("beat_id") for b in plan_scene.get("beat_list", []) or [] if b.get("beat_id")}
        local_seen: set[str] = set()
        for beat in script_scene.get("beats", []) or []:
            bid = beat.get("beat_id")
            if not bid:
                _error(errors, "missing_script_beat_id", "script beat_id is required", scene_id=sid)
                continue
            if bid in local_seen or bid in seen_script_beats:
                _error(errors, "duplicate_script_beat_id", f"duplicate script beat id: {bid}", scene_id=sid, beat_id=bid)
            local_seen.add(bid)
            seen_script_beats.add(bid)
            if bid not in allowed_beats:
                _error(errors, "unknown_script_beat", f"script beat not present in scene plan: {bid}", scene_id=sid, beat_id=bid)
            for line in beat.get("dialogue", []) or []:
                cid = line.get("character_id")
                if cid not in sb_chars:
                    _error(errors, "unknown_dialogue_speaker", f"unknown dialogue speaker: {cid}", scene_id=sid, beat_id=bid)
                line_text = str(line.get("line") or "").strip()
                if source_text and line_text and line_text not in source_text:
                    _error(errors, "dialogue_not_in_source", f"dialogue line not found verbatim in source: {line_text}", scene_id=sid, beat_id=bid, character_id=cid)

    for sid, plan_scene in plan_by_scene.items():
        script_scene = script_by_scene.get(sid)
        if not script_scene:
            _error(errors, "missing_script_scene", f"script missing scene {sid}", scene_id=sid)
            continue
        script_beat_ids = {b.get("beat_id") for b in script_scene.get("beats", []) or [] if b.get("beat_id")}
        for plan_beat in plan_scene.get("beat_list", []) or []:
            bid = plan_beat.get("beat_id")
            if bid not in script_beat_ids:
                _error(errors, "missing_script_beat", f"script missing beat {bid}", scene_id=sid, beat_id=bid)
    return errors


def validate_storyboard_base(story_bible: dict, scene_plan: dict, storyboard: dict, *, script: dict | None = None) -> list[dict]:
    errors: list[dict] = []
    sb_chars = _ids(story_bible.get("characters"), "character_id")
    sb_props = _ids(story_bible.get("props"), "prop_id")
    plan_by_scene = {s.get("scene_id"): s for s in scene_plan.get("scenes", []) or [] if s.get("scene_id")}
    covered: set[tuple[str, str]] = set()
    seen_board_scenes: set[str] = set()
    seen_shots: set[str] = set()
    forbidden = {"image_prompt", "video_prompt", "platform_prompt"}
    for scene in storyboard.get("scenes", []) or []:
        sid = scene.get("scene_id")
        if sid in seen_board_scenes:
            _error(errors, "duplicate_storyboard_scene_id", f"duplicate storyboard scene id: {sid}", scene_id=sid)
        seen_board_scenes.add(sid)
        plan_scene = plan_by_scene.get(sid)
        if not plan_scene:
            _error(errors, "unknown_storyboard_scene", f"unknown storyboard scene: {sid}", scene_id=sid)
            continue
        if scene.get("location_ref") != plan_scene.get("location_ref"):
            _error(errors, "storyboard_location_mismatch", "storyboard location_ref must match scene plan", scene_id=sid)
        if (scene.get("context_ref") or "") != (plan_scene.get("context_ref") or ""):
            _error(errors, "storyboard_context_mismatch", "storyboard context_ref must match scene plan", scene_id=sid)
        allowed_beats = {b.get("beat_id") for b in plan_scene.get("beat_list", []) or [] if b.get("beat_id")}
        for shot in scene.get("shots", []) or []:
            shot_id = shot.get("shot_id")
            if not shot_id:
                _error(errors, "missing_shot_id", "shot_id is required", scene_id=sid)
            elif shot_id in seen_shots:
                _error(errors, "duplicate_shot_id", f"duplicate shot id: {shot_id}", shot_id=shot_id)
            else:
                seen_shots.add(shot_id)
            for key in forbidden:
                if key in shot:
                    _error(errors, "forbidden_final_prompt_field", f"storyboard must not contain {key}", shot_id=shot_id, field=key)
            bid = shot.get("beat_id")
            if bid not in allowed_beats:
                _error(errors, "unknown_storyboard_beat", f"shot beat_id not present in parent scene plan: {bid}", scene_id=sid, shot_id=shot_id, beat_id=bid)
            else:
                covered.add((sid, bid))
            if shot.get("scene_id") != sid:
                _error(errors, "shot_scene_mismatch", "shot.scene_id must equal parent scene_id", shot_id=shot_id)
            for cid in shot.get("character_refs", []) or []:
                if cid not in sb_chars:
                    _error(errors, "unknown_shot_character_ref", f"unknown character_ref: {cid}", shot_id=shot_id)
            for pid in shot.get("prop_refs", []) or []:
                if pid not in sb_props:
                    _error(errors, "unknown_shot_prop_ref", f"unknown prop_ref: {pid}", shot_id=shot_id)
    for sid, scene in plan_by_scene.items():
        if sid not in seen_board_scenes:
            _error(errors, "missing_storyboard_scene", f"storyboard missing scene {sid}", scene_id=sid)
        for beat in scene.get("beat_list", []) or []:
            bid = beat.get("beat_id")
            if (sid, bid) not in covered:
                _error(errors, "missing_storyboard_beat", f"storyboard missing beat {sid}/{bid}", scene_id=sid, beat_id=bid)

    if script is not None:
        # Storyboard v16 allocates complete sentence-level Dialogue FrozenTextUnits.
        # The Script remains utterance authority, but one original utterance may span
        # consecutive Shots. The assembly gate must therefore compare against the same
        # deterministic semantic units as Stage 4 instead of legacy whole-line items.
        from runtime.stages.storyboard import build_frozen_text_units

        script_dialogue: dict[tuple[str, str], list[tuple[str, str]]] = {}
        for scene in script.get("scenes", []) or []:
            sid = scene.get("scene_id")
            frozen = build_frozen_text_units(scene)
            for beat in scene.get("beats", []) or []:
                bid = beat.get("beat_id")
                units = (frozen.get(str(bid)) or {}).get("dialogue") or []
                script_dialogue[(sid, bid)] = [
                    (str(unit.get("character_id")), str(unit.get("text")))
                    for unit in units
                    if isinstance(unit, dict) and unit.get("character_id") and unit.get("text") is not None
                ]

        board_dialogue: dict[tuple[str, str], list[tuple[str, str]]] = {}
        for scene in storyboard.get("scenes", []) or []:
            sid = scene.get("scene_id")
            for shot in scene.get("shots", []) or []:
                bid = shot.get("beat_id")
                key = (sid, bid)
                bucket = board_dialogue.setdefault(key, [])
                bucket.extend([
                    (str(item.get("character_id")), str(item.get("line")))
                    for item in (shot.get("dialogue") or [])
                    if isinstance(item, dict) and item.get("character_id") and item.get("line") is not None
                ])

        for key, expected in script_dialogue.items():
            actual = board_dialogue.get(key, [])
            if actual != expected:
                _error(
                    errors,
                    "storyboard_dialogue_mismatch",
                    f"storyboard dialogue must exactly reconstruct Script FrozenText semantic units: expected {expected}, got {actual}",
                    scene_id=key[0],
                    beat_id=key[1],
                )
    return errors


def validate_pvb_structure(story_bible: dict, pvb: dict) -> list[dict]:
    errors: list[dict] = []
    expected = {
        c.get("character_id")
        for c in story_bible.get("characters", []) or []
        if c.get("character_id") and c.get("role_type") in {"main", "supporting"}
    }
    seen: set[str] = set()
    for char in pvb.get("characters", []) or []:
        cid = char.get("character_id")
        if cid in seen:
            _error(errors, "duplicate_pvb_character", f"duplicate PVB character_id: {cid}", character_id=cid)
        seen.add(cid)
        if cid not in expected:
            _error(errors, "unknown_pvb_character", f"PVB character not eligible or unknown: {cid}", character_id=cid)
        identity = char.get("visual_identity") or {}
        wardrobe = char.get("wardrobe") or {}
        missing_identity = sorted(PVB_IDENTITY_FIELDS - set(identity))
        missing_wardrobe = sorted(PVB_WARDROBE_FIELDS - set(wardrobe))
        if missing_identity:
            _error(errors, "missing_pvb_identity_fields", f"missing visual_identity fields: {missing_identity}", character_id=cid)
        if missing_wardrobe:
            _error(errors, "missing_pvb_wardrobe_fields", f"missing wardrobe fields: {missing_wardrobe}", character_id=cid)
    for cid in sorted(expected - seen):
        _error(errors, "missing_pvb_character", f"PVB missing main/supporting character: {cid}", character_id=cid)
    return errors


def validate_psb_candidate(story_bible: dict, psb: dict) -> list[dict]:
    errors: list[dict] = []
    expected = _ids(story_bible.get("scenes"), "scene_id")
    story_by_id = {s.get("scene_id"): s for s in story_bible.get("scenes", []) or [] if s.get("scene_id")}
    seen: set[str] = set()
    for scene in psb.get("scenes", []) or []:
        sid = scene.get("scene_id")
        if sid in seen:
            _error(errors, "duplicate_psb_scene", f"duplicate PSB scene_id: {sid}", scene_id=sid)
        seen.add(sid)
        if sid not in expected:
            _error(errors, "unknown_psb_scene", f"PSB scene not in Story Bible: {sid}", scene_id=sid)
            continue
        production = scene.get("production_visual") or {}
        missing = sorted(PSB_FIELDS - set(production))
        extra = sorted(set(production) - PSB_FIELDS)
        if missing:
            _error(errors, "missing_psb_fields", f"missing PSB canonical fields: {missing}", scene_id=sid)
        if extra:
            _error(errors, "extra_psb_fields", f"unsupported PSB fields: {extra}", scene_id=sid)
        story_lock = (story_by_id.get(sid) or {}).get("visual_lock") or {}
        for field in PSB_FIELDS:
            entry = production.get(field)
            if not isinstance(entry, dict):
                continue
            status = entry.get("status")
            if status not in {"candidate", "skipped"}:
                _error(errors, "invalid_psb_status", f"PSB candidate field must be candidate or skipped: {status}", scene_id=sid, field=field)
            story_owns = story_lock.get(field) not in (None, "", [], {})
            if story_owns and status != "skipped":
                _error(errors, "story_owned_psb_field_must_be_skipped", "Story Bible owns this scene visual field; PSB must use skipped", scene_id=sid, field=field)
            if status == "skipped" and (entry.get("value") not in (None, "") or entry.get("source") not in (None, "")):
                _error(errors, "invalid_psb_skipped_payload", "skipped PSB field requires empty value/source", scene_id=sid, field=field)
            if status == "candidate" and (not entry.get("value") or entry.get("source") != "production_design"):
                _error(errors, "invalid_psb_candidate_payload", "candidate PSB field requires nonempty value and source=production_design", scene_id=sid, field=field)
    for sid in sorted(expected - seen):
        _error(errors, "missing_psb_scene", f"PSB missing Story Bible scene: {sid}", scene_id=sid)
    return errors


def validate_style_guide_candidate(style: dict) -> list[dict]:
    errors: list[dict] = []
    missing = sorted(STYLE_FIELDS - set(style))
    extra = sorted(set(style) - STYLE_FIELDS)
    if missing:
        _error(errors, "missing_style_fields", f"missing style fields: {missing}")
    if extra:
        _error(errors, "extra_style_fields", f"unsupported style fields: {extra}")
    for field in STYLE_FIELDS:
        entry = style.get(field)
        if not isinstance(entry, dict):
            continue
        if entry.get("status") != "candidate" or entry.get("source") != "production_design" or not entry.get("value"):
            _error(errors, "invalid_style_entry", "style candidate requires value/source=production_design/status=candidate", field=field)
    return errors
