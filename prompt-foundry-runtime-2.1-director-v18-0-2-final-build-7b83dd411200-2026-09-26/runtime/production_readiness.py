from __future__ import annotations

import hashlib
import re
from typing import Any

from .consumption_lint import estimate_min_duration
from .stages.storyboard import build_frozen_text_units
from .shot_visibility import visible_character_refs
from .director_execution_authority import performance_execution_hard_violations, performance_execution_unrecognized, dialogue_delivery_field_violations, dialogue_delivery_hard_violations
from .camera_grammar import framing_note_violations, framing_note_authority_violations

CONTRACT_VERSION = "production_readiness.v4_11"
_REQUIRED_PROMPT_FIELDS = (
    "镜号：", "时长：", "场景：", "人物空间站位：", "景别：", "摄法：", "人物视线：", "画面内容：",
    "旁白：", "台词：", "动作音效：", "环境音效：", "氛围音效：", "配乐：",
)
_CRITICAL_PERFORMANCE_PURPOSES = {"speaker", "reaction", "emotional_peak", "reveal", "action"}

_NON_AUDIBLE_AUDIO_RE = re.compile(r"(?:气味|味道|香味|臭味|[\u4e00-\u9fff]{1,6}味(?=(?:混|散|弥|飘|在|，|,|；|;|。|$))|灰尘(?:弥漫|飘散|在空气)|颜色|色调|光线|明暗|视觉质感)")


def _norm_render_text(value: Any) -> str:
    return re.sub(r"[\s，,。；;：:（）()‘’“”\"']", "", str(value or ""))


def _surface_contains(rendered: Any, source_value: Any) -> bool:
    """Exact-enough legacy defense check for non-authoritative text."""
    needle = _norm_render_text(source_value)
    haystack = _norm_render_text(rendered)
    return bool(needle) and needle in haystack


def _modifier_trace_contains(
    manifest: dict[str, Any], *, source: str, index: int, field: str, value: Any
) -> bool | None:
    """Return source-specific render provenance when compiler trace is available.

    v17.9 readiness searched the aggregate gaze/performance/dialogue strings. If
    the same wording was independently rendered by a different legal channel, an
    unsafe optional modifier could be falsely reported as leaked.  The v2k
    compiler records the exact filtered modifier fields that contributed to the
    final manifest, so readiness can verify provenance instead of guessing from
    string coincidence. ``None`` keeps a defense-in-depth fallback for legacy
    manifests that predate modifier_trace.v1.
    """
    provenance = manifest.get("provenance") if isinstance(manifest.get("provenance"), dict) else {}
    if provenance.get("rendered_modifier_trace_version") != "modifier_trace.v1":
        return None
    trace = provenance.get("rendered_modifier_trace")
    if not isinstance(trace, list):
        return None
    expected = _norm_render_text(value)
    return any(
        isinstance(item, dict)
        and str(item.get("source") or "") == source
        and item.get("index") == index
        and str(item.get("field") or "") == field
        and _norm_render_text(item.get("value")) == expected
        for item in trace
    )


def _modifier_trace_value_attributed(manifest: dict[str, Any], value: Any) -> bool | None:
    """Return whether any filtered modifier legally rendered the same text value."""
    provenance = manifest.get("provenance") if isinstance(manifest.get("provenance"), dict) else {}
    if provenance.get("rendered_modifier_trace_version") != "modifier_trace.v1":
        return None
    trace = provenance.get("rendered_modifier_trace")
    if not isinstance(trace, list):
        return None
    expected = _norm_render_text(value)
    return bool(expected) and any(
        isinstance(item, dict) and _norm_render_text(item.get("value")) == expected
        for item in trace
    )


def _unsafe_modifier_leaked(
    manifest: dict[str, Any], *, source: str, index: int, field: str, value: Any, rendered_surface: Any
) -> bool:
    """Distinguish real unsafe leakage from same-wording legal render sources.

    If source-specific trace exists, an exact unsafe-source match is a leak.  If
    aggregate rendered text contains the same wording but another legal traced
    modifier owns that wording, it is not a leak.  Conversely, text that appears
    in the final manifest with no trace attribution is treated as corruption and
    remains a hard readiness failure. Legacy manifests fall back to surface text.
    """
    exact = _modifier_trace_contains(
        manifest, source=source, index=index, field=field, value=value
    )
    if exact is None:
        # Legacy manifests predate source trace; preserve the old conservative
        # fallback only for those artifacts. Compiler v2m+ always emits trace.
        return _surface_contains(rendered_surface, value)
    # With source provenance available, only this exact unsafe source can prove
    # leakage. Aggregate text coincidence is not evidence of ownership.
    return bool(exact)

def _rendered_surface_integrity_errors(spec: dict[str, Any], manifest: dict[str, Any]) -> list[dict[str, Any]]:
    """Hard-fail only real post-compile mutation of compiler-owned surfaces.

    Normal v2m readiness never infers modifier ownership from aggregate text.
    Surface hashes first prove that a compiler-owned field changed after
    sanitization. Only inside that proven-corruption branch do we classify an
    injected rejected modifier as E028/E029; otherwise the failure is a generic
    manifest-integrity error.
    """
    provenance = manifest.get("provenance") if isinstance(manifest.get("provenance"), dict) else {}
    if provenance.get("rendered_surface_fingerprint_version") != "surface_hash.v1":
        return []
    fingerprints = provenance.get("rendered_surface_fingerprints")
    if not isinstance(fingerprints, dict):
        return []
    shot_id = str(spec.get("shot_id") or "")
    director = spec.get("director") if isinstance(spec.get("director"), dict) else {}
    execution_authorities = list(provenance.get("performance_execution_authority") or [])
    allowed_entities = list(provenance.get("camera_allowed_entity_terms") or [])
    out: list[dict[str, Any]] = []

    for surface_field in ("gaze", "performance_text", "dialogue"):
        expected = str(fingerprints.get(surface_field) or "")
        if not expected:
            continue
        rendered_surface = str(manifest.get(surface_field) or "")
        actual = hashlib.sha256(rendered_surface.encode("utf-8")).hexdigest()
        if actual == expected:
            continue

        classified = False
        for execution_item in director.get("performance_execution") or []:
            if not isinstance(execution_item, dict):
                continue
            fields = ("gaze",) if surface_field == "gaze" else (
                ("expression", "breathing", "body", "hands", "movement", "micro_reaction", "action_transition", "end_state")
                if surface_field == "performance_text" else ()
            )
            for field in fields:
                value = str(execution_item.get(field) or "").strip()
                if not value:
                    continue
                violations = performance_execution_hard_violations(
                    field, value, execution_authorities, allowed_entity_terms=allowed_entities
                )
                if violations and _surface_contains(rendered_surface, value):
                    out.append({
                        "type": "E028_DIRECTOR_EXECUTION_AUTHORITY",
                        "shot_id": shot_id,
                        "field": field,
                        "detail": "rejected non-authoritative performance_execution appeared after compiler-owned surface mutation",
                        "authority_violations": violations,
                    })
                    classified = True

        for delivery_item in director.get("dialogue_delivery") or []:
            if not isinstance(delivery_item, dict):
                continue
            fields = ("gaze_during_line",) if surface_field == "gaze" else (
                ("emotion", "volume", "pace", "pause", "delivery") if surface_field == "dialogue" else ()
            )
            for field in fields:
                value = str(delivery_item.get(field) or "").strip()
                if not value:
                    continue
                violations = dialogue_delivery_hard_violations(
                    field, value, allowed_entity_terms=allowed_entities
                )
                if violations and _surface_contains(rendered_surface, value):
                    out.append({
                        "type": "E029_DIALOGUE_DELIVERY_AUTHORITY",
                        "shot_id": shot_id,
                        "field": field,
                        "detail": "rejected non-authoritative dialogue_delivery appeared after compiler-owned surface mutation",
                        "delivery_violations": violations,
                    })
                    classified = True

        if not classified:
            out.append({
                "type": "rendered_manifest_integrity_mismatch",
                "shot_id": shot_id,
                "field": surface_field,
                "detail": f"compiler-owned rendered surface '{surface_field}' changed after sanitization/rendering",
            })
    return out


def _v17_final_semantic_errors(spec: dict[str, Any], manifest: dict[str, Any]) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    shot_id = str(spec.get("shot_id") or "")
    director = spec.get("director") if isinstance(spec.get("director"), dict) else {}
    purpose = str(director.get("shot_purpose") or "")
    signal_count = int(manifest.get("performance_execution_signal_count") or 0)
    performance_text = str(manifest.get("performance_text") or "").strip()
    performance_source = str(manifest.get("performance_source") or "")
    density = str(manifest.get("performance_density") or "")
    visible_count = len(visible_character_refs(spec))
    objective_actions = [
        x for x in director.get("performance_actions", []) or []
        if isinstance(x, dict) and str(x.get("action") or "").strip()
    ]
    executable = bool(performance_text) and (
        signal_count > 0
        or bool(objective_actions)
        or performance_source in {"production_semantics", "storyboard_explicit_action", "director"}
    )

    camera = str(manifest.get("camera") or "")
    # Only the v17 free-form framing note is subject to the hard ownership gate.
    # Camera labels such as '反应镜头' remain legal deterministic camera grammar.
    if "构图：" in camera:
        note = camera.split("构图：", 1)[1]
        grammar_violations = framing_note_violations(note)
        provenance = manifest.get("provenance") if isinstance(manifest.get("provenance"), dict) else {}
        authority_violations = framing_note_authority_violations(
            note,
            authority_texts=list(provenance.get("camera_framing_authority") or []),
            allowed_entity_terms=list(provenance.get("camera_allowed_entity_terms") or []),
        )
        if grammar_violations:
            errors.append({
                "type": "E027_CAMERA_FIELD_OWNERSHIP", "shot_id": shot_id,
                "detail": "camera/framing contains deterministic ownership leakage such as dialogue, performance action, psychology or scene lighting",
                "camera_grammar_violations": grammar_violations,
                "camera_authority_violations": authority_violations,
            })

    provenance = manifest.get("provenance") if isinstance(manifest.get("provenance"), dict) else {}
    execution_authorities = list(provenance.get("performance_execution_authority") or [])
    allowed_entities = list(provenance.get("camera_allowed_entity_terms") or [])
    for index, execution_item in enumerate(director.get("performance_execution") or []):
        if not isinstance(execution_item, dict):
            continue
        for field in ("expression", "gaze", "breathing", "body", "hands", "movement", "micro_reaction", "action_transition", "end_state"):
            value = str(execution_item.get(field) or "").strip()
            if not value:
                continue
            violations = performance_execution_hard_violations(
                field, value, execution_authorities, allowed_entity_terms=allowed_entities
            )
            if not violations:
                continue
            rendered_surface = manifest.get("gaze") if field == "gaze" else manifest.get("performance_text")
            leaked = _unsafe_modifier_leaked(
                manifest, source="performance_execution", index=index, field=field,
                value=value, rendered_surface=rendered_surface,
            )
            if leaked:
                # Defense-in-depth only: normal v2k compilation filters this
                # field. Source-specific trace avoids blaming another legal
                # modifier that happens to use identical wording.
                errors.append({
                    "type": "E028_DIRECTOR_EXECUTION_AUTHORITY", "shot_id": shot_id, "field": field,
                    "detail": "unsafe non-authoritative performance_execution leaked into the rendered manifest",
                    "authority_violations": violations,
                })
    for index, delivery_item in enumerate(director.get("dialogue_delivery") or []):
        if not isinstance(delivery_item, dict):
            continue
        for field in ("emotion", "volume", "pace", "pause", "delivery", "gaze_during_line"):
            value = str(delivery_item.get(field) or "").strip()
            if not value:
                continue
            violations = dialogue_delivery_hard_violations(field, value, allowed_entity_terms=allowed_entities)
            if not violations:
                continue
            rendered_surface = manifest.get("gaze") if field == "gaze_during_line" else manifest.get("dialogue")
            leaked = _unsafe_modifier_leaked(
                manifest, source="dialogue_delivery", index=index, field=field,
                value=value, rendered_surface=rendered_surface,
            )
            if leaked:
                errors.append({
                    "type": "E029_DIALOGUE_DELIVERY_AUTHORITY", "shot_id": shot_id, "field": field,
                    "detail": "unsafe non-authoritative dialogue_delivery leaked into the rendered manifest",
                    "delivery_violations": violations,
                })

    for field in ("action_sfx", "environment_sfx", "atmosphere_sfx"):
        value = str(manifest.get(field) or "")
        if value and value != "无" and _NON_AUDIBLE_AUDIO_RE.search(value):
            errors.append({
                "type": "E024_NON_AUDIBLE_AUDIO_CONTENT", "shot_id": shot_id, "field": field,
                "detail": f"audio track contains non-audible visual/olfactory content: {value}",
            })
    return errors



_TRANSITION_HINT_RE = re.compile(r"(?:随后|接着|然后|转而|改为|停住|顿住|突然|下一秒|紧接着|从.+到|→)")
_ABSTRACT_PERFORMANCE_RE = re.compile(r"(?:压迫感|破碎感|宿命感|复杂情绪|内心|心理|心碎|绝望|愤怒|伤心|心死|控制欲)")

def _v17_final_semantic_warnings(spec: dict[str, Any], manifest: dict[str, Any], item: dict[str, Any]) -> list[dict[str, Any]]:
    warnings: list[dict[str, Any]] = []
    shot_id = str(spec.get("shot_id") or "")
    director = spec.get("director") if isinstance(spec.get("director"), dict) else {}
    signal_count = int(manifest.get("performance_execution_signal_count") or 0)
    performance_text = str(manifest.get("performance_text") or "")

    if director.get("performance_logic") and signal_count == 0 and _ABSTRACT_PERFORMANCE_RE.search(performance_text):
        warnings.append({
            "type": "W012_PERFORMANCE_TOO_ABSTRACT", "shot_id": shot_id,
            "detail": "rendered performance contains interpretation/emotion language without a v17 visible execution signal",
        })

    has_transition = any(
        isinstance(x, dict) and str(x.get("action_transition") or "").strip()
        for x in director.get("performance_execution", []) or []
    )
    multi_step = any(
        isinstance(x, dict) and ("；" in str(x.get("action") or "") or _TRANSITION_HINT_RE.search(str(x.get("action") or "")))
        for x in director.get("performance_actions", []) or []
    )
    if multi_step and not has_transition:
        warnings.append({
            "type": "W013_ACTION_TRANSITION_MISSING", "shot_id": shot_id,
            "detail": "multi-step objective action exists but no explicit v17 action_transition was rendered",
        })

    visible_count = len(visible_character_refs(spec))
    purpose = str(director.get("shot_purpose") or "")
    action_count = len([x for x in director.get("performance_actions", []) or [] if isinstance(x, dict)])
    density = str(manifest.get("performance_density") or "")
    if density not in {"low", "medium", "high"}:
        if purpose in {"action", "emotional_peak", "reveal"} or action_count >= 2:
            density = "high"
        elif purpose in {"speaker", "reaction"} or visible_count >= 2 or director.get("performance_execution"):
            density = "medium"
        else:
            density = "low"
    executable = bool(performance_text) and (
        signal_count > 0
        or action_count > 0
        or str(manifest.get("performance_source") or "") in {"production_semantics", "storyboard_explicit_action", "director"}
    )
    if visible_count and density == "high" and signal_count == 0:
        warnings.append({
            "type": "W027_PERFORMANCE_NOT_EXECUTABLE", "shot_id": shot_id,
            "detail": "high-density character shot has no additional visible/audible performance_execution signal; keep as director quality warning and continue compile",
        })
    elif purpose in _CRITICAL_PERFORMANCE_PURPOSES and not executable:
        warnings.append({
            "type": "W027_PERFORMANCE_NOT_EXECUTABLE", "shot_id": shot_id,
            "detail": "critical narrative shot has no explicit executable performance signal; keep as director quality warning and continue compile",
        })

    ranges = {"low": (0, 3), "medium": (1, 5), "high": (3, 9)}
    low, high = ranges[density]
    should_check_density = bool(visible_count) and (density in {"medium", "high"} or bool(director.get("performance_execution")))
    if should_check_density and not (low <= signal_count <= high):
        warnings.append({
            "type": "W014_PERFORMANCE_DENSITY_MISMATCH", "shot_id": shot_id,
            "detail": f"final performance density={density}, visible execution signals={signal_count}, expected={low}..{high}",
        })

    for warning in item.get("warnings", []) or []:
        if isinstance(warning, dict) and warning.get("code") == "W015_PERFORMANCE_BUDGET_HIGH":
            warnings.append({
                "type": "W015_PERFORMANCE_BUDGET_HIGH", "shot_id": shot_id,
                "detail": str(warning.get("detail") or "Director performance budget is high"),
            })

    provenance = manifest.get("provenance") if isinstance(manifest.get("provenance"), dict) else {}
    execution_authorities = list(provenance.get("performance_execution_authority") or [])
    allowed_entities = list(provenance.get("camera_allowed_entity_terms") or [])
    for index, execution_item in enumerate(director.get("performance_execution") or []):
        if not isinstance(execution_item, dict):
            continue
        for field in ("expression", "gaze", "breathing", "body", "hands", "movement", "micro_reaction", "action_transition", "end_state"):
            value = str(execution_item.get(field) or "").strip()
            if value and performance_execution_unrecognized(
                field, value, execution_authorities, allowed_entity_terms=allowed_entities
            ):
                warnings.append({
                    "type": "W022_PERFORMANCE_EXECUTION_GRAMMAR_UNRECOGNIZED",
                    "shot_id": shot_id,
                    "field": field,
                    "detail": "natural acting wording is outside the current positive modulation grammar; no objective story/authority leakage was detected",
                })

    # v17.8 mirrors the framing_note rule: unsafe optional execution/delivery
    # prose is visible as a quality warning, while the compiler omits it.
    for execution_index, execution_item in enumerate(director.get("performance_execution") or []):
        if not isinstance(execution_item, dict):
            continue
        for field in ("expression", "gaze", "breathing", "body", "hands", "movement", "micro_reaction", "action_transition", "end_state"):
            value = str(execution_item.get(field) or "").strip()
            if not value:
                continue
            violations = performance_execution_hard_violations(
                field, value, execution_authorities, allowed_entity_terms=allowed_entities
            )
            if violations:
                rendered_surface = manifest.get("gaze") if field == "gaze" else manifest.get("performance_text")
                traced = _modifier_trace_contains(
                    manifest, source="performance_execution", index=execution_index, field=field, value=value
                )
                rendered_by_source = traced if traced is not None else _surface_contains(rendered_surface, value)
                if not rendered_by_source:
                    warnings.append({
                        "type": "W024_PERFORMANCE_EXECUTION_DROPPED_UNSAFE",
                        "shot_id": shot_id, "field": field,
                        "detail": "unsafe non-authoritative performance_execution was omitted from final rendering",
                        "authority_violations": violations,
                    })

    for delivery_index, delivery_item in enumerate(director.get("dialogue_delivery") or []):
        if not isinstance(delivery_item, dict):
            continue
        for field in ("emotion", "volume", "pace", "pause", "delivery", "gaze_during_line"):
            value = str(delivery_item.get(field) or "").strip()
            if not value:
                continue
            violations = dialogue_delivery_hard_violations(field, value, allowed_entity_terms=allowed_entities)
            if violations:
                rendered_surface = manifest.get("gaze") if field == "gaze_during_line" else manifest.get("dialogue")
                traced = _modifier_trace_contains(
                    manifest, source="dialogue_delivery", index=delivery_index, field=field, value=value
                )
                rendered_by_source = traced if traced is not None else _surface_contains(rendered_surface, value)
                if not rendered_by_source:
                    warnings.append({
                        "type": "W025_DIALOGUE_DELIVERY_DROPPED_UNSAFE",
                        "shot_id": shot_id, "field": field,
                        "detail": "unsafe non-authoritative dialogue_delivery was omitted from final rendering",
                        "delivery_violations": violations,
                    })

    camera_execution = director.get("camera_execution") if isinstance(director.get("camera_execution"), dict) else {}
    framing_note = str(camera_execution.get("framing_note") or "").strip()
    if framing_note:
        grammar_violations = framing_note_violations(framing_note)
        authority_violations = framing_note_authority_violations(
            framing_note,
            authority_texts=list(provenance.get("camera_framing_authority") or []),
            allowed_entity_terms=allowed_entities,
        )
        if grammar_violations:
            warnings.append({
                "type": "W023_CAMERA_NOTE_DROPPED_UNSAFE",
                "shot_id": shot_id,
                "detail": "non-authoritative framing_note contains non-camera semantics and is omitted from final camera rendering",
                "camera_grammar_violations": grammar_violations,
            })
        if authority_violations:
            warnings.append({
                "type": "W021_CAMERA_NOTE_AUTHORITY_UNRESOLVED",
                "shot_id": shot_id,
                "detail": "free-text framing_note contains entity/fact wording not proven by structured current-shot authority; the note is omitted from final camera rendering",
                "camera_authority_violations": authority_violations,
            })
    return warnings

def _norm_clause(value: str) -> str:
    return re.sub(r"[\s，,。；;：:]", "", str(value or ""))


def _duplicate_clause(value: str) -> str | None:
    clauses = [x.strip() for x in re.split(r"[；;。]", str(value or "")) if x.strip()]
    seen: set[str] = set()
    for clause in clauses:
        key = _norm_clause(clause)
        if key and key in seen:
            return clause
        if key:
            seen.add(key)
    return None


def _prompt_field_errors(prompt: str, shot_id: str, manifest: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    lines = str(prompt or "").splitlines()
    field_names = [line.split("：", 1)[0] + "：" for line in lines if "：" in line]
    expected = list(_REQUIRED_PROMPT_FIELDS)
    if len(lines) != len(expected) or field_names != expected:
        return [{
            "type": "E022_RENDERED_PROMPT_IR_LEAKAGE",
            "shot_id": shot_id,
            "detail": f"final prompt top-level fields must exactly match the 14-field production whitelist; got {field_names}",
        }]

    manifest = manifest if isinstance(manifest, dict) else {}
    visual = str(manifest.get("visual_content") or "")
    # Inline labels inside 画面内容 are also renderer-owned structure. Character
    # canonical names plus the three public visual labels are the only legal ones.
    allowed_inline = {"场景状态", "整体视觉基调", "画面内文字"}
    char_anchor = str(manifest.get("character_continuity_anchor") or "")
    for chunk in re.split(r"[；;]", char_anchor):
        if "：" in chunk:
            label = chunk.split("：", 1)[0].strip()
            if label:
                allowed_inline.add(label)
    inline_labels = [
        m.group(1).strip()
        for m in re.finditer(r"(?:^|[。；;])([^：。；;\n]{1,16})：", visual)
    ]
    unknown = [label for label in inline_labels if label not in allowed_inline]
    if unknown:
        return [{
            "type": "E022_RENDERED_PROMPT_IR_LEAKAGE",
            "shot_id": shot_id,
            "detail": f"final prompt visual_content contains non-public inline label(s): {unknown}",
        }]
    return []


def _shot_self_contained_error(spec: dict[str, Any], manifest: dict[str, Any]) -> dict[str, Any] | None:
    shot_id = str(spec.get("shot_id") or "")
    required_checks = (
        ("scene identity", str(manifest.get("scene") or "").strip()),
        ("shot framing", str(manifest.get("shot_size") or "").strip()),
        ("camera instruction", str(manifest.get("camera") or "").strip()),
        ("shot-specific visual/action content", str(manifest.get("visual_content") or "").strip() and (str(manifest.get("performance_text") or "").strip() or str(manifest.get("spatial_blocking") or "").strip())),
    )
    for label, value in required_checks:
        if not value:
            return {"type": "E023_SHOT_NOT_SELF_CONTAINED", "shot_id": shot_id, "detail": f"required self-contained item missing: {label}"}

    visible_refs = visible_character_refs(spec)
    if visible_refs and not str(manifest.get("character_continuity_anchor") or "").strip():
        return {
            "type": "E023_SHOT_NOT_SELF_CONTAINED",
            "shot_id": shot_id,
            "source_layer": "PVB Canonical Asset Registry",
            "target_character_refs": visible_refs,
            "detail": "visible characters require at least one canonical identity anchor",
        }

    authoritative_time = str(spec.get("authoritative_scene_time") or "").strip()
    if authoritative_time and not str(manifest.get("scene_state_anchor") or "").strip():
        return {"type": "E023_SHOT_NOT_SELF_CONTAINED", "shot_id": shot_id, "detail": "authoritative scene time exists but effective scene state was not rendered"}

    rendered_dialogue = str(manifest.get("dialogue") or "")
    for item in spec.get("dialogue", []) or []:
        if isinstance(item, dict):
            line = str(item.get("line") or item.get("text") or "")
            if line and line not in rendered_dialogue:
                return {"type": "E023_SHOT_NOT_SELF_CONTAINED", "shot_id": shot_id, "detail": "dialogue text did not survive final prompt compilation exactly"}
    rendered_narration = str(manifest.get("narration") or "")
    raw_narration = spec.get("narration")
    expected_narration = "".join(str(x) for x in raw_narration if isinstance(x, str)) if isinstance(raw_narration, list) else (str(raw_narration or "") if raw_narration else "")
    if expected_narration and expected_narration not in rendered_narration:
        return {"type": "E023_SHOT_NOT_SELF_CONTAINED", "shot_id": shot_id, "detail": "narration text did not survive final prompt compilation exactly"}
    return None

def _norm_dialogue(value: str) -> str:
    return re.sub(r"[\\s，,。！？!?；;：:'‘’“”\"-]", "", str(value or ""))


def _visual_contains_exact_dialogue(visual: str, line: str) -> bool:
    """Return True only when the visual surface actually repeats the utterance.

    A raw substring check produces false positives for very short Chinese lines
    such as “好” inside unrelated words like “良好”. Exact repetition means one
    of: an exact quoted span, a standalone visual clause, an explicit speech
    construction ending in the frozen line, or a sufficiently long literal line
    copied into the visual track.
    """
    raw_visual = str(visual or "")
    raw_line = str(line or "").strip().strip('“”"\'')
    line_norm = _norm_dialogue(raw_line)
    if not raw_visual or not line_norm:
        return False

    quoted_spans = re.findall(r'[“"‘]([^”"’]+)[”"’]', raw_visual)
    if line_norm in {_norm_dialogue(x) for x in quoted_spans if _norm_dialogue(x)}:
        return True

    # Long literal utterances are specific enough that a direct copy is itself
    # meaningful evidence of channel duplication.
    if len(line_norm) >= 4 and raw_line and raw_line in raw_visual:
        return True

    speech_re = re.compile(r"(?:说|说道|说出|问|问道|询问|回答|回应|开口|追问|反问|低声说|轻声说)")
    clauses = [x.strip() for x in re.split(r"[。；;\n]", raw_visual) if x.strip()]
    for clause in clauses:
        clause_norm = _norm_dialogue(clause)
        if clause_norm == line_norm:
            return True
        if clause_norm.endswith(line_norm):
            prefix = clause_norm[: -len(line_norm)]
            if prefix and speech_re.search(clause):
                return True
    return False


def _asset_prompt_hygiene_errors(compiled_project: dict[str, Any]) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    for kind, key, id_key in (("character", "character_prompts", "character_id"), ("scene", "scene_prompts", "scene_id")):
        for item in compiled_project.get(key, []) or []:
            if not isinstance(item, dict):
                continue
            text = str(item.get("prompt_gpt_image") or "")
            target = str(item.get(id_key) or "")
            if re.search(r"(?:^|[，,；;])等身高(?:$|[，,；;。])", text):
                errors.append({"type": "asset_canonical_orphan_enum", "target_type": kind, "target_id": target, "detail": "canonical asset contains orphan height enum residue"})
            if re.search(r"([\\u4e00-\\u9fff]{2,8})\\1", text):
                errors.append({"type": "asset_canonical_repeated_token", "target_type": kind, "target_id": target, "detail": "canonical asset contains adjacent repeated Chinese token"})
            if re.search(r"[。；;]{2,}|。；|；。", text):
                errors.append({"type": "asset_canonical_bad_punctuation", "target_type": kind, "target_id": target, "detail": "canonical asset contains malformed punctuation"})
    return errors


def _utterance_integrity_errors(script: dict[str, Any] | None, shot_specs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not isinstance(script, dict):
        return []
    unit_map: dict[str, dict[str, Any]] = {}
    for scene in script.get("scenes", []) or []:
        if not isinstance(scene, dict):
            continue
        scene_id = str(scene.get("scene_id") or "")
        for group in build_frozen_text_units(scene).values():
            for unit in group.get("dialogue", []) or []:
                if isinstance(unit, dict) and unit.get("unit_id"):
                    unit_map[f"{scene_id}::{unit['unit_id']}"] = unit
    errors: list[dict[str, Any]] = []
    for shot in shot_specs:
        if not isinstance(shot, dict):
            continue
        refs = [str(x) for x in ((shot.get("frozen_text_unit_refs") or {}).get("dialogue") or []) if isinstance(x, str)]
        if not refs:
            continue
        scene_id = str(shot.get("scene_id") or "")
        expected_units = [unit_map.get(f"{scene_id}::{ref}") for ref in refs]
        if any(unit is None for unit in expected_units):
            errors.append({"type": "utterance_integrity_unknown_ref", "shot_id": str(shot.get("shot_id") or ""), "detail": "shot references unknown dialogue FrozenTextUnit"})
            continue
        expected_text = "".join(str(unit.get("text") or "") for unit in expected_units if isinstance(unit, dict))
        dialogue_items = [x for x in (shot.get("dialogue") or []) if isinstance(x, dict)]
        actual_text = "".join(str(x.get("line") or "") for x in dialogue_items)
        if actual_text != expected_text:
            errors.append({
                "type": "utterance_exact_reconstruction_failed", "shot_id": str(shot.get("shot_id") or ""),
                "expected": expected_text, "actual": actual_text,
                "detail": "Shot dialogue must exactly reconstruct its ordered FrozenTextUnit text",
            })
        if len(dialogue_items) == len(expected_units):
            for item, unit in zip(dialogue_items, expected_units):
                if str(item.get("character_id") or "") != str((unit or {}).get("character_id") or ""):
                    errors.append({"type": "utterance_speaker_mismatch", "shot_id": str(shot.get("shot_id") or ""), "detail": "FrozenText dialogue speaker changed downstream"})
                    break
    return errors


def validate_production_readiness(
    *,
    compiled_project: dict[str, Any],
    shot_specs: list[dict[str, Any]],
    script: dict[str, Any] | None = None,
) -> dict[str, Any]:
    prompts = {
        str(item.get("shot_id") or ""): item
        for item in (compiled_project.get("shot_prompts") or [])
        if isinstance(item, dict)
    }
    spec_map = {
        str(item.get("shot_id") or ""): item
        for item in shot_specs
        if isinstance(item, dict) and item.get("shot_id")
    }
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    scene_anchors: dict[str, str] = {}
    errors.extend(_asset_prompt_hygiene_errors(compiled_project))
    errors.extend(_utterance_integrity_errors(script, shot_specs))
    character_asset_hashes = {
        str(item.get("character_id") or ""): str(item.get("asset_hash") or "")
        for item in (compiled_project.get("character_prompts") or []) if isinstance(item, dict)
    }
    scene_asset_hashes = {
        str(item.get("scene_id") or ""): str(item.get("asset_hash") or "")
        for item in (compiled_project.get("scene_prompts") or []) if isinstance(item, dict)
    }

    for shot_id, spec in spec_map.items():
        item = prompts.get(shot_id) or {}
        # Readiness evaluates successfully compiled production prompts. Existing
        # consumption/semantic blocks remain owned by their upstream gates and
        # should not be duplicated as a second “missing prompt” failure.
        if str(item.get("compile_status") or "") == "blocked" or item.get("errors"):
            continue
        prompt = str(item.get("prompt_seedance") or "")
        if not prompt:
            errors.append({"type": "production_prompt_missing", "shot_id": shot_id, "detail": "compiled Seedance prompt is missing"})
            continue
        manifest = item.get("shot_consumption_manifest") if isinstance(item.get("shot_consumption_manifest"), dict) else {}
        errors.extend(_prompt_field_errors(prompt, shot_id, manifest))
        char_anchor = str(manifest.get("character_continuity_anchor") or "")
        scene_anchor = str(manifest.get("scene_continuity_anchor") or "")
        self_contained_error = _shot_self_contained_error(spec, manifest)
        if self_contained_error:
            errors.append(self_contained_error)
        errors.extend(_rendered_surface_integrity_errors(spec, manifest))
        errors.extend(_v17_final_semantic_errors(spec, manifest))
        warnings.extend(_v17_final_semantic_warnings(spec, manifest, item))
        effective_scene_key = str(manifest.get("scene") or spec.get("location_ref") or spec.get("scene_id") or "")
        if effective_scene_key and scene_anchor:
            previous = scene_anchors.setdefault(effective_scene_key, scene_anchor)
            if previous != scene_anchor:
                errors.append({
                    "type": "scene_continuity_anchor_drift", "shot_id": shot_id, "scene_id": effective_scene_key,
                    "detail": "stable scene anchor changed for the same effective Shot scene",
                })
        provenance = manifest.get("provenance") if isinstance(manifest.get("provenance"), dict) else {}
        used_char_hashes = provenance.get("character_asset_hashes") if isinstance(provenance.get("character_asset_hashes"), dict) else {}
        # Continuity anchors are visibility-aware by contract. Validate source-of-truth
        # only for characters whose canonical assets were actually consumed into this
        # Shot prompt; non-visible character_refs remain legal context and must not be
        # forced back into the rendered anchor just to satisfy readiness.
        for ref in visible_character_refs(spec):
            expected_hash = character_asset_hashes.get(str(ref))
            if expected_hash and str(used_char_hashes.get(str(ref)) or "") != expected_hash:
                errors.append({"type": "character_asset_source_of_truth_mismatch", "shot_id": shot_id, "character_ref": str(ref), "detail": "Visible Shot continuity anchor was not compiled from the current canonical character asset"})
        expected_scene_hash = scene_asset_hashes.get(str(spec.get("location_ref") or ""))
        if expected_scene_hash and str(provenance.get("scene_asset_hash") or "") != expected_scene_hash:
            errors.append({"type": "scene_asset_source_of_truth_mismatch", "shot_id": shot_id, "scene_ref": str(spec.get("location_ref") or ""), "detail": "Shot scene anchor was not compiled from the current canonical scene asset"})

        visual = str(manifest.get("visual_content") or "")
        duplicate = _duplicate_clause(visual)
        if duplicate:
            # Exact repeated visual wording is a renderer quality defect, not a
            # story/authority violation. Compiler v2l already de-duplicates the
            # common objective-action/execution overlap; keep this residual check
            # visible without stopping an otherwise valid production chain.
            warnings.append({"type": "production_text_duplicate_clause", "shot_id": shot_id, "detail": f"duplicate visual clause: {duplicate}"})
        if re.search(r"([\u4e00-\u9fff]{2,6})\1", visual):
            errors.append({"type": "production_text_repeated_token", "shot_id": shot_id, "detail": "visual content contains an adjacent repeated Chinese token"})
        if re.search(r"[。；;]{2,}|。；|；。", visual):
            errors.append({"type": "production_text_bad_punctuation", "shot_id": shot_id, "detail": "visual content contains malformed repeated punctuation"})
        if re.search(r"(?:^|[，,；;。])等(?=(?:偏|较|中等|高|矮|瘦|壮|胖))", visual):
            errors.append({"type": "production_text_orphan_enum_token", "shot_id": shot_id, "detail": "visual content contains an orphan enum token before a body adjective"})
        if re.search(r"(?:开口|语气带着)(?:询|追)(?:[。；;，,]|$)", visual):
            errors.append({"type": "production_text_suspected_truncation", "shot_id": shot_id, "detail": "visual performance text appears lexically truncated"})

        dialogue_lines = []
        semantics_dialogue = (item.get("consumption_view") or {}).get("dialogue") or []
        for d in semantics_dialogue:
            if isinstance(d, dict):
                line = str(d.get("line") or d.get("text") or "").strip().strip('“”"')
                if line:
                    dialogue_lines.append(line)
        for line in dialogue_lines:
            if _visual_contains_exact_dialogue(visual, line):
                errors.append({
                    "type": "exact_dialogue_repeated_in_visual_content", "shot_id": shot_id,
                    "detail": "exact dialogue must appear only in the dialogue track",
                })

        director = spec.get("director") if isinstance(spec.get("director"), dict) else {}
        purpose = str(director.get("shot_purpose") or "")
        performance_source = str(manifest.get("performance_source") or "")
        if purpose in _CRITICAL_PERFORMANCE_PURPOSES and performance_source == "continuity_fallback":
            errors.append({
                "type": "critical_shot_uses_performance_fallback", "shot_id": shot_id,
                "shot_purpose": purpose,
                "detail": "critical narrative shot requires explicit action/reaction/gaze/posture evidence",
            })

        current = float(spec.get("duration") or 0.0)
        estimate = float(estimate_min_duration(spec))
        if estimate > current + 0.25:
            errors.append({
                "type": "production_duration_unresolved", "shot_id": shot_id,
                "planned_seconds": current, "estimated_seconds": estimate,
                "detail": "duration authority must resolve W003 before production freeze",
            })

    # Repetition is allowed for genuine continuity, but not when narrative
    # function/visual relation changes while the exact camera grammar is copied.
    ordered_specs = [x for x in shot_specs if isinstance(x, dict)]
    for idx in range(2, len(ordered_specs)):
        trio = ordered_specs[idx - 2:idx + 1]
        if len({str(x.get("scene_id") or "") for x in trio}) != 1:
            continue
        def sig(x: dict[str, Any]) -> tuple[Any, ...]:
            d = x.get("director") if isinstance(x.get("director"), dict) else {}
            framing = d.get("execution_framing") if isinstance(d.get("execution_framing"), dict) else {}
            return (x.get("shot_size"), x.get("camera"), x.get("movement"), framing.get("framing_type"))
        signatures = [sig(x) for x in trio]
        if len(set(signatures)) != 1:
            continue
        semantic = []
        for x in trio:
            d = x.get("director") if isinstance(x.get("director"), dict) else {}
            target = d.get("visual_target") if isinstance(d.get("visual_target"), dict) else {}
            semantic.append((
                d.get("shot_purpose"), target.get("target_type"),
                tuple(target.get("character_refs") or []), tuple(target.get("prop_refs") or []),
            ))
        if len(set(semantic)) > 1:
            warnings.append({
                "type": "camera_language_repetition_without_continuity_reason", "shot_id": str(trio[-1].get("shot_id") or ""),
                "detail": "three consecutive shots copy the same size/camera/movement/framing although narrative purpose or visual target changed; retain as a quality warning instead of blocking compile",
            })
        else:
            warnings.append({
                "type": "camera_language_monotony", "shot_id": str(trio[-1].get("shot_id") or ""),
                "detail": "three consecutive shots intentionally retain the same camera grammar; verify this is genuine action continuity",
            })

    # Scene-level concentration catches the real production failure mode where
    # local triples vary just enough to pass, while an entire dialogue scene is
    # still overwhelmingly eye-level + static across different narrative uses.
    # Repetition itself is not forbidden: this only blocks sufficiently large
    # scenes with several distinct purposes and simultaneous camera+movement
    # concentration above the production threshold.
    scene_groups: dict[str, list[dict[str, Any]]] = {}
    for spec in ordered_specs:
        scene_groups.setdefault(str(spec.get("scene_id") or ""), []).append(spec)
    for scene_id, specs in scene_groups.items():
        if not scene_id or len(specs) < 8:
            continue
        purposes = {
            str((x.get("director") or {}).get("shot_purpose") or "")
            for x in specs if isinstance(x.get("director"), dict)
        } - {""}
        if len(purposes) < 3:
            continue
        def _distribution(field: str) -> tuple[str, int]:
            counts: dict[str, int] = {}
            for x in specs:
                if field == "framing":
                    d = x.get("director") if isinstance(x.get("director"), dict) else {}
                    f = d.get("execution_framing") if isinstance(d.get("execution_framing"), dict) else {}
                    value = str(f.get("framing_type") or "")
                else:
                    value = str(x.get(field) or "")
                if value:
                    counts[value] = counts.get(value, 0) + 1
            return max(counts.items(), key=lambda kv: kv[1]) if counts else ("", 0)
        camera_value, camera_count = _distribution("camera")
        movement_value, movement_count = _distribution("movement")
        camera_ratio = camera_count / len(specs)
        movement_ratio = movement_count / len(specs)
        if camera_ratio >= 0.80 and movement_ratio >= 0.80:
            # Emit the *minimum recoverable Director set* instead of blaming only
            # the final Shot. A long scene may need several camera/movement
            # changes to fall below the freeze threshold; returning one last-shot
            # error can create an endless resume loop.
            n = len(specs)
            # Largest integer count that is strictly below the 80% hard limit.
            max_allowed = max(0, int((0.80 * n) - 1e-9))
            if (max_allowed / n) >= 0.80:
                max_allowed -= 1
            need_camera = max(0, camera_count - max_allowed)
            need_movement = max(0, movement_count - max_allowed)
            needed = max(need_camera, need_movement, 1)

            candidates = []
            for spec in reversed(specs):
                director = spec.get("director") if isinstance(spec.get("director"), dict) else {}
                purpose = str(director.get("shot_purpose") or "")
                if purpose == "continuity":
                    continue
                if str(spec.get("camera") or "") == camera_value and str(spec.get("movement") or "") == movement_value:
                    candidates.append(spec)
            if len(candidates) < needed:
                for spec in reversed(specs):
                    if spec in candidates:
                        continue
                    if str(spec.get("camera") or "") == camera_value or str(spec.get("movement") or "") == movement_value:
                        candidates.append(spec)
                    if len(candidates) >= needed:
                        break

            selected = candidates[:needed] or [specs[-1]]
            affected_ids = [str(x.get("shot_id") or "") for x in selected if x.get("shot_id")]
            for index, spec in enumerate(selected):
                required_dimensions: list[str] = []
                if index < need_camera:
                    required_dimensions.append("camera")
                if index < need_movement:
                    required_dimensions.append("movement")
                if not required_dimensions:
                    required_dimensions = ["camera", "movement"]
                repair_targets = [
                    f"director.execution_shot_design.{dimension}"
                    for dimension in required_dimensions
                    if dimension in {"camera", "movement"}
                ]
                warnings.append({
                    "type": "scene_camera_distribution_overconcentrated",
                    "code": "W026_CAMERA_DISTRIBUTION_OVERCONCENTRATED",
                    "severity": "quality_warning",
                    "shot_id": str(spec.get("shot_id") or ""),
                    "scene_id": scene_id,
                    "detail": (
                        f"scene camera grammar is over-concentrated across {n} shots with "
                        f"{len(purposes)} narrative purposes: camera {camera_value}={camera_ratio:.0%}, "
                        f"movement {movement_value}={movement_ratio:.0%}; redesign this selected Director unit "
                        "with narrative intent so the scene-wide distribution can recover"
                    ),
                    "dominant_camera": camera_value,
                    "dominant_camera_ratio": round(camera_ratio, 4),
                    "dominant_movement": movement_value,
                    "dominant_movement_ratio": round(movement_ratio, 4),
                    "required_dimensions": required_dimensions,
                    "affected_shot_ids": affected_ids,
                    "path": repair_targets[0] if repair_targets else "director.execution_shot_design",
                    "repair_targets": repair_targets,
                    "repair_instruction": (
                        "preserve plot facts, dialogue, shot purpose and visual target; change the listed "
                        "camera/movement dimension(s) only when the alternative serves the current narrative "
                        "function; do not add decorative motion"
                    ),
                })

    return {
        "contract_version": CONTRACT_VERSION,
        "passed": not errors,
        "freeze_status": "production_freeze_ready" if not errors else "production_candidate",
        "errors": errors,
        "warnings": warnings,
        "summary": {
            "shots": len(spec_map),
            "errors": len(errors),
            "warnings": len(warnings),
            "scene_anchor_count": len(scene_anchors),
        },
    }
