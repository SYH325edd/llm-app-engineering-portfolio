from __future__ import annotations

import copy
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Callable

from build_identity import BUILD_ID

from prompt_foundry_v1_3 import (
    build_storyboard_shot_specs_v1_3,
    compile_character_prompt,
    compile_scene_prompt,
    validate_storyboard_director_v1_3a,
)
from prompt_foundry_v1_3.state_resolver import empty_state, resolve_state_in

from app.normalization import normalize_storyboard_shot_ids
from app.shape_validation import validate_stage_shape, validate_director_fragment_shape
from app.store import RunStore
from app.upstream_validation import (
    validate_script,
    validate_story_bible,
    validate_storyboard_base,
)

from .checkpoints import CheckpointStore, unit_input_hash
from .context_builder import ContextBuilder
from .context_state import ContextStateCursor
from .model_router import ModelRouter
from .stage_contracts import MODEL_STAGE_IO, extract_model_stage_output
from .stages.story_bible import CONTRACT_VERSION as STORY_BIBLE_CONTRACT, SOFT_QUALITY_ERROR_TYPES as STORY_BIBLE_SOFT_ERROR_TYPES, canonicalize_story_bible, sanitize_unproven_identity_attributes, sanitize_unverifiable_explicit_facts, validate_story_bible_output
from .stages.scene_plan import CONTRACT_VERSION as SCENE_PLAN_CONTRACT, SOFT_QUALITY_ERROR_TYPES as SCENE_PLAN_SOFT_ERROR_TYPES, canonicalize_scene_plan, validate_scene_plan_output
from .stages.script import CONTRACT_VERSION as SCRIPT_CONTRACT, SOFT_QUALITY_ERROR_TYPES as SCRIPT_SOFT_ERROR_TYPES, canonicalize_script_scene, validate_script_scene_output
from .stages.storyboard import CONTRACT_VERSION as STORYBOARD_CONTRACT, SOFT_QUALITY_ERROR_TYPES as STORYBOARD_SOFT_ERROR_TYPES, build_frozen_text_units, canonicalize_storyboard_scene, validate_storyboard_scene_output
from .stages.pvb import (
    CONTRACT_VERSION as PVB_CONTRACT,
    build_pvb_character_payload,
    canonicalize_pvb_character,
    validate_pvb_character_candidate,
    validate_pvb_character_model_output,
)
from .stages.psb import (
    CONTRACT_VERSION as PSB_CONTRACT,
    build_psb_scene_payload,
    canonicalize_psb_scene,
    validate_psb_scene_candidate,
    validate_psb_scene_model_output,
)
from .stages.state_shotspec import CONTRACT_VERSION as STATE_SHOTSPEC_CONTRACT, build_state_shotspec_payload, build_state_shot_specs
from .stages.compile_eval import (
    lock_production_assets,
    compile_and_evaluate,
    validate_visible_character_asset_preflight,
)
from .stages.director import (
    CONTRACT_VERSION as DIRECTOR_CONTRACT,
    SOFT_QUALITY_ERROR_TYPES as DIRECTOR_SOFT_ERROR_TYPES,
    build_director_shot_payload,
    canonicalize_director_fragment,
    stabilize_director_contract_conflicts,
    validate_director_fragment,
)
from .stages.director_scene_context import (
    CONTRACT_VERSION as DIRECTOR_SCENE_CONTRACT,
    build_director_scene_context_payload,
    canonicalize_director_scene_context,
    validate_director_scene_context,
)
from .stages.production_semantics import (
    CONTRACT_VERSION as PRODUCTION_SEMANTICS_CONTRACT,
    SOFT_QUALITY_ERROR_TYPES as PRODUCTION_SEMANTICS_SOFT_ERROR_TYPES,
    build_production_semantics_payload,
    canonicalize_production_semantics,
    validate_production_semantics_output,
)
from .stages.style_guide import (
    CONTRACT_VERSION as STYLE_GUIDE_CONTRACT,
    build_style_guide_payload,
    canonicalize_style_guide,
    validate_style_guide_candidate,
    validate_style_guide_model_output,
)
from .prompts import (
    build_script_scene_payload,
    build_storyboard_scene_payload,
    system_prompt,
    model_system_prompt,
    whole_stage_payload,
)
from .source_evidence import reanchor_story_bible_evidence
from .source_index import build_source_index
from .consumption_compiler import compile_character_consumption_prompt
from .director_context_effect import build_shot_context_effect_audit, aggregate_scene_context_effect
from .consumption_lint import estimate_min_duration
from .storyboard_overload_feedback import build_storyboard_overload_feedback, build_storyboard_overload_feedback_from_board
from .storyboard_redistribution import (
    APPLY_CONTRACT_VERSION as STORYBOARD_REDISTRIBUTION_CONTRACT,
    FRAGMENT_MODEL_STAGE as STORYBOARD_REDISTRIBUTION_MODEL_STAGE,
    apply_redistribution_fragments,
    build_redistribution_fragment_payload,
    build_storyboard_redistribution_plan,
    canonicalize_redistribution_fragment,
    validate_redistribution_fragment,
)


class RuntimePaused(RuntimeError):
    pass


RETRY_MODE_REGENERATE_SOURCES = "regenerate_source_units"
RETRY_MODE_RETRY_CURRENT = "retry_current_unit"
RETRY_MODE_INSPECT_RUNTIME = "inspect_runtime"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ordered_unique(values: list[str]) -> list[str]:
    out: list[str] = []
    for value in values:
        if value not in out:
            out.append(value)
    return out


def _scene_position_for_shot(scene_context: dict[str, Any], shot_id: str) -> str:
    matches = [
        str(phase.get("function") or "")
        for phase in (scene_context.get("emotional_arc") or [])
        if isinstance(phase, dict) and shot_id in (phase.get("shot_refs") or [])
    ]
    matches = [value for value in matches if value]
    return matches[0] if len(matches) == 1 else ""


def _scene_reaction_opportunity(scene_context: dict[str, Any], shot_id: str) -> bool:
    strategy = scene_context.get("reaction_strategy") if isinstance(scene_context.get("reaction_strategy"), dict) else {}
    return shot_id in (strategy.get("preferred_reaction_shot_refs") or [])



def _unit_shape_error(path: str, expected: str, value: Any) -> dict[str, Any]:
    return {"type": "shape_type_mismatch", "path": path, "expected": expected, "actual_type": type(value).__name__}



def _canonicalize_director_unit(director: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """Normalize representation-only Director details without inventing semantics.

    Some providers return source_evidence as a string or string array. Core v1.3
    consumes evidence objects. Converting the same text to {quote: ...} is a
    mechanical representation normalization; the Frozen semantic validator still
    decides whether the resulting evidence/action is acceptable.
    """
    out = copy.deepcopy(director)
    changes = 0
    actions = out.get("performance_actions")
    if not isinstance(actions, list):
        return out, changes
    for action in actions:
        if not isinstance(action, dict):
            continue
        evidence = action.get("source_evidence")
        if isinstance(evidence, str):
            action["source_evidence"] = [{"quote": evidence}] if evidence.strip() else []
            changes += 1
            continue
        if not isinstance(evidence, list):
            continue
        normalized_evidence = []
        changed = False
        for item in evidence:
            if isinstance(item, str):
                normalized_evidence.append({"quote": item})
                changed = True
            else:
                normalized_evidence.append(item)
        if changed:
            action["source_evidence"] = normalized_evidence
            changes += 1
    return out, changes


def _validate_pvb_character_unit(character: dict[str, Any], candidate: Any) -> tuple[Any, list[dict[str, Any]], int]:
    raw_errors = validate_pvb_character_model_output(candidate)
    if raw_errors:
        return candidate, raw_errors, 0
    normalized, changes = canonicalize_pvb_character(character, candidate)
    errors = validate_pvb_character_candidate(character, normalized)
    return normalized, errors, changes


def _validate_psb_scene_unit(scene_fact: dict[str, Any], candidate: Any) -> tuple[Any, list[dict[str, Any]], int]:
    raw_errors = validate_psb_scene_model_output(candidate, scene_fact)
    if raw_errors:
        return candidate, raw_errors, 0
    normalized, changes = canonicalize_psb_scene(scene_fact, candidate)
    errors = validate_psb_scene_candidate(scene_fact, normalized)
    return normalized, errors, changes


def _validate_style_guide_unit(candidate: Any) -> tuple[Any, list[dict[str, Any]], int]:
    raw_errors = validate_style_guide_model_output(candidate)
    if raw_errors:
        return candidate, raw_errors, 0
    normalized, changes = canonicalize_style_guide(candidate)
    errors = validate_style_guide_candidate(normalized)
    return normalized, errors, changes


def _one_shot_board(scene_meta: dict[str, Any], shot: dict[str, Any], director: dict[str, Any]) -> dict[str, Any]:
    merged_shot = copy.deepcopy(shot)
    merged_shot["director"] = copy.deepcopy(director)
    return {"scenes": [{
        "scene_id": scene_meta.get("scene_id"),
        "context_ref": scene_meta.get("context_ref") or "",
        "location_ref": scene_meta.get("location_ref"),
        "shots": [merged_shot],
    }]}


def _segmented_dialogue_pairs_for_script(script: dict[str, Any]) -> dict[tuple[str, str], set[tuple[str, str]]]:
    out: dict[tuple[str, str], set[tuple[str, str]]] = {}
    for scene in script.get("scenes", []) or []:
        if not isinstance(scene, dict):
            continue
        sid = str(scene.get("scene_id") or "")
        frozen = build_frozen_text_units(scene)
        for bid, group in frozen.items():
            out[(sid, str(bid))] = {
                (str(unit.get("character_id") or ""), str(unit.get("text") or ""))
                for unit in (group.get("dialogue") or [])
                if isinstance(unit, dict) and unit.get("character_id") and unit.get("text") is not None
            }
    return out


def _filter_runtime_director_core_errors(
    errors: list[dict[str, Any]],
    script: dict[str, Any],
    board: dict[str, Any],
) -> list[dict[str, Any]]:
    segmented = _segmented_dialogue_pairs_for_script(script)
    shot_context: dict[str, tuple[str, str, list[tuple[str, str]]]] = {}
    for scene in board.get("scenes", []) or []:
        if not isinstance(scene, dict):
            continue
        sid = str(scene.get("scene_id") or "")
        for shot in scene.get("shots", []) or []:
            if not isinstance(shot, dict) or not shot.get("shot_id"):
                continue
            pairs = [
                (str(item.get("character_id") or ""), str(item.get("line") or ""))
                for item in (shot.get("dialogue") or [])
                if isinstance(item, dict) and item.get("character_id") and item.get("line") is not None
            ]
            shot_context[str(shot["shot_id"])] = (sid, str(shot.get("beat_id") or ""), pairs)

    kept: list[dict[str, Any]] = []
    for error in errors:
        etype = str(error.get("type") or "")
        if etype in {"unsupported_performance_modifier", "reaction_target_without_performance"}:
            # Frozen Core v1.3 coupled reaction camera targets to objective
            # performance facts. Runtime Director separates those responsibilities:
            # reaction_target_refs are visual choices; performance_actions remain
            # evidence-bound objective actions.
            continue
        if etype == "speaker_ownership_mismatch":
            context = shot_context.get(str(error.get("shot_id") or ""))
            if context is not None:
                sid, bid, pairs = context
                allowed = segmented.get((sid, bid), set())
                if pairs and all(pair in allowed for pair in pairs):
                    # Frozen Core v1.3 only knows whole Script dialogue lines. Runtime
                    # Storyboard v16 permits exact sentence-level FrozenText units, so
                    # this legacy error is obsolete only when every current pair is an
                    # exact deterministic unit from the same Script Beat.
                    continue
        kept.append(error)
    return kept


def _director_shot_errors(
    story: dict[str, Any],
    script: dict[str, Any],
    scene_meta: dict[str, Any],
    base_shot: dict[str, Any],
    director: Any,
    context: dict[str, Any],
    *,
    is_first: bool,
) -> tuple[dict[str, Any] | None, list[dict[str, Any]], int]:
    if not isinstance(director, dict):
        return None, [_unit_shape_error("director", "object", director)], 0
    canonical, changes = canonicalize_director_fragment(director, context, is_first_global_shot=is_first)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=is_first)
    if errors:
        # Deterministic normalization must not be blocked by an unrelated model-
        # repairable error in the same Shot. The previous all-or-nothing gate meant
        # e.g. a wide+precision-focus contradiction stayed unresolved whenever an
        # independent framing-note error was present, wasting the single semantic
        # Repair on two unrelated problems. Apply only the narrow stabilizer rules
        # they recognize, revalidate, and repeat until no deterministic change is
        # available. Unknown/creative errors remain untouched for model Repair.
        for _ in range(3):
            stabilized, stabilization_changes, _applied = stabilize_director_contract_conflicts(
                canonical, errors, context
            )
            if not stabilization_changes:
                break
            canonical, recanonicalized_changes = canonicalize_director_fragment(
                stabilized, context, is_first_global_shot=is_first
            )
            changes += stabilization_changes + recanonicalized_changes
            errors = validate_director_fragment(canonical, context, is_first_global_shot=is_first)
            if not errors:
                break
    if errors:
        return canonical, errors, changes
    candidate = _one_shot_board(scene_meta, base_shot, canonical)
    core_errors = list(validate_storyboard_director_v1_3a(story, script, candidate).get("errors") or [])
    core_errors = _filter_runtime_director_core_errors(core_errors, script, candidate)
    return canonical, core_errors, changes


class RuntimeV20:
    """Unitized orchestration around immutable Prompt Foundry Core v1.3."""

    VERSION = "2.1"
    FRAMEWORK_VERSION = "1.3-frozen"
    BUILD_ID = BUILD_ID
    CONTRACTS = {
        "story_bible": STORY_BIBLE_CONTRACT,
        "scene_plan": SCENE_PLAN_CONTRACT,
        "script": SCRIPT_CONTRACT,
        "storyboard": STORYBOARD_CONTRACT,
        "storyboard_redistribution": STORYBOARD_REDISTRIBUTION_CONTRACT,
        "pvb": PVB_CONTRACT,
        "psb": PSB_CONTRACT,
        "style_guide": STYLE_GUIDE_CONTRACT,
        "production_semantics": PRODUCTION_SEMANTICS_CONTRACT,
        "director_scene": DIRECTOR_SCENE_CONTRACT,
        "director": DIRECTOR_CONTRACT,
        "state_shotspec": STATE_SHOTSPEC_CONTRACT,
        "compiler": "consumption_v2m",
    }
    # Semantic repair is intentionally bounded to one targeted pass per model unit.
    # Transport/provider retries are handled separately by ArkClient. Repeating the
    # same temperature-0 semantic repair multiple times increases cost and drift
    # without creating new authority.
    REPAIR_BUDGETS = {
        "story_bible": 1,
        "scene_plan": 1,
        "script_scene": 1,
        "storyboard_scene": 1,
        "storyboard_redistribution_fragment": 1,
        "pvb_character": 1,
        "psb_scene": 1,
        "style_guide": 1,
        "production_semantics_shot": 1,
        "director_scene_context": 1,
        "director_shot": 1,
    }
    MAX_REPAIRS = 1

    def __init__(self, *, model: Any, store: RunStore, checkpoints: CheckpointStore, router: ModelRouter | None = None):
        self.model = model
        self.store = store
        self.checkpoints = checkpoints
        self.router = router or ModelRouter(model)

    def _save(self, run: dict[str, Any]) -> None:
        run["updated_at"] = _now()
        self._refresh_stage_summaries(run)
        self.store.save(run)

    @staticmethod
    def _consume_model_usage(model: Any) -> dict[str, int]:
        getter = getattr(model, "consume_last_usage", None)
        if not callable(getter):
            return {}
        try:
            value = getter()
        except Exception:
            return {}
        if not isinstance(value, dict):
            return {}
        out: dict[str, int] = {}
        for key in ("requests", "prompt_tokens", "completion_tokens", "total_tokens", "input_chars", "output_chars"):
            try:
                out[key] = max(0, int(value.get(key) or 0))
            except (TypeError, ValueError):
                out[key] = 0
        return out

    @staticmethod
    def _compact_chars(value: Any) -> int:
        try:
            return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
        except Exception:
            return len(str(value))

    def _record_model_usage(
        self, run: dict[str, Any], *, unit_id: str, stage: str, model_stage: str,
        is_repair: bool, usage: dict[str, int], estimated_input_chars: int, output_chars: int = 0,
    ) -> dict[str, int]:
        metrics = {
            "requests": int(usage.get("requests") or 1),
            "prompt_tokens": int(usage.get("prompt_tokens") or 0),
            "completion_tokens": int(usage.get("completion_tokens") or 0),
            "total_tokens": int(usage.get("total_tokens") or 0),
            "input_chars": int(usage.get("input_chars") or estimated_input_chars),
            "output_chars": int(usage.get("output_chars") or output_chars),
            "repair": 1 if is_repair else 0,
        }
        ledger = run.setdefault("token_usage", {
            "requests": 0, "repair_requests": 0, "prompt_tokens": 0, "completion_tokens": 0,
            "total_tokens": 0, "input_chars": 0, "output_chars": 0, "by_stage": {},
        })
        for key in ("requests", "prompt_tokens", "completion_tokens", "total_tokens", "input_chars", "output_chars"):
            ledger[key] = int(ledger.get(key) or 0) + int(metrics[key])
        if is_repair:
            ledger["repair_requests"] = int(ledger.get("repair_requests") or 0) + int(metrics["requests"])
        by_stage = ledger.setdefault("by_stage", {})
        stage_row = by_stage.setdefault(stage, {
            "requests": 0, "repair_requests": 0, "prompt_tokens": 0, "completion_tokens": 0,
            "total_tokens": 0, "input_chars": 0, "output_chars": 0,
        })
        for key in ("requests", "prompt_tokens", "completion_tokens", "total_tokens", "input_chars", "output_chars"):
            stage_row[key] = int(stage_row.get(key) or 0) + int(metrics[key])
        if is_repair:
            stage_row["repair_requests"] = int(stage_row.get("repair_requests") or 0) + int(metrics["requests"])
        return metrics

    def _event(self, run: dict[str, Any], event_type: str, *, unit_id: str | None = None, stage: str | None = None, status: str | None = None, message: str | None = None) -> None:
        run.setdefault("events", []).append({
            "event_id": f"evt_{uuid.uuid4().hex[:10]}",
            "type": event_type,
            "unit_id": unit_id,
            "stage": stage,
            "status": status,
            "message": message,
            "created_at": _now(),
        })
        # Keep local-run JSON bounded while retaining enough execution history.
        if len(run["events"]) > 1000:
            run["events"] = run["events"][-1000:]

    def _refresh_stage_summaries(self, run: dict[str, Any]) -> None:
        stage_order = ["story_bible", "scene_plan", "script", "storyboard", "storyboard_redistribution", "pvb", "psb", "style_guide", "production_semantics", "director", "state_shotspec", "compile"]
        rows = []
        for stage in stage_order:
            units = [u for u in run.get("units", {}).values() if u.get("stage") == stage]
            if not units:
                continue
            statuses = {u.get("status") for u in units}
            if statuses == {"completed"}:
                status = "completed"
            elif "failed_recoverable" in statuses or "failed" in statuses:
                status = "paused"
            elif "running" in statuses:
                status = "running"
            else:
                status = "pending"
            rows.append({
                "name": stage,
                "status": status,
                "completed_units": sum(1 for u in units if u.get("status") == "completed"),
                "total_units": len(units),
                "repair_count": sum(int(u.get("repair_count") or 0) for u in units),
                "normalization_count": sum(int(u.get("normalization_count") or 0) for u in units),
                "error": next((u.get("error") for u in units if u.get("error")), None),
            })
        run["stages"] = rows

    def _set_unit(self, run: dict[str, Any], unit_id: str, **fields: Any) -> dict[str, Any]:
        unit = run.setdefault("units", {}).setdefault(unit_id, {"unit_id": unit_id})
        unit.update(fields)
        return unit

    @staticmethod
    def _model_stage_for_source_unit(source_id: str, checkpoint: dict[str, Any]) -> str:
        explicit = str(checkpoint.get("model_stage") or "")
        if explicit:
            return explicit
        stage = str(checkpoint.get("stage") or source_id.split(":", 1)[0] or "")
        return {
            "story_bible": "story_bible",
            "scene_plan": "scene_plan",
            "script": "script_scene",
            "storyboard": "storyboard_scene",
            "pvb": "pvb_character",
            "psb": "psb_scene",
            "style_guide": "style_guide",
            "production_semantics": "production_semantics_shot",
            "director": "director_shot",
        }.get(stage, "")

    @staticmethod
    def _repair_policy(model_stage: str, errors: list[dict[str, Any]]) -> dict[str, Any]:
        """Return machine-readable repair authority and exact repair targets.

        The model must not infer what to repair from prose error messages alone.
        Runtime extracts stable target paths and marks blank-required paths so every
        stage gets the same targeted-repair semantics. Story Bible keeps its own
        narrow fact-correction authority; downstream stages remain consumers.
        """
        semantic_fact_errors = [
            error for error in errors
            if isinstance(error, dict) and error.get("type") == "story_bible_fact_not_supported"
        ] if model_stage == "story_bible" else []

        repair_targets: list[str] = []
        must_be_nonempty_paths: list[str] = []
        must_change_any_of_paths: list[str] = []
        must_change_groups: list[list[str]] = []
        for error in errors:
            if not isinstance(error, dict):
                continue
            explicit_targets = error.get("repair_targets") if isinstance(error.get("repair_targets"), list) else []
            for explicit in explicit_targets:
                if explicit not in (None, "") and str(explicit) not in repair_targets:
                    repair_targets.append(str(explicit))
            error_change_group: list[str] = []
            for explicit in (error.get("must_change_any_of_paths") or []):
                if explicit not in (None, "") and str(explicit) not in must_change_any_of_paths:
                    must_change_any_of_paths.append(str(explicit))
                if explicit not in (None, "") and str(explicit) not in error_change_group:
                    error_change_group.append(str(explicit))
            if error_change_group and error_change_group not in must_change_groups:
                must_change_groups.append(error_change_group)
            target = (
                error.get("target_path")
                or error.get("path")
                or error.get("field")
                or error.get("support_path")
            )
            if target not in (None, ""):
                target = str(target)
                if not explicit_targets and target not in repair_targets:
                    repair_targets.append(target)
                if str(error.get("type") or "").startswith("blank_") and target not in must_be_nonempty_paths:
                    must_be_nonempty_paths.append(target)

        # Every hard model-validation failure must produce an executable repair scope.
        # Validators should provide precise paths, but legacy/global errors may not.
        # Never send the model an empty repair target list: "$" explicitly means the
        # current Unit root and keeps no-op detection/recovery observable.
        if errors and not repair_targets:
            repair_targets.append("$")

        # When multiple hard errors each provide a must-change group, a single union
        # is too weak: changing shot_size could satisfy a repetition error while still
        # leaving a camera-distribution error untouched.  If the groups share paths,
        # prefer their intersection so one change can satisfy all constraints at once;
        # always expose the original groups for the model's repair contract.
        if len(must_change_groups) > 1:
            intersection = set(must_change_groups[0])
            for group in must_change_groups[1:]:
                intersection.intersection_update(group)
            if intersection:
                must_change_any_of_paths = [
                    path for path in repair_targets
                    if path in intersection
                ] or sorted(intersection)

        policy: dict[str, Any] = {
            "preserve_unrelated_story_facts": True,
            "do_not_change_story_facts": not bool(semantic_fact_errors),
            "repair_targets": repair_targets,
            "must_change_targeted_fields": bool(repair_targets) and not bool(must_change_any_of_paths),
            "must_change_any_of_paths": must_change_any_of_paths,
            "must_change_groups": must_change_groups,
            "must_be_nonempty_paths": must_be_nonempty_paths,
            "preserve_other_valid_fields": True,
        }
        if model_stage == "story_bible":
            policy["allow_targeted_fact_correction"] = bool(semantic_fact_errors)
            policy["targeted_fact_paths"] = [
                str(error.get("target_path") or error.get("support_path"))
                for error in semantic_fact_errors
                if error.get("target_path") or error.get("support_path")
            ]
            policy["prefer_source_faithful_fact_surface_before_evidence_rebind"] = True
        return policy

    def _remember_source_repair_hints(
        self,
        run: dict[str, Any],
        *,
        origin_unit_id: str,
        errors: list[dict[str, Any]],
        source_unit_ids: list[str],
    ) -> None:
        if not source_unit_ids:
            return
        frozen_errors = copy.deepcopy(errors)
        hints = run.setdefault("recovery", {}).setdefault("source_repair_hints", {})
        for source_id in source_unit_ids:
            checkpoint = self.checkpoints.get(run["run_id"], source_id) or {}
            target_ref = source_id.split(":", 1)[1] if ":" in source_id else ""
            targeted_errors = [
                copy.deepcopy(error)
                for error in frozen_errors
                if not target_ref
                or str(error.get("scene_id") or "") == target_ref
                or str(error.get("shot_id") or "") == target_ref
                or str(error.get("character_id") or "") == target_ref
                or str(error.get("target_id") or "") == target_ref
            ]
            raw_output = checkpoint.get("raw_model_output")
            if raw_output is None:
                canonical_output = copy.deepcopy(checkpoint.get("output"))
                model_stage = self._model_stage_for_source_unit(source_id, checkpoint)
                contract = MODEL_STAGE_IO.get(model_stage)
                if contract is not None and contract.output_root_key:
                    raw_output = {contract.output_root_key: canonical_output}
                else:
                    raw_output = canonical_output
            hints[source_id] = {
                "origin_gate": origin_unit_id,
                "validation_errors": targeted_errors or copy.deepcopy(frozen_errors),
                "invalid_output": copy.deepcopy(raw_output),
            }

    def _sync_unit_quality_warnings(self, run: dict[str, Any], *, unit_id: str, stage: str, warnings: list[dict[str, Any]]) -> None:
        history = run.setdefault("quality_warnings", [])
        history[:] = [w for w in history if not (w.get("unit_id") == unit_id and w.get("stage") == stage)]
        for warning in warnings:
            history.append({"unit_id": unit_id, "stage": stage, **copy.deepcopy(warning)})

    def _pause_deterministic_failure(
        self,
        run: dict[str, Any],
        *,
        unit_id: str,
        stage: str,
        message: str,
        failure_kind: str,
        errors: list[dict[str, Any]] | None = None,
        retryable: bool = False,
        retry_mode: str = RETRY_MODE_INSPECT_RUNTIME,
        attempt_status: str = "validation_failed",
        source_unit_ids: list[str] | None = None,
    ) -> None:
        """Persist a non-model failure with the same observability contract as model Units.

        Deterministic asset/state/compiler failures must not collapse into a bare
        RuntimePaused exception: the UI/recovery layer needs an owning Unit, a
        machine-readable failure kind, retry semantics, and stable failure history.
        """
        now = _now()
        frozen_errors = copy.deepcopy(errors or [])
        source_unit_ids = _ordered_unique([str(x) for x in (source_unit_ids or []) if str(x) and str(x) != unit_id])
        if retry_mode == RETRY_MODE_REGENERATE_SOURCES and source_unit_ids:
            self._remember_source_repair_hints(
                run, origin_unit_id=unit_id, errors=frozen_errors, source_unit_ids=source_unit_ids
            )
        if retry_mode == RETRY_MODE_REGENERATE_SOURCES and not source_unit_ids:
            retryable = False
            retry_mode = RETRY_MODE_INSPECT_RUNTIME
        if retry_mode == RETRY_MODE_RETRY_CURRENT and not retryable:
            retry_mode = RETRY_MODE_INSPECT_RUNTIME
        attempts = [{"attempt": 1, "status": attempt_status, "errors": frozen_errors}]
        failure_signature = unit_input_hash({
            "unit_id": unit_id, "stage": stage, "failure_kind": failure_kind,
            "message": message, "errors": frozen_errors,
        })
        self._set_unit(
            run, unit_id, stage=stage, status="failed_recoverable" if retryable else "failed",
            attempts=attempts, repair_count=0, normalization_count=0, reused=False,
            error=message, failure_kind=failure_kind, retryable=retryable,
            source_unit_ids=copy.deepcopy(source_unit_ids),
            failure_signature=failure_signature, finished_at=now,
        )
        run["current_unit"] = unit_id
        run["current_stage"] = stage
        run["status"] = "paused"
        run["error"] = {
            "unit_id": unit_id, "stage": stage, "message": message,
            "failure_kind": failure_kind, "retryable": retryable, "retry_mode": retry_mode,
            "source_unit_ids": copy.deepcopy(source_unit_ids),
        }
        history = run.setdefault("failure_history", [])
        if not history or history[-1].get("failure_signature") != failure_signature:
            history.append({
                "unit_id": unit_id, "stage": stage, "message": message,
                "failure_kind": failure_kind, "retryable": retryable, "retry_mode": retry_mode,
                "source_unit_ids": copy.deepcopy(source_unit_ids),
                "failure_signature": failure_signature, "failed_at": now,
                "attempts": copy.deepcopy(attempts),
            })
        self._event(
            run, "unit_failed", unit_id=unit_id, stage=stage,
            status="failed_recoverable" if retryable else "failed", message=message,
        )
        self._save(run)
        raise RuntimePaused(message)

    def _enforce_stage_gate(
        self,
        run: dict[str, Any],
        *,
        stage: str,
        unit_id: str,
        errors: list[dict[str, Any]],
        validation_key: str,
        failure_kind: str,
        message: str,
        source_unit_ids: list[str] | None = None,
    ) -> None:
        """Persist deterministic cross-unit validation at the owning stage.

        Model Units validate their own output. A Stage gate validates assembled or
        cross-unit invariants before downstream stages are allowed to run. Gates
        never invoke an LLM Repair and therefore cannot silently rewrite upstream
        facts.
        """
        now = _now()
        source_unit_ids = _ordered_unique([str(x) for x in (source_unit_ids or []) if str(x)])
        if not errors:
            self._set_unit(
                run, unit_id, stage=stage, status="completed", attempts=[{
                    "attempt": 1, "status": "passed", "errors": [],
                }], repair_count=0, normalization_count=0, reused=False,
                error=None, failure_kind=None, retryable=None, source_unit_ids=[], finished_at=now,
            )
            run.setdefault("validations", {})[validation_key] = {"passed": True, "errors": []}
            return

        frozen_errors = copy.deepcopy(errors)
        # A gate failure is cross-unit knowledge. Blind regeneration with the same
        # temperature-0 prompt reproduces the same output, so persist targeted repair
        # context for the owning source Unit.
        self._remember_source_repair_hints(
            run, origin_unit_id=unit_id, errors=frozen_errors, source_unit_ids=source_unit_ids
        )
        gate_retryable = bool(source_unit_ids)
        gate_status = "failed_recoverable" if gate_retryable else "failed"
        gate_retry_mode = RETRY_MODE_REGENERATE_SOURCES if gate_retryable else RETRY_MODE_INSPECT_RUNTIME
        failure_signature = unit_input_hash({"stage": stage, "errors": frozen_errors})
        self._set_unit(
            run, unit_id, stage=stage, status=gate_status, attempts=[{
                "attempt": 1, "status": "gate_failed", "errors": frozen_errors,
            }], repair_count=0, normalization_count=0, reused=False,
            error=message, failure_kind=failure_kind, retryable=gate_retryable,
            source_unit_ids=copy.deepcopy(source_unit_ids),
            failure_signature=failure_signature, finished_at=now,
        )
        run["current_unit"] = unit_id
        run["current_stage"] = stage
        run["status"] = "paused"
        run["error"] = {
            "unit_id": unit_id,
            "stage": stage,
            "message": message,
            "failure_kind": failure_kind,
            "retryable": gate_retryable,
            "retry_mode": gate_retry_mode,
            "source_unit_ids": copy.deepcopy(source_unit_ids),
        }
        run.setdefault("validations", {})[validation_key] = {
            "passed": False, "errors": frozen_errors
        }
        history = run.setdefault("failure_history", [])
        if not history or history[-1].get("failure_signature") != failure_signature:
            history.append({
                "unit_id": unit_id,
                "stage": stage,
                "message": message,
                "failure_kind": failure_kind,
                "retryable": gate_retryable,
                "retry_mode": gate_retry_mode,
                "source_unit_ids": copy.deepcopy(source_unit_ids),
                "failure_signature": failure_signature,
                "failed_at": now,
                "attempts": [{"attempt": 1, "status": "gate_failed", "errors": frozen_errors}],
            })
        self._event(
            run, "stage_gate_failed", unit_id=unit_id, stage=stage,
            status=gate_status, message=message,
        )
        self._save(run)
        raise RuntimePaused(message)

    def _execute_unit(
        self,
        run: dict[str, Any],
        *,
        unit_id: str,
        stage: str,
        model_stage: str,
        payload: dict[str, Any],
        prompt: str,
        extract: Callable[[dict[str, Any]], Any],
        validate: Callable[[Any], tuple[Any, list[dict[str, Any]], int]],
        soft_error_types: set[str] | frozenset[str] | None = None,
        enforce_model_envelope: bool = False,
    ) -> Any:
        contract_id = f"{self.CONTRACTS.get(stage, 'unversioned')}|model-envelope.v1"
        reusable = self.checkpoints.get_reusable(
            run["run_id"], unit_id, payload, contract_id=contract_id
        )
        if reusable is not None:
            warnings = copy.deepcopy(reusable.get("quality_warnings", []))
            self._set_unit(
                run, unit_id, stage=stage, status="completed", input_hash=reusable["input_hash"],
                contract_id=contract_id, attempts=reusable.get("attempts", []),
                repair_count=reusable.get("repair_count", 0),
                normalization_count=reusable.get("normalization_count", 0),
                quality_warnings=warnings, reused=True, error=None, failure_kind=None, retryable=None,
            )
            self._sync_unit_quality_warnings(run, unit_id=unit_id, stage=stage, warnings=warnings)
            self._event(run, "unit_reused", unit_id=unit_id, stage=stage, status="completed")
            self._save(run)
            return copy.deepcopy(reusable.get("output"))

        # Contract-aware checkpoint migration: when input is unchanged but the
        # Stage contract evolved, revalidate the persisted canonical output with
        # current deterministic rules. Valid output is promoted in place without
        # paying for another model call; invalid output is regenerated normally.
        legacy = self.checkpoints.get_reusable(run["run_id"], unit_id, payload)
        if legacy is not None:
            legacy_output = copy.deepcopy(legacy.get("output"))
            migrated_output, migrated_errors, migrated_normalizations = validate(legacy_output)
            soft_types = set(soft_error_types or ())
            migrated_warnings = [
                copy.deepcopy(e) for e in migrated_errors if str(e.get("type") or "") in soft_types
            ]
            migrated_hard_errors = [
                copy.deepcopy(e) for e in migrated_errors if str(e.get("type") or "") not in soft_types
            ]
            if not migrated_hard_errors:
                legacy.update(
                    contract_id=contract_id,
                    output=copy.deepcopy(migrated_output),
                    normalization_count=int(legacy.get("normalization_count") or 0) + migrated_normalizations,
                    quality_warnings=copy.deepcopy(migrated_warnings),
                )
                self.checkpoints.save(run["run_id"], unit_id, legacy)
                self._set_unit(
                    run, unit_id, stage=stage, status="completed", input_hash=legacy["input_hash"],
                    contract_id=contract_id, attempts=legacy.get("attempts", []),
                    repair_count=legacy.get("repair_count", 0),
                    normalization_count=legacy.get("normalization_count", 0),
                    quality_warnings=copy.deepcopy(migrated_warnings), reused=True,
                    checkpoint_migrated=True, error=None, failure_kind=None, retryable=None,
                )
                self._sync_unit_quality_warnings(
                    run, unit_id=unit_id, stage=stage, warnings=migrated_warnings
                )
                self._event(
                    run, "unit_checkpoint_migrated", unit_id=unit_id, stage=stage, status="completed",
                    message=f"checkpoint revalidated under {contract_id}",
                )
                self._save(run)
                return migrated_output
            self._event(
                run, "unit_checkpoint_invalidated", unit_id=unit_id, stage=stage, status="pending",
                message=f"persisted output no longer satisfies {contract_id}",
            )

        input_hash = unit_input_hash(payload)
        unit = self._set_unit(
            run, unit_id, stage=stage, model_stage=model_stage, status="running", input_hash=input_hash, contract_id=contract_id,
            attempts=[], repair_count=0, normalization_count=0, quality_warnings=[], reused=False,
            checkpoint_migrated=False, error=None, failure_kind=None, retryable=None,
            started_at=_now(), finished_at=None,
            contract_trace={
                "contract_id": contract_id,
                "payload_contract_version": payload.get("contract_version"),
                "has_output_contract": isinstance(payload.get("output_contract"), dict),
                "has_output_template": isinstance(payload.get("output_template"), dict),
                "repair_budget": int(self.REPAIR_BUDGETS.get(model_stage, 1)),
                "authority_manifest": copy.deepcopy((payload.get("output_contract") or {}).get("authority_manifest") or {}),
            },
        )
        run["current_unit"] = unit_id
        run["current_stage"] = stage
        self._event(run, "unit_started", unit_id=unit_id, stage=stage, status="running")
        self._save(run)
        candidate_raw: dict[str, Any] | None = None
        last_invalid_normalized: Any = None
        source_repair_hint = (run.get("recovery") or {}).get("source_repair_hints", {}).get(unit_id)
        repair_budget = int(self.REPAIR_BUDGETS.get(model_stage, 1))
        try:
            for attempt in range(1, repair_budget + 2):
                is_repair_call = attempt > 1 or bool(source_repair_hint)
                route_stage = f"{model_stage}_repair" if is_repair_call else model_stage
                model = self.router.for_stage(route_stage)
                call_payload = copy.deepcopy(payload)
                if attempt == 1 and source_repair_hint:
                    repair_errors = copy.deepcopy(source_repair_hint.get("validation_errors") or [])
                    call_payload["repair_instruction"] = {
                        "mode": (
                            "repair_from_stage_gate"
                            if source_repair_hint.get("origin_gate")
                            else "repair_from_previous_failure"
                        ),
                        "origin_gate": source_repair_hint.get("origin_gate"),
                        "validation_errors": repair_errors,
                        "invalid_output": copy.deepcopy(source_repair_hint.get("invalid_output")),
                        **self._repair_policy(model_stage, repair_errors),
                    }
                elif attempt > 1:
                    repair_errors = copy.deepcopy(unit["attempts"][-1]["errors"])
                    call_payload["repair_instruction"] = {
                        "mode": "repair_current_unit_only",
                        "validation_errors": repair_errors,
                        "invalid_output": candidate_raw,
                        **self._repair_policy(model_stage, repair_errors),
                    }
                call_prompt = prompt
                try:
                    if prompt == system_prompt(model_stage):
                        call_prompt = model_system_prompt(model_stage, repair=is_repair_call)
                except Exception:
                    call_prompt = prompt

                if is_repair_call:
                    # Design-stage output templates intentionally contain empty-string
                    # placeholders. Keeping that blank template in a repair request can
                    # anchor a temperature-0 model to repeat the invalid blank output.
                    # invalid_output + output_contract already preserve the full shape.
                    if model_stage in {"pvb_character", "psb_scene", "style_guide"}:
                        call_payload.pop("output_template", None)
                    repair_instruction = call_payload.get("repair_instruction") or {}
                    targets = repair_instruction.get("repair_targets") or []
                    change_any = repair_instruction.get("must_change_any_of_paths") or []
                    change_groups = repair_instruction.get("must_change_groups") or []
                    nonempty = repair_instruction.get("must_be_nonempty_paths") or []
                    call_prompt += (
                        "\n\nTARGETED REPAIR EXECUTION CONTRACT:\n"
                        "- repair_instruction.repair_targets lists the known failing targets. Repair only the necessary target(s) and preserve unrelated valid fields.\n"
                        "- repair_instruction.must_change_targeted_fields=true means returning the same invalid value at a targeted path is not a repair.\n"
                        "- If repair_instruction.must_change_any_of_paths is nonempty, at least ONE listed path must return a different valid value; the others may remain unchanged.\n"
                        "- If repair_instruction.must_change_groups is nonempty, EACH group represents one hard constraint; at least ONE path inside EACH group must change to a different valid value. A change that satisfies only one group is not a complete repair.\n"
                        "- Every path in repair_instruction.must_be_nonempty_paths must return a nonblank semantic value. Empty string, whitespace, null, unknown/unspecified wording, or omission is invalid.\n"
                        "- Return the complete stage JSON object after repair, not a patch.\n"
                        f"- Current repair targets: {targets}. Must change any of: {change_any}. Must-change groups: {change_groups}. Required nonblank targets: {nonempty}."
                    )
                estimated_input_chars = len(call_prompt) + self._compact_chars(call_payload)
                try:
                    candidate_raw = model.generate_json(model_stage, call_prompt, call_payload)
                except Exception as model_exc:
                    usage = self._consume_model_usage(model)
                    call_metrics = self._record_model_usage(
                        run, unit_id=unit_id, stage=stage, model_stage=model_stage, is_repair=is_repair_call,
                        usage=usage, estimated_input_chars=estimated_input_chars, output_chars=0,
                    )
                    failure_kind = str(getattr(model_exc, "kind", "provider_model_unclassified"))
                    model_retryable = getattr(model_exc, "retryable", None)
                    # Exceptions raised inside the provider/model boundary are retriable by default
                    # unless the adapter explicitly classifies them as permanent.
                    retryable = bool(True if model_retryable is None else model_retryable)
                    status_code = getattr(model_exc, "status_code", None)
                    transport_attempts = int(getattr(model_exc, "transport_attempts", 1) or 1)
                    provider_code = getattr(model_exc, "provider_code", None)
                    provider_message = getattr(model_exc, "provider_message", None)
                    request_id = getattr(model_exc, "request_id", None)
                    retry_after_seconds = getattr(model_exc, "retry_after_seconds", None)
                    unit["attempts"].append({
                        "attempt": attempt,
                        "status": "model_failed",
                        "error": str(model_exc),
                        "errors": [],
                        "failure_kind": failure_kind,
                        "retryable": retryable,
                        "status_code": status_code,
                        "transport_attempts": transport_attempts,
                        "provider_code": provider_code,
                        "provider_message": provider_message,
                        "request_id": request_id,
                        "retry_after_seconds": retry_after_seconds,
                        "usage": copy.deepcopy(call_metrics),
                    })
                    unit["failure_kind"] = failure_kind
                    unit["retryable"] = retryable
                    self._save(run)
                    raise

                usage = self._consume_model_usage(model)
                call_metrics = self._record_model_usage(
                    run, unit_id=unit_id, stage=stage, model_stage=model_stage, is_repair=is_repair_call,
                    usage=usage, estimated_input_chars=estimated_input_chars,
                    output_chars=self._compact_chars(candidate_raw),
                )

                envelope_errors: list[dict[str, Any]] = []
                if enforce_model_envelope:
                    candidate, envelope_errors = extract_model_stage_output(model_stage, candidate_raw)
                else:
                    candidate = extract(candidate_raw)

                if envelope_errors:
                    normalized, errors, normalizations = candidate, envelope_errors, 0
                else:
                    normalized, errors, normalizations = validate(candidate)
                unit["normalization_count"] += normalizations

                soft_types = set(soft_error_types or ())
                quality_warnings = [copy.deepcopy(e) for e in errors if str(e.get("type") or "") in soft_types]
                hard_errors = [copy.deepcopy(e) for e in errors if str(e.get("type") or "") not in soft_types]

                if (
                    is_repair_call
                    and last_invalid_normalized is not None
                    and hard_errors
                    and normalized == last_invalid_normalized
                ):
                    hard_errors.append({
                        "type": "repair_no_effect",
                        "detail": "repair returned the same normalized stage output as the previous invalid attempt",
                        "repair_targets": list((call_payload.get("repair_instruction") or {}).get("repair_targets") or []),
                    })

                # Heuristic quality checks are advisory only. They must never trigger
                # model Repair, because doing so lets a regex/lint heuristic rewrite
                # Storyboard content and makes repeated runs drift. Only structural /
                # factual contract errors are repairable hard failures.
                if not hard_errors:
                    attempt_status = "passed_with_quality_warnings" if quality_warnings else "passed"
                    unit["attempts"].append({
                        "attempt": attempt,
                        "status": attempt_status,
                        "errors": [],
                        "quality_warnings": copy.deepcopy(quality_warnings),
                        "validation_summary": {
                            "hard_error_types": [],
                            "quality_warning_types": sorted({str(e.get("type") or "") for e in quality_warnings if e.get("type")}),
                        },
                        "usage": copy.deepcopy(call_metrics),
                    })
                    unit.update(
                        status="completed",
                        finished_at=_now(),
                        error=None,
                        repair_count=attempt - 1,
                        quality_warnings=copy.deepcopy(quality_warnings),
                    )
                    self._sync_unit_quality_warnings(run, unit_id=unit_id, stage=stage, warnings=quality_warnings)
                    repair_hints = (run.get("recovery") or {}).get("source_repair_hints")
                    if isinstance(repair_hints, dict):
                        repair_hints.pop(unit_id, None)
                    record = {
                        **copy.deepcopy(unit),
                        "model_stage": model_stage,
                        "raw_model_output": copy.deepcopy(candidate_raw),
                        "output": copy.deepcopy(normalized),
                    }
                    self.checkpoints.save(run["run_id"], unit_id, record)
                    event_type = "unit_completed_with_quality_warnings" if quality_warnings else "unit_completed"
                    message = f"{len(quality_warnings)} quality warning(s)" if quality_warnings else None
                    self._event(run, event_type, unit_id=unit_id, stage=stage, status="completed", message=message)
                    self._save(run)
                    return normalized

                repair_instruction_summary = None
                if is_repair_call:
                    instruction = call_payload.get("repair_instruction") or {}
                    repair_instruction_summary = {
                        "mode": instruction.get("mode"),
                        "repair_targets": copy.deepcopy(instruction.get("repair_targets") or []),
                        "must_change_any_of_paths": copy.deepcopy(instruction.get("must_change_any_of_paths") or []),
                        "must_change_groups": copy.deepcopy(instruction.get("must_change_groups") or []),
                        "must_be_nonempty_paths": copy.deepcopy(instruction.get("must_be_nonempty_paths") or []),
                    }
                unit["attempts"].append({
                    "attempt": attempt,
                    "status": "validation_failed",
                    "errors": copy.deepcopy(hard_errors),
                    "quality_warnings": copy.deepcopy(quality_warnings),
                    "repair_instruction": repair_instruction_summary,
                    "validation_summary": {
                        "hard_error_types": sorted({str(e.get("type") or "") for e in hard_errors if e.get("type")}),
                        "quality_warning_types": sorted({str(e.get("type") or "") for e in quality_warnings if e.get("type")}),
                    },
                    "usage": copy.deepcopy(call_metrics),
                })
                last_invalid_normalized = copy.deepcopy(normalized)
                if attempt <= repair_budget:
                    unit["repair_count"] = attempt
                    run.setdefault("recovery", {}).setdefault("total_repairs", 0)
                    run["recovery"]["total_repairs"] += 1
                    repaired = run["recovery"].setdefault("repaired_units", [])
                    if unit_id not in repaired:
                        repaired.append(unit_id)
                    self._save(run)
            unit["failure_kind"] = "stage_contract_validation"
            unit["retryable"] = True
            # Preserve the final invalid model output and exact validator errors across
            # a paused Retry. Otherwise retry_current starts again from the identical
            # temperature-0 prompt and deterministically reproduces the same failure.
            hints = run.setdefault("recovery", {}).setdefault("source_repair_hints", {})
            hints[unit_id] = {
                "origin_gate": None,
                "validation_errors": copy.deepcopy(unit["attempts"][-1]["errors"]),
                "invalid_output": copy.deepcopy(candidate_raw),
            }
            raise ValueError(f"unit validation failed after {repair_budget} repair(s): {unit['attempts'][-1]['errors']}")
        except Exception as exc:
            failed_at = _now()
            failure_kind = str(getattr(exc, "kind", unit.get("failure_kind") or "stage_execution_failure"))
            exc_retryable = getattr(exc, "retryable", None)
            unit_retryable = unit.get("retryable")
            retryable = bool(exc_retryable if exc_retryable is not None else (True if unit_retryable is None else unit_retryable))
            status_code = getattr(exc, "status_code", None)
            transport_attempts = int(getattr(exc, "transport_attempts", 1) or 1)
            provider_code = getattr(exc, "provider_code", None)
            provider_message = getattr(exc, "provider_message", None)
            request_id = getattr(exc, "request_id", None)
            retry_after_seconds = getattr(exc, "retry_after_seconds", None)
            failed_status = "failed_recoverable" if retryable else "failed"
            retry_mode = RETRY_MODE_RETRY_CURRENT if retryable else RETRY_MODE_INSPECT_RUNTIME
            failure_signature = unit_input_hash({
                "unit_id": unit_id, "stage": stage, "failure_kind": failure_kind,
                "message": str(exc), "status_code": status_code,
            })
            unit.update(
                status=failed_status,
                finished_at=failed_at,
                error=str(exc),
                failure_kind=failure_kind,
                retryable=retryable,
                retry_mode=retry_mode,
                failure_signature=failure_signature,
            )
            self.checkpoints.save(run["run_id"], unit_id, {**copy.deepcopy(unit), "output": None})
            run["status"] = "paused"
            run["error"] = {
                "unit_id": unit_id,
                "stage": stage,
                "model_stage": model_stage,
                "contract_id": contract_id,
                "build_id": self.BUILD_ID,
                "repair_count": int(unit.get("repair_count") or 0),
                "message": str(exc),
                "failure_kind": failure_kind,
                "retryable": retryable,
                "retry_mode": retry_mode,
                "status_code": status_code,
                "transport_attempts": transport_attempts,
                "provider_code": provider_code,
                "provider_message": provider_message,
                "request_id": request_id,
                "retry_after_seconds": retry_after_seconds,
            }
            history = run.setdefault("failure_history", [])
            if not history or history[-1].get("failure_signature") != failure_signature:
                history.append({
                    "unit_id": unit_id,
                    "stage": stage,
                    "message": str(exc),
                    "failure_kind": failure_kind,
                    "retryable": retryable,
                    "retry_mode": retry_mode,
                    "status_code": status_code,
                    "transport_attempts": transport_attempts,
                    "provider_code": provider_code,
                    "provider_message": provider_message,
                    "request_id": request_id,
                    "retry_after_seconds": retry_after_seconds,
                    "failure_signature": failure_signature,
                    "failed_at": failed_at,
                    "attempts": copy.deepcopy(unit.get("attempts", [])),
                })
            self._event(run, "unit_failed", unit_id=unit_id, stage=stage, status=failed_status, message=str(exc))
            self._save(run)
            raise RuntimePaused(str(exc)) from exc


    def _execute_optional_model_unit(
        self,
        run: dict[str, Any],
        *,
        unit_id: str,
        stage: str,
        contract_version: str,
        model_stage: str,
        payload: dict[str, Any],
        prompt: str,
        validate: Callable[[Any], tuple[Any, list[dict[str, Any]], int]],
        enforce_model_envelope: bool = True,
    ) -> tuple[Any, str]:
        """Execute a quality-enhancement model unit without pausing the Fact Spine.

        Unlike _execute_unit(), any provider/contract failure is recorded as an
        explicit unavailable Scene Context status and the caller continues in
        legacy mode. Successful outputs still use normal input-hash + contract
        checkpoint reuse.
        """
        contract_id = f"{contract_version}|model-envelope.v1"
        reusable = self.checkpoints.get_reusable(
            run["run_id"], unit_id, payload, contract_id=contract_id
        )
        if reusable is not None:
            scene_status = str(reusable.get("scene_context_status") or ("repaired" if int(reusable.get("repair_count") or 0) else "available"))
            self._set_unit(
                run, unit_id, stage=stage, model_stage=model_stage, status="completed",
                input_hash=reusable["input_hash"], contract_id=contract_id,
                attempts=copy.deepcopy(reusable.get("attempts", [])),
                repair_count=int(reusable.get("repair_count") or 0),
                normalization_count=int(reusable.get("normalization_count") or 0),
                reused=True, error=None, failure_kind=None, retryable=None,
                scene_context_status=scene_status,
            )
            self._event(run, "optional_unit_reused", unit_id=unit_id, stage=stage, status="completed")
            self._save(run)
            return copy.deepcopy(reusable.get("output") or {}), scene_status

        input_hash = unit_input_hash(payload)
        unit = self._set_unit(
            run, unit_id, stage=stage, model_stage=model_stage, status="running",
            input_hash=input_hash, contract_id=contract_id, attempts=[], repair_count=0,
            normalization_count=0, reused=False, error=None, failure_kind=None,
            retryable=None, started_at=_now(), finished_at=None,
            scene_context_status=None,
            contract_trace={
                "contract_id": contract_id,
                "payload_contract_version": payload.get("contract_version"),
                "has_output_contract": isinstance(payload.get("output_contract"), dict),
                "has_output_template": isinstance(payload.get("output_template"), dict),
                "repair_budget": int(self.REPAIR_BUDGETS.get(model_stage, 1)),
                "failure_policy": "fallback",
            },
        )
        self._event(run, "optional_unit_started", unit_id=unit_id, stage=stage, status="running")
        self._save(run)
        repair_budget = int(self.REPAIR_BUDGETS.get(model_stage, 1))
        candidate_raw: Any = None

        def finish_unavailable(scene_status: str, exc: Exception | None = None, errors: list[dict[str, Any]] | None = None) -> tuple[dict[str, Any], str]:
            unit.update(
                status="completed", finished_at=_now(), error=None,
                optional_error=str(exc) if exc else None,
                failure_kind=None, retryable=None, scene_context_status=scene_status,
            )
            if errors:
                unit["optional_validation_errors"] = copy.deepcopy(errors)
            # Never cache an unavailable optional result: a Resume after provider
            # recovery should be allowed to try Scene Context again.
            self.checkpoints.delete(run["run_id"], unit_id)
            self._event(
                run, "optional_unit_fallback", unit_id=unit_id, stage=stage,
                status="completed", message=scene_status,
            )
            self._save(run)
            return {}, scene_status

        for attempt in range(1, repair_budget + 2):
            is_repair = attempt > 1
            route_stage = f"{model_stage}_repair" if is_repair else model_stage
            model = self.router.for_stage(route_stage)
            call_payload = copy.deepcopy(payload)
            if is_repair:
                previous_errors = copy.deepcopy(unit["attempts"][-1].get("errors") or [])
                call_payload["repair_instruction"] = {
                    "mode": "repair_current_optional_unit_only",
                    "validation_errors": previous_errors,
                    "invalid_output": copy.deepcopy(candidate_raw),
                    **self._repair_policy(model_stage, previous_errors),
                }
            # Match the hard-unit contract: use the caller-supplied canonical
            # system prompt on the first attempt, then the registered repair
            # prompt for the single local repair.
            call_prompt = model_system_prompt(model_stage, repair=True) if is_repair else prompt
            estimated_input_chars = len(call_prompt) + self._compact_chars(call_payload)
            try:
                candidate_raw = model.generate_json(model_stage, call_prompt, call_payload)
            except Exception as exc:
                usage = self._consume_model_usage(model)
                metrics = self._record_model_usage(
                    run, unit_id=unit_id, stage=stage, model_stage=model_stage,
                    is_repair=is_repair, usage=usage,
                    estimated_input_chars=estimated_input_chars, output_chars=0,
                )
                unit["attempts"].append({
                    "attempt": attempt, "status": "model_failed", "error": str(exc),
                    "errors": [], "usage": copy.deepcopy(metrics),
                    "failure_kind": str(getattr(exc, "kind", "provider_model_unclassified")),
                })
                return finish_unavailable("unavailable_provider_error", exc=exc)

            usage = self._consume_model_usage(model)
            metrics = self._record_model_usage(
                run, unit_id=unit_id, stage=stage, model_stage=model_stage,
                is_repair=is_repair, usage=usage,
                estimated_input_chars=estimated_input_chars,
                output_chars=self._compact_chars(candidate_raw),
            )
            if enforce_model_envelope:
                candidate, envelope_errors = extract_model_stage_output(model_stage, candidate_raw)
            else:
                candidate, envelope_errors = candidate_raw, []
            if envelope_errors:
                normalized, errors, normalizations = candidate, envelope_errors, 0
            else:
                normalized, errors, normalizations = validate(candidate)
            unit["normalization_count"] = int(unit.get("normalization_count") or 0) + int(normalizations)
            if not errors:
                scene_status = "repaired" if is_repair else "available"
                unit["attempts"].append({
                    "attempt": attempt, "status": "passed", "errors": [],
                    "usage": copy.deepcopy(metrics),
                })
                unit.update(
                    status="completed", finished_at=_now(), error=None,
                    repair_count=attempt - 1, scene_context_status=scene_status,
                )
                record = {
                    **copy.deepcopy(unit), "model_stage": model_stage,
                    "raw_model_output": copy.deepcopy(candidate_raw),
                    "output": copy.deepcopy(normalized),
                }
                self.checkpoints.save(run["run_id"], unit_id, record)
                self._event(run, "optional_unit_completed", unit_id=unit_id, stage=stage, status="completed", message=scene_status)
                self._save(run)
                return normalized, scene_status

            unit["attempts"].append({
                "attempt": attempt, "status": "validation_failed",
                "errors": copy.deepcopy(errors), "usage": copy.deepcopy(metrics),
            })
            if attempt <= repair_budget:
                unit["repair_count"] = attempt
                self._save(run)
                continue
            return finish_unavailable("unavailable_after_repair", errors=errors)

        return finish_unavailable("unavailable_after_repair")



    def _run_story_bible_stage(self, run: dict[str, Any], source_text: str) -> dict[str, Any]:
        unit_id = "story_bible"
        source_index = copy.deepcopy(run.get("source_index") or build_source_index(source_text))
        payload = whole_stage_payload("story_bible", source_text, {}, unit_id, source_index=source_index)

        def validate(value: Any):
            if not isinstance(value, dict):
                return value, [_unit_shape_error("story_bible", "object", value)], 0
            normalized, changes = canonicalize_story_bible(value, run_id=run["run_id"], source_text=source_text, source_index=source_index)
            # Legacy exact-quote checkpoints remain repairable, but v5 evidence is source-ref owned.
            normalized, evidence_changes = reanchor_story_bible_evidence(normalized, source_text=source_text)
            changes += evidence_changes
            normalized, fact_warnings, fact_changes = sanitize_unverifiable_explicit_facts(normalized)
            changes += fact_changes
            normalized, identity_warnings, identity_changes = sanitize_unproven_identity_attributes(normalized)
            changes += identity_changes
            errors = validate_story_bible_output(normalized, source_text=source_text, require_fact_provenance=True, source_index=source_index)
            errors.extend(fact_warnings)
            errors.extend(identity_warnings)
            return normalized, errors, changes

        return self._execute_unit(
            run, unit_id=unit_id, stage="story_bible", model_stage="story_bible",
            payload=payload, prompt=system_prompt("story_bible"), extract=lambda x: x, validate=validate,
            soft_error_types=STORY_BIBLE_SOFT_ERROR_TYPES, enforce_model_envelope=True,
        )

    def _run_scene_plan_stage(self, run: dict[str, Any], source_text: str, story_bible: dict[str, Any]) -> dict[str, Any]:
        unit_id = "scene_plan"
        source_index = copy.deepcopy(run.get("source_index") or build_source_index(source_text))
        payload = whole_stage_payload("scene_plan", source_text, {"story_bible": story_bible}, unit_id, source_index=source_index)

        def validate(value: Any):
            if not isinstance(value, dict):
                return value, [_unit_shape_error("scene_plan", "object", value)], 0
            normalized, changes = canonicalize_scene_plan(value, source_text=source_text, source_index=source_index, story_bible=story_bible)
            errors = validate_scene_plan_output(story_bible, normalized, source_text=source_text, require_beat_provenance=True, source_index=source_index)
            return normalized, errors, changes

        return self._execute_unit(
            run, unit_id=unit_id, stage="scene_plan", model_stage="scene_plan",
            payload=payload, prompt=system_prompt("scene_plan"), extract=lambda x: x, validate=validate,
            soft_error_types=SCENE_PLAN_SOFT_ERROR_TYPES, enforce_model_envelope=True,
        )

    def _run_script_units(self, run: dict[str, Any], source_text: str, story: dict[str, Any], plan: dict[str, Any]) -> dict[str, Any]:
        scenes = []
        for plan_scene in plan.get("scenes", []) or []:
            sid = str(plan_scene.get("scene_id"))
            unit_id = f"script:{sid}"
            payload = build_script_scene_payload(source_text, story, plan_scene, unit_id=unit_id)

            def validate_script_unit(value: Any, ps=plan_scene):
                if not isinstance(value, dict):
                    return value, [_unit_shape_error("scene", "object", value)], 0
                normalized, changes = canonicalize_script_scene(ps, value, source_text=source_text, story_bible=story)
                errors = validate_script_scene_output(story, ps, normalized, source_text=source_text)
                return normalized, errors, changes

            scene = self._execute_unit(
                run, unit_id=unit_id, stage="script", model_stage="script_scene", payload=payload, prompt=system_prompt("script_scene"),
                extract=lambda x: x,
                validate=validate_script_unit,
                soft_error_types=SCRIPT_SOFT_ERROR_TYPES,
                enforce_model_envelope=True,
            )
            scenes.append(scene)
        script = {"scenes": scenes}
        errors = validate_script(story, plan, script, source_text=source_text)
        script_source_units = _ordered_unique([
            f"script:{e.get('scene_id')}" for e in errors if e.get("scene_id")
        ])
        if errors and not script_source_units:
            script_source_units = [f"script:{s.get('scene_id')}" for s in scenes if s.get("scene_id")]
        self._enforce_stage_gate(
            run, stage="script", unit_id="script:gate", errors=errors, validation_key="script",
            failure_kind="script_assembly_gate", message=f"assembled script validation failed: {errors}",
            source_unit_ids=script_source_units,
        )
        return script

    def _run_storyboard_units(self, run: dict[str, Any], source_text: str, story: dict[str, Any], plan: dict[str, Any], script: dict[str, Any]) -> dict[str, Any]:
        script_map = {str(s.get("scene_id")): s for s in script.get("scenes", []) or []}
        scenes = []
        for plan_scene in plan.get("scenes", []) or []:
            sid = str(plan_scene.get("scene_id"))
            script_scene = script_map[sid]
            unit_id = f"storyboard:{sid}"
            payload = build_storyboard_scene_payload(plan_scene, script_scene, story_bible=story, source_text=source_text, unit_id=unit_id)

            def validate_storyboard_unit(value: Any, ps=plan_scene, ss=script_scene):
                if not isinstance(value, dict):
                    return value, [_unit_shape_error("scene", "object", value)], 0
                normalized, changes = canonicalize_storyboard_scene(ps, value, ss, payload.get("beat_source_authority") or {})
                errors = validate_storyboard_scene_output(
                    ps, ss, normalized,
                    prop_manifest=payload.get("prop_manifest") or {},
                    beat_source_authority=payload.get("beat_source_authority") or {},
                    model_allocation=value,
                )
                return normalized, errors, changes

            scene = self._execute_unit(
                run, unit_id=unit_id, stage="storyboard", model_stage="storyboard_scene", payload=payload, prompt=system_prompt("storyboard_scene"),
                extract=lambda x: x,
                validate=validate_storyboard_unit,
                soft_error_types=STORYBOARD_SOFT_ERROR_TYPES,
                enforce_model_envelope=True,
            )
            scenes.append(scene)
        board, changes = normalize_storyboard_shot_ids({"scenes": scenes})
        self._remap_storyboard_quality_warnings(run, board)
        if changes:
            self._set_unit(run, "storyboard:merge", stage="storyboard", status="completed", normalization_count=changes, repair_count=0, error=None, attempts=[], reused=False)
        errors = validate_storyboard_base(story, plan, board, script=script)
        shot_scene = {
            str(shot.get("shot_id")): str(scene.get("scene_id"))
            for scene in board.get("scenes", []) or []
            for shot in scene.get("shots", []) or []
            if shot.get("shot_id") and scene.get("scene_id")
        }
        storyboard_source_units: list[str] = []
        for error in errors:
            scene_id = str(error.get("scene_id") or shot_scene.get(str(error.get("shot_id") or "")) or "")
            if scene_id:
                storyboard_source_units.append(f"storyboard:{scene_id}")
        storyboard_source_units = _ordered_unique(storyboard_source_units)
        if errors and not storyboard_source_units:
            storyboard_source_units = [f"storyboard:{s.get('scene_id')}" for s in scenes if s.get("scene_id")]
        self._enforce_stage_gate(
            run, stage="storyboard", unit_id="storyboard:gate", errors=errors, validation_key="storyboard_base",
            failure_kind="storyboard_assembly_gate", message=f"assembled storyboard validation failed: {errors}",
            source_unit_ids=storyboard_source_units,
        )
        return board

    @staticmethod
    def _storyboard_shot_map(board: dict[str, Any]) -> dict[str, dict[str, Any]]:
        return {
            str(shot.get("shot_id") or ""): shot
            for scene in (board.get("scenes") or []) if isinstance(scene, dict)
            for shot in (scene.get("shots") or []) if isinstance(shot, dict) and shot.get("shot_id")
        }

    @staticmethod
    def _scene_map(value: dict[str, Any]) -> dict[str, dict[str, Any]]:
        return {
            str(scene.get("scene_id") or ""): scene
            for scene in (value.get("scenes") or []) if isinstance(scene, dict) and scene.get("scene_id")
        }

    def _run_storyboard_redistribution_fragments(
        self,
        run: dict[str, Any],
        *,
        plan: dict[str, Any],
        board: dict[str, Any],
        scene_plan: dict[str, Any],
        script: dict[str, Any],
    ) -> dict[str, dict[str, Any]]:
        shots = self._storyboard_shot_map(board)
        plan_scenes = self._scene_map(scene_plan)
        script_scenes = self._scene_map(script)
        fragments: dict[str, dict[str, Any]] = {}
        for shot_plan in plan.get("shot_plans") or []:
            if not isinstance(shot_plan, dict) or shot_plan.get("plan_status") != "preview_ready":
                continue
            source_shot_id = str(shot_plan.get("source_shot_id") or "")
            source_shot = shots.get(source_shot_id)
            if not source_shot:
                raise ValueError(f"redistribution source shot not found: {source_shot_id}")
            scene_id = str(source_shot.get("scene_id") or "")
            plan_scene = plan_scenes.get(scene_id)
            script_scene = script_scenes.get(scene_id)
            if not plan_scene or not script_scene:
                raise ValueError(f"redistribution scene authority missing: {scene_id}")
            unit_id = f"storyboard_redistribution:{source_shot_id}"
            payload = build_redistribution_fragment_payload(
                shot_plan=shot_plan,
                source_shot=source_shot,
                scene_plan_scene=plan_scene,
                script_scene=script_scene,
                unit_id=unit_id,
            )

            def validate_fragment(value: Any, pl=payload):
                if not isinstance(value, dict):
                    return value, [_unit_shape_error("replacement", "object", value)], 0
                normalized, changes = canonicalize_redistribution_fragment(value, payload=pl)
                errors = validate_redistribution_fragment(normalized, payload=pl)
                return normalized, errors, changes

            fragment = self._execute_unit(
                run,
                unit_id=unit_id,
                stage="storyboard_redistribution",
                model_stage=STORYBOARD_REDISTRIBUTION_MODEL_STAGE,
                payload=payload,
                prompt=system_prompt(STORYBOARD_REDISTRIBUTION_MODEL_STAGE),
                extract=lambda x: x,
                validate=validate_fragment,
                enforce_model_envelope=True,
            )
            fragments[source_shot_id] = fragment
        return fragments

    @staticmethod
    def _redistribution_source_hash(board: dict[str, Any], script: dict[str, Any]) -> str:
        return unit_input_hash({"storyboard_base": board, "script": script})

    def _resolve_storyboard_redistribution_override(
        self,
        run: dict[str, Any],
        *,
        canonical_board: dict[str, Any],
        script: dict[str, Any],
    ) -> dict[str, Any]:
        override = (run.get("artifacts") or {}).get("storyboard_redistribution_override")
        if not isinstance(override, dict):
            return canonical_board
        expected_hash = str(override.get("source_authority_hash") or "")
        actual_hash = self._redistribution_source_hash(canonical_board, script)
        if not expected_hash or expected_hash != actual_hash:
            run.get("artifacts", {}).pop("storyboard_redistribution_override", None)
            self._event(
                run, "storyboard_redistribution_override_invalidated",
                stage="storyboard_redistribution", status="pending",
                message="upstream Storyboard/Script authority changed",
            )
            return canonical_board
        applied_board = override.get("storyboard_base")
        return copy.deepcopy(applied_board) if isinstance(applied_board, dict) else canonical_board

    def _invalidate_downstream_after_redistribution(self, run: dict[str, Any], new_board: dict[str, Any]) -> None:
        current_ids = {
            str(shot.get("shot_id") or "")
            for scene in (new_board.get("scenes") or []) if isinstance(scene, dict)
            for shot in (scene.get("shots") or []) if isinstance(shot, dict) and shot.get("shot_id")
        }
        units = run.get("units") or {}
        for unit_id in list(units):
            if unit_id.startswith("director_scene:"):
                units.pop(unit_id, None)
                self.checkpoints.delete(run["run_id"], unit_id)
                continue
            if unit_id.startswith("production_semantics:") or unit_id.startswith("director:"):
                suffix = unit_id.split(":", 1)[1] if ":" in unit_id else ""
                if suffix in {"gate", "preflight"} or (suffix.startswith("SH") and suffix not in current_ids):
                    units.pop(unit_id, None)
                    self.checkpoints.delete(run["run_id"], unit_id)
        for unit_id in ("production_semantics:gate", "director:preflight", "director:gate", "state_shotspec", "compile"):
            units.pop(unit_id, None)
            self.checkpoints.delete(run["run_id"], unit_id)
        validations = run.setdefault("validations", {})
        for key in ("production_semantics", "director_prerequisites", "director", "state_shotspec", "duration_authority", "static_evaluation", "consumption_evaluation", "production_readiness"):
            validations.pop(key, None)
        artifacts = run.setdefault("artifacts", {})
        for key in (
            "production_semantics", "director_scene_contexts", "storyboard_partial", "storyboard", "shot_specs",
            "compiled_project", "consumption_v1_compiled_project", "legacy_compiled_project",
            "static_evaluation", "consumption_evaluation", "production_readiness",
            "duration_authority_report",
        ):
            artifacts.pop(key, None)
        run.pop("compiler_version", None)
        run.pop("compile_status", None)
        run["status"] = "pending"
        run["current_stage"] = "storyboard_redistribution"
        run["current_unit"] = None
        run["error"] = None

    def _run_downstream_from_storyboard_base(self, run: dict[str, Any], artifacts: dict[str, Any]) -> None:
        artifacts["production_semantics"] = self._run_production_semantics_units(
            run, artifacts["story_bible"], artifacts["script"], artifacts["storyboard_base"]
        )
        self._enforce_production_semantics_readiness(run, artifacts["production_semantics"])
        artifacts["storyboard"] = self._run_director_units(
            run,
            artifacts["story_bible"], artifacts["script"], artifacts["storyboard_base"],
            artifacts["scene_plan"], artifacts["production_semantics"],
        )
        director_validation = validate_storyboard_director_v1_3a(
            artifacts["story_bible"], artifacts["script"], artifacts["storyboard"]
        )
        director_errors = [copy.deepcopy(e) for e in _filter_runtime_director_core_errors(
            list(director_validation.get("errors") or []), artifacts["script"], artifacts["storyboard"]
        )]
        director_source_units = _ordered_unique([
            f"director:{e.get('shot_id')}" for e in director_errors if e.get("shot_id")
        ])
        self._enforce_stage_gate(
            run, stage="director", unit_id="director:gate", errors=director_errors,
            validation_key="director", failure_kind="director_assembly_gate",
            message=f"assembled director validation failed: {director_errors}",
            source_unit_ids=director_source_units,
        )
        artifacts["shot_specs"] = self._run_state_shotspec_stage(
            run, artifacts["storyboard"], artifacts["scene_plan"]
        )
        run["validations"]["state_shotspec"] = {"passed": True, "errors": []}
        self._apply_final_shotspec_duration_authority(run, artifacts)
        self._compile(run, artifacts)
        run["counts"] = {
            "characters": len(artifacts["story_bible"].get("characters", []) or []),
            "physical_scenes": len(artifacts["story_bible"].get("scenes", []) or []),
            "beats": sum(len(s.get("beat_list", []) or []) for s in artifacts["scene_plan"].get("scenes", []) or []),
            "shots": len(artifacts["shot_specs"]),
            "character_prompts": len(artifacts["compiled_project"].get("character_prompts", []) or []),
            "scene_prompts": len(artifacts["compiled_project"].get("scene_prompts", []) or []),
            "shot_prompts": len(artifacts["compiled_project"].get("shot_prompts", []) or []),
        }

    def _finalize_storyboard_redistribution_after_downstream(self, run: dict[str, Any]) -> None:
        redistribution = run.get("storyboard_redistribution")
        artifacts = run.get("artifacts") or {}
        if not isinstance(redistribution, dict) or not isinstance(artifacts.get("storyboard_redistribution_override"), dict):
            return
        post_feedback = build_storyboard_overload_feedback(run)
        redistribution["post_apply_feedback"] = copy.deepcopy(post_feedback)
        redistribution["residual_overloaded_shot_ids"] = list(post_feedback.get("overloaded_shot_ids") or [])
        counts = post_feedback.get("classification_counts") or {}
        redistribution["residual_warning_count"] = int(counts.get("warning") or 0)
        redistribution["status"] = "completed"

    def redistribute_overloaded_shots(self, run_id: str) -> dict[str, Any]:
        run = self.store.get(run_id)
        if run is None:
            raise KeyError(run_id)
        previous_build = str(run.get("build_id") or "")
        if previous_build and previous_build != self.BUILD_ID:
            self._event(
                run, "build_changed", stage="storyboard_redistribution", status="running",
                message=f"{previous_build} -> {self.BUILD_ID}",
            )
        run["build_id"] = self.BUILD_ID
        run["contracts"] = copy.deepcopy(self.CONTRACTS)
        if run.get("status") not in {"completed", "paused"}:
            raise ValueError("redistribution requires a completed run or a paused redistribution run")
        if run.get("status") == "paused" and str((run.get("error") or {}).get("stage") or "") != "storyboard_redistribution":
            raise ValueError("run is paused outside storyboard redistribution")
        artifacts = run.setdefault("artifacts", {})
        required = ("story_bible", "scene_plan", "script", "storyboard_base", "pvb", "psb", "style_guide")
        missing = [key for key in required if not isinstance(artifacts.get(key), (dict, list))]
        if missing:
            raise ValueError(f"redistribution prerequisites missing: {missing}")

        canonical_board = copy.deepcopy(artifacts["storyboard_base"])
        feedback = build_storyboard_overload_feedback(run)
        plan = build_storyboard_redistribution_plan(feedback)
        if not (plan.get("validation") or {}).get("passed"):
            raise ValueError(f"redistribution preview plan invalid: {(plan.get('validation') or {}).get('errors')}")
        ready = [x for x in (plan.get("shot_plans") or []) if isinstance(x, dict) and x.get("plan_status") == "preview_ready"]
        run["storyboard_redistribution"] = {
            "contract_version": STORYBOARD_REDISTRIBUTION_CONTRACT,
            "feedback": copy.deepcopy(feedback),
            "plan": copy.deepcopy(plan),
            "status": "planning" if ready else "no_safe_apply",
        }
        if not ready:
            self._event(run, "storyboard_redistribution_no_safe_apply", stage="storyboard_redistribution", status="completed")
            self._save(run)
            return run

        fragments = self._run_storyboard_redistribution_fragments(
            run, plan=plan, board=canonical_board, scene_plan=artifacts["scene_plan"], script=artifacts["script"]
        )
        new_board, apply_report = apply_redistribution_fragments(canonical_board, plan, fragments)
        board_errors = validate_storyboard_base(
            artifacts["story_bible"], artifacts["scene_plan"], new_board, script=artifacts["script"]
        )
        if board_errors:
            self._pause_deterministic_failure(
                run,
                unit_id="storyboard_redistribution:gate",
                stage="storyboard_redistribution",
                message=f"redistributed storyboard validation failed: {board_errors}",
                failure_kind="storyboard_redistribution_gate",
                errors=board_errors,
                retryable=False,
                retry_mode=RETRY_MODE_INSPECT_RUNTIME,
                source_unit_ids=[f"storyboard_redistribution:{x.get('source_shot_id')}" for x in ready],
            )

        source_hash = self._redistribution_source_hash(canonical_board, artifacts["script"])
        override = {
            "contract_version": STORYBOARD_REDISTRIBUTION_CONTRACT,
            "source_authority_hash": source_hash,
            "source_build_id": str(run.get("build_id") or ""),
            "storyboard_base": copy.deepcopy(new_board),
            "apply_report": copy.deepcopy(apply_report),
            "plan": copy.deepcopy(plan),
        }
        artifacts["storyboard_redistribution_override"] = override
        artifacts["storyboard_base"] = copy.deepcopy(new_board)
        run["validations"]["storyboard_base"] = {"passed": True, "errors": [], "redistributed": True}
        run["validations"]["storyboard_redistribution"] = {"passed": True, "errors": [], "apply_report": copy.deepcopy(apply_report)}
        run["storyboard_redistribution"].update({"status": "applied", "apply_report": copy.deepcopy(apply_report)})
        self._event(
            run, "storyboard_redistribution_applied", stage="storyboard_redistribution", status="completed",
            message=f"{apply_report.get('old_shot_count')} -> {apply_report.get('new_shot_count')} shots",
        )
        self._invalidate_downstream_after_redistribution(run, new_board)
        self._save(run)
        try:
            self._run_downstream_from_storyboard_base(run, artifacts)
        except RuntimePaused:
            # The applied Storyboard override is already durable. Returning the paused
            # run (rather than leaking RuntimePaused through the API) lets normal resume
            # re-enter _execute(), recover the canonical upstream Storyboard checkpoint,
            # and deterministically reapply this exact override before downstream work.
            run["storyboard_redistribution"]["status"] = "applied_downstream_paused"
            self._save(run)
            return run
        run["status"] = "completed"
        run["current_stage"] = "completed"
        run["current_unit"] = None
        run["error"] = None
        self._finalize_storyboard_redistribution_after_downstream(run)
        residual = len((run.get("storyboard_redistribution") or {}).get("residual_overloaded_shot_ids") or [])
        self._event(
            run, "storyboard_redistribution_completed", stage="storyboard_redistribution", status="completed",
            message=f"downstream rebuilt; residual overloaded shots: {residual}",
        )
        self._save(run)
        return run

    @staticmethod
    def _ceil_half_seconds(value: float) -> float:
        return max(0.5, (int(float(value) * 2 + 0.999999) / 2.0))

    @staticmethod
    def _board_shot_index(board: dict[str, Any]) -> dict[str, dict[str, Any]]:
        return {
            str(shot.get("shot_id") or ""): shot
            for scene in (board.get("scenes") or []) if isinstance(scene, dict)
            for shot in (scene.get("shots") or []) if isinstance(shot, dict) and shot.get("shot_id")
        }

    def _stabilize_duration_only_shots(
        self,
        board: dict[str, Any],
        feedback: dict[str, Any],
        *,
        allow_overloaded_unsplittable: bool,
    ) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
        """Deterministically extend shots whose allocation does not need creative replanning.

        Warning shots are extended to the conservative W003 floor. Overloaded shots are
        extended only when they contain one atomic FrozenText segment; splittable shots
        remain Storyboard-allocator work. No shot may exceed the current 15s contract.
        """
        out = copy.deepcopy(board)
        shot_map = self._board_shot_index(out)
        changes: list[dict[str, Any]] = []
        blockers: list[dict[str, Any]] = []
        for item in feedback.get("shots") or []:
            if not isinstance(item, dict):
                continue
            classification = str(item.get("classification") or "")
            if classification not in {"warning", "overloaded"}:
                continue
            resolution = item.get("resolution") if isinstance(item.get("resolution"), dict) else {}
            if classification == "overloaded":
                if not allow_overloaded_unsplittable or resolution.get("status") != "unsplittable_under_current_frozen_units":
                    continue
            shot_id = str(item.get("shot_id") or "")
            shot = shot_map.get(shot_id)
            if not shot:
                continue
            floor = float(item.get("provisional_shadow_estimate_seconds") or item.get("current_w003_estimate_seconds") or 0.0)
            target = self._ceil_half_seconds(floor)
            if target > 15.0:
                blockers.append({
                    "type": "duration_authority_exceeds_max_shot_duration",
                    "shot_id": shot_id,
                    "estimated_seconds": floor,
                    "max_seconds": 15.0,
                    "detail": "single atomic FrozenText unit exceeds the current 15s shot contract",
                })
                continue
            current = float(shot.get("duration") or 0.0)
            if target > current:
                shot["duration"] = target
                changes.append({
                    "shot_id": shot_id,
                    "from_seconds": current,
                    "to_seconds": target,
                    "reason": "warning_floor" if classification == "warning" else "unsplittable_atomic_floor",
                })
        return out, changes, blockers

    def _apply_preproduction_duration_authority(
        self,
        run: dict[str, Any],
        artifacts: dict[str, Any],
    ) -> None:
        """Resolve dialogue/narration duration before Production Semantics and Director.

        Multi-unit overload returns to the existing Storyboard redistribution fragment
        stage. Single atomic units are extended deterministically when <=15s. This is a
        production authority integration of the existing conservative W003 estimator;
        it is explicitly not a claim of real Seedance calibration.
        """
        board = artifacts["storyboard_base"]
        script = artifacts["script"]
        feedback = build_storyboard_overload_feedback_from_board(
            board, script, run_id=run.get("run_id", ""), build_id=self.BUILD_ID
        )
        board, duration_changes, blockers = self._stabilize_duration_only_shots(
            board, feedback, allow_overloaded_unsplittable=True
        )
        if blockers:
            self._pause_deterministic_failure(
                run, unit_id="duration_authority", stage="duration_authority",
                message=f"duration authority blocked: {blockers}",
                failure_kind="duration_authority_blocked", errors=blockers,
                retryable=False, retry_mode=RETRY_MODE_REGENERATE_SOURCES,
                source_unit_ids=[f"storyboard:{x.get('scene_id')}" for x in (feedback.get("shots") or []) if isinstance(x, dict) and x.get("shot_id") in {b.get("shot_id") for b in blockers}],
            )
        feedback = build_storyboard_overload_feedback_from_board(
            board, script, run_id=run.get("run_id", ""), build_id=self.BUILD_ID
        )
        plan = build_storyboard_redistribution_plan(feedback)
        if not (plan.get("validation") or {}).get("passed"):
            raise ValueError(f"duration redistribution plan invalid: {(plan.get('validation') or {}).get('errors')}")
        ready = [x for x in (plan.get("shot_plans") or []) if isinstance(x, dict) and x.get("plan_status") == "preview_ready"]
        blocked_overload = [
            x for x in (plan.get("shot_plans") or [])
            if isinstance(x, dict) and x.get("plan_status") == "blocked"
        ]
        if blocked_overload:
            errors = [{
                "type": "duration_authority_requires_manual_allocation",
                "shot_id": str(x.get("source_shot_id") or ""),
                "detail": str(x.get("blocked_reason") or "overloaded shot has no safe automatic allocation"),
            } for x in blocked_overload]
            self._pause_deterministic_failure(
                run, unit_id="duration_authority", stage="duration_authority",
                message=f"duration authority requires manual allocation: {errors}",
                failure_kind="duration_authority_allocation_blocked", errors=errors,
                retry_mode=RETRY_MODE_REGENERATE_SOURCES,
                source_unit_ids=[f"storyboard_redistribution:{x.get('source_shot_id')}" for x in blocked_overload if x.get("source_shot_id")],
            )
        apply_report = None
        if ready:
            fragments = self._run_storyboard_redistribution_fragments(
                run, plan=plan, board=board, scene_plan=artifacts["scene_plan"], script=script
            )
            board, apply_report = apply_redistribution_fragments(board, plan, fragments)
            board_errors = validate_storyboard_base(artifacts["story_bible"], artifacts["scene_plan"], board, script=script)
            if board_errors:
                self._pause_deterministic_failure(
                    run, unit_id="duration_authority:gate", stage="duration_authority",
                    message=f"duration-authority redistributed storyboard validation failed: {board_errors}",
                    failure_kind="duration_authority_storyboard_gate", errors=board_errors,
                    retry_mode=RETRY_MODE_REGENERATE_SOURCES,
                    source_unit_ids=[f"storyboard_redistribution:{x.get('source_shot_id')}" for x in ready],
                )
            # Replacement staging owns camera/composition, but final duration is still
            # normalized against the same deterministic speech floor.
            post = build_storyboard_overload_feedback_from_board(
                board, script, run_id=run.get("run_id", ""), build_id=self.BUILD_ID
            )
            board, post_changes, post_blockers = self._stabilize_duration_only_shots(
                board, post, allow_overloaded_unsplittable=True
            )
            duration_changes.extend(post_changes)
            if post_blockers:
                self._pause_deterministic_failure(
                    run, unit_id="duration_authority:post_apply", stage="duration_authority",
                    message=f"post-redistribution duration authority blocked: {post_blockers}",
                    failure_kind="duration_authority_post_apply_blocked", errors=post_blockers,
                    retryable=False, retry_mode=RETRY_MODE_REGENERATE_SOURCES,
                )
        final_feedback = build_storyboard_overload_feedback_from_board(
            board, script, run_id=run.get("run_id", ""), build_id=self.BUILD_ID
        )
        residual = [
            x for x in (final_feedback.get("shots") or [])
            if isinstance(x, dict) and x.get("classification") in {"warning", "overloaded", "unknown"}
        ]
        if residual:
            errors = [{
                "type": "duration_authority_residual_risk",
                "shot_id": str(x.get("shot_id") or ""),
                "classification": str(x.get("classification") or ""),
                "estimated_seconds": x.get("provisional_shadow_estimate_seconds"),
                "planned_seconds": x.get("planned_duration_seconds"),
            } for x in residual]
            self._pause_deterministic_failure(
                run, unit_id="duration_authority:final", stage="duration_authority",
                message=f"duration authority residual risk: {errors}",
                failure_kind="duration_authority_residual_risk", errors=errors,
                retry_mode=RETRY_MODE_REGENERATE_SOURCES,
            )
        artifacts["storyboard_base"] = board
        artifacts["duration_authority_report"] = {
            "status": "passed",
            "basis": "w003_conservative_unvalidated_real_seedance",
            "duration_changes": duration_changes,
            "redistribution_apply_report": copy.deepcopy(apply_report),
            "final_feedback": copy.deepcopy(final_feedback),
        }
        run.setdefault("validations", {})["duration_authority"] = {
            "passed": True, "errors": [], "duration_changes": copy.deepcopy(duration_changes)
        }

    def _apply_final_shotspec_duration_authority(self, run: dict[str, Any], artifacts: dict[str, Any]) -> None:
        """Close residual Director action cost before compilation.

        Allocation is already frozen here, so this stage may only extend a Shot to the
        conservative floor (<=15s). Any larger requirement is a hard production block.
        """
        shot_specs = artifacts.get("shot_specs") or []
        storyboard = artifacts.get("storyboard") or {}
        board_map = self._board_shot_index(storyboard if isinstance(storyboard, dict) else {})
        changes: list[dict[str, Any]] = []
        blockers: list[dict[str, Any]] = []
        for shot in shot_specs:
            if not isinstance(shot, dict):
                continue
            current = float(shot.get("duration") or 0.0)
            estimate = float(estimate_min_duration(shot))
            if estimate <= current + 0.25:
                continue
            target = self._ceil_half_seconds(estimate)
            shot_id = str(shot.get("shot_id") or "")
            if target > 15.0:
                blockers.append({
                    "type": "final_duration_authority_exceeds_max_shot_duration",
                    "shot_id": shot_id,
                    "estimated_seconds": estimate,
                    "max_seconds": 15.0,
                    "detail": "Director action + speech cannot fit current single-shot contract; return to Storyboard allocation",
                })
                continue
            shot["duration"] = target
            if shot_id in board_map:
                board_map[shot_id]["duration"] = target
            changes.append({"shot_id": shot_id, "from_seconds": current, "to_seconds": target, "estimated_seconds": estimate})
        if blockers:
            self._pause_deterministic_failure(
                run, unit_id="duration_authority:shotspec", stage="duration_authority",
                message=f"final duration authority blocked: {blockers}",
                failure_kind="final_duration_authority_blocked", errors=blockers,
                retry_mode=RETRY_MODE_REGENERATE_SOURCES,
                source_unit_ids=[f"storyboard:{x.get('shot_id')}" for x in blockers],
            )
        report = artifacts.setdefault("duration_authority_report", {"status": "passed", "basis": "w003_conservative_unvalidated_real_seedance"})
        report["final_shotspec_duration_changes"] = changes
        run.setdefault("validations", {}).setdefault("duration_authority", {"passed": True, "errors": []})["final_shotspec_duration_changes"] = copy.deepcopy(changes)

    def _run_asset_units(self, run: dict[str, Any], source_text: str, story: dict[str, Any], artifacts: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
        pvb_chars = []
        # Narrative importance is not the same as production visibility. Main/supporting
        # always receive PVB; background/referenced-only characters receive it when they
        # actually appear in a frozen Storyboard Shot.
        visible_character_refs = {
            str(ref)
            for scene in ((artifacts.get("storyboard_base") or {}).get("scenes", []) or [])
            if isinstance(scene, dict)
            for shot in (scene.get("shots", []) or [])
            if isinstance(shot, dict)
            for ref in (shot.get("character_refs", []) or [])
            if isinstance(ref, str) and ref
        }
        for char in story.get("characters", []) or []:
            cid = str(char.get("character_id") or "")
            if char.get("role_type") not in {"main", "supporting"} and cid not in visible_character_refs:
                continue
            unit_id = f"pvb:{cid}"
            payload = build_pvb_character_payload(char, unit_id=unit_id)
            result = self._execute_unit(
                run, unit_id=unit_id, stage="pvb", model_stage="pvb_character", payload=payload, prompt=system_prompt("pvb_character"),
                extract=lambda x: x,
                validate=lambda value, c=char: _validate_pvb_character_unit(c, value),
                enforce_model_envelope=True,
            )
            pvb_chars.append(result)
        pvb_candidate = {"characters": pvb_chars}

        psb_scenes = []
        for scene in story.get("scenes", []) or []:
            sid = str(scene.get("scene_id"))
            unit_id = f"psb:{sid}"
            payload = build_psb_scene_payload(scene, unit_id=unit_id)
            result = self._execute_unit(
                run, unit_id=unit_id, stage="psb", model_stage="psb_scene", payload=payload, prompt=system_prompt("psb_scene"),
                extract=lambda x: x,
                validate=lambda value, sf=scene: _validate_psb_scene_unit(sf, value),
                enforce_model_envelope=True,
            )
            psb_scenes.append(result)
        psb_candidate = {"scenes": psb_scenes}

        style_payload = build_style_guide_payload(source_text, story, unit_id="style_guide")
        style = self._execute_unit(
            run, unit_id="style_guide", stage="style_guide", model_stage="style_guide",
            payload=style_payload, prompt=system_prompt("style_guide"), extract=lambda x: x,
            validate=_validate_style_guide_unit,
            enforce_model_envelope=True,
        )
        return pvb_candidate, psb_candidate, style

    def _materialize_asset_prompts(self, run: dict[str, Any], artifacts: dict[str, Any]) -> None:
        """Lock completed production design and expose Character/Scene prompts early.

        This is deterministic Core v1.3 work, not an LLM stage. It allows partial
        results to remain useful even when a later Director Shot pauses the run.
        """
        unit_id = "compile:assets"
        self._set_unit(run, unit_id, stage="compile", status="running", started_at=_now(), repair_count=0, normalization_count=0, attempts=[], reused=False, error=None)
        self._save(run)
        try:
            locked_assets, lock_errors, lock_log = lock_production_assets(
                artifacts["story_bible"], artifacts["pvb_candidate"], artifacts["psb_candidate"], artifacts["style_guide_candidate"]
            )
            if lock_errors:
                run.setdefault("validations", {})["production_lock"] = {
                    "passed": False, "errors": copy.deepcopy(lock_errors), "policy": lock_log.get("policy"),
                }
                source_units: list[str] = []
                for item in lock_errors:
                    error_type = str(item.get("type") or "")
                    target_id = str(item.get("target_id") or "")
                    if error_type.startswith("pvb_") and target_id:
                        source_units.append(f"pvb:{target_id}")
                    elif error_type.startswith("psb_") and target_id:
                        source_units.append(f"psb:{target_id}")
                    elif error_type.startswith("style_"):
                        source_units.append("style_guide")
                if not source_units:
                    source_units = [
                        uid for uid, unit in run.get("units", {}).items()
                        if unit.get("stage") in {"pvb", "psb", "style_guide"}
                    ]
                self._pause_deterministic_failure(
                    run, unit_id=unit_id, stage="compile",
                    message=f"Production asset lock failed: {lock_errors}",
                    failure_kind="production_asset_lock_failure", errors=lock_errors,
                    retry_mode=RETRY_MODE_REGENERATE_SOURCES, source_unit_ids=source_units,
                )
            artifacts.update(locked_assets)
            artifacts["production_lock_log"] = lock_log
            run["validations"]["production_lock"] = {"passed": True, "errors": [], "policy": lock_log["policy"]}

            character_prompts = []
            pvb_ids = {str(x.get("character_id") or "") for x in artifacts["pvb"].get("characters", []) or [] if isinstance(x, dict)}
            for char in artifacts["story_bible"].get("characters", []) or []:
                char_id = str(char.get("character_id") or "")
                if char_id not in pvb_ids:
                    continue
                # Frozen v1.3 intentionally only emitted Character Prompts for
                # main/supporting roles. Runtime 2.1 instead keys production assets
                # by actual Storyboard visibility: a visible background/referenced-only
                # character has a PVB and therefore must have a consumable asset prompt.
                if char.get("role_type") in {"main", "supporting"}:
                    character_prompts.append(compile_character_prompt(
                        artifacts["story_bible"], artifacts["pvb"], artifacts["style_guide"], char_id, "production"
                    ))
                else:
                    character_prompts.append(compile_character_consumption_prompt(
                        artifacts["story_bible"], artifacts["pvb"], artifacts["style_guide"], char_id
                    ))
            scene_prompts = [
                compile_scene_prompt(artifacts["story_bible"], artifacts["psb"], artifacts["style_guide"], str(scene.get("scene_id")), "production")
                for scene in artifacts["story_bible"].get("scenes", []) or []
            ]
            artifacts["asset_prompts"] = {"character_prompts": character_prompts, "scene_prompts": scene_prompts}
            self._set_unit(run, unit_id, status="completed", finished_at=_now())
        except RuntimePaused:
            raise
        except Exception as exc:
            errors = [{"type": "production_asset_lock_runtime_failure", "detail": str(exc)}]
            self._pause_deterministic_failure(
                run, unit_id=unit_id, stage="compile", message=str(exc),
                failure_kind="production_asset_lock_runtime_failure", errors=errors,
                retryable=False, retry_mode=RETRY_MODE_INSPECT_RUNTIME,
            )
        self._save(run)

    def _run_production_semantics_units(
        self,
        run: dict[str, Any],
        story: dict[str, Any],
        script: dict[str, Any],
        board: dict[str, Any],
    ) -> dict[str, Any]:
        builder = ContextBuilder(story_bible=story, script=script, storyboard_base=board)
        outputs: list[dict[str, Any]] = []
        for scene in board.get("scenes", []) or []:
            for shot in scene.get("shots", []) or []:
                shot_id = str(shot.get("shot_id") or "")
                unit_id = f"production_semantics:{shot_id}"
                context = builder.production_semantics_context(shot_id)
                payload = build_production_semantics_payload(context, unit_id=unit_id)

                def validate(value: Any, *, ctx=copy.deepcopy(context)):
                    if not isinstance(value, dict):
                        return value, [_unit_shape_error("production_semantics", "object", value)], 0
                    normalized, changes = canonicalize_production_semantics(value, ctx)
                    errors = validate_production_semantics_output(normalized, ctx)
                    if not errors and normalized.get("renderability_status") == "needs_adaptation":
                        errors.append({
                            "type": "production_semantics_requires_adaptation",
                            "shot_id": normalized.get("shot_id"),
                            "renderability_issues": copy.deepcopy(normalized.get("renderability_issues") or []),
                            "detail": (
                                "Resolve the stated renderability issues now using only allowed no_story_change "
                                "production_choices, then return renderability_status=renderable. If that is impossible "
                                "without changing story facts, return blocked instead of needs_adaptation."
                            ),
                        })
                    return normalized, errors, changes

                result = self._execute_unit(
                    run,
                    unit_id=unit_id,
                    stage="production_semantics",
                    model_stage="production_semantics_shot",
                    payload=payload,
                    prompt=system_prompt("production_semantics_shot"),
                    extract=lambda x: x,
                    validate=validate,
                    soft_error_types=PRODUCTION_SEMANTICS_SOFT_ERROR_TYPES,
                    enforce_model_envelope=True,
                )
                outputs.append(result)
        return {"shots": outputs}

    def _enforce_production_semantics_readiness(
        self, run: dict[str, Any], production_semantics: dict[str, Any]
    ) -> None:
        # `blocked` is a legitimate semantic terminal state, not a request to blindly
        # regenerate the same Unit. needs_adaptation should already have been repaired
        # inside the Unit; if it survives, that is a contract failure.
        blocked: list[dict[str, Any]] = []
        unresolved: list[dict[str, Any]] = []
        for shot in production_semantics.get("shots", []) or []:
            if not isinstance(shot, dict):
                continue
            status = str(shot.get("renderability_status") or "")
            if status == "renderable":
                continue
            item = {
                "shot_id": shot.get("shot_id"),
                "renderability_status": status or "missing",
                "renderability_issues": copy.deepcopy(shot.get("renderability_issues") or []),
            }
            if status == "blocked":
                item.update({
                    "type": "production_semantics_blocked",
                    "detail": "This Shot cannot be made renderable without changing frozen story facts; human/source intervention is required.",
                })
                blocked.append(item)
            else:
                item.update({
                    "type": "production_semantics_not_renderable",
                    "detail": "Production Semantics must resolve to renderable or explicit blocked before Director.",
                })
                unresolved.append(item)

        if blocked:
            self._pause_deterministic_failure(
                run,
                unit_id="production_semantics:gate",
                stage="production_semantics",
                message=f"Production Semantics explicitly blocked {len(blocked)} shot(s); Director was not executed.",
                failure_kind="production_semantics_blocked_needs_human",
                errors=blocked,
                retryable=False,
                retry_mode=RETRY_MODE_INSPECT_RUNTIME,
            )
        self._enforce_stage_gate(
            run,
            stage="production_semantics",
            unit_id="production_semantics:gate",
            errors=unresolved,
            validation_key="production_semantics",
            failure_kind="production_semantics_readiness_gate",
            message=(
                f"Production Semantics readiness gate blocked {len(unresolved)} unresolved shot(s); "
                "Director was not executed."
            ),
            source_unit_ids=[
                f"production_semantics:{item.get('shot_id')}"
                for item in unresolved if item.get("shot_id")
            ],
        )

    def _run_director_units(
        self,
        run: dict[str, Any],
        story: dict[str, Any],
        script: dict[str, Any],
        board: dict[str, Any],
        scene_plan: dict[str, Any],
        production_semantics: dict[str, Any],
    ) -> dict[str, Any]:
        out = copy.deepcopy(board)
        builder = ContextBuilder(story_bible=story, script=script, storyboard_base=board)
        plan_by_scene = {
            str(scene.get("scene_id")): scene
            for scene in scene_plan.get("scenes", []) or []
            if isinstance(scene, dict) and scene.get("scene_id")
        }
        semantics_by_shot = {
            str(item.get("shot_id")): item
            for item in (production_semantics.get("shots", []) or [])
            if isinstance(item, dict) and item.get("shot_id")
        }
        prerequisite_errors: list[dict[str, Any]] = []
        for scene in out.get("scenes", []) or []:
            scene_id = str(scene.get("scene_id") or "")
            if scene_id not in plan_by_scene:
                prerequisite_errors.append({
                    "type": "director_missing_scene_plan_context", "scene_id": scene_id,
                    "detail": "Director requires Scene Plan context metadata for every Storyboard Scene.",
                })
            for shot in scene.get("shots", []) or []:
                shot_id = str(shot.get("shot_id") or "")
                if shot_id not in semantics_by_shot:
                    prerequisite_errors.append({
                        "type": "director_missing_production_semantics", "scene_id": scene_id, "shot_id": shot_id,
                        "detail": "Director requires validated Production Semantics for every Storyboard Shot.",
                    })
        director_prerequisite_sources: list[str] = []
        for error in prerequisite_errors:
            if error.get("type") == "director_missing_scene_plan_context":
                director_prerequisite_sources.append("scene_plan")
            elif error.get("shot_id"):
                director_prerequisite_sources.append(f"production_semantics:{error.get('shot_id')}")
        self._enforce_stage_gate(
            run, stage="director", unit_id="director:preflight", errors=prerequisite_errors,
            validation_key="director_prerequisites", failure_kind="director_prerequisite_gate",
            message=f"Director prerequisite gate failed: {prerequisite_errors}",
            source_unit_ids=_ordered_unique(director_prerequisite_sources),
        )
        context_states = ContextStateCursor()
        previous_state_out = empty_state()
        recent_shot_designs: list[dict[str, Any]] = []
        shot_index = 0
        effect_artifact = {"shots": {}, "scenes": {}}
        run.setdefault("artifacts", {})["director_context_effect_audit"] = effect_artifact
        for scene in out.get("scenes", []) or []:
            scene_design_history: list[dict[str, Any]] = []
            scene_effect_audits: list[dict[str, Any]] = []
            scene_id = str(scene.get("scene_id") or "")
            plan_scene = plan_by_scene.get(scene_id)
            if not isinstance(plan_scene, dict):
                self._pause_deterministic_failure(
                    run, unit_id=f"director:context:{scene_id or 'unknown'}", stage="director",
                    message=f"missing Scene Plan context metadata for {scene_id}",
                    failure_kind="director_context_schedule_failure",
                    errors=[{"type": "director_missing_scene_plan_context", "scene_id": scene_id}],
                    retryable=True, retry_mode=RETRY_MODE_REGENERATE_SOURCES, source_unit_ids=["scene_plan"],
                )

            scene_semantics = [
                copy.deepcopy(semantics_by_shot.get(str(shot.get("shot_id") or "")) or {})
                for shot in scene.get("shots", []) or []
                if isinstance(shot, dict) and str(shot.get("shot_id") or "") in semantics_by_shot
            ]
            scene_context_input = builder.director_scene_context(
                scene_id, scene_plan=plan_scene, production_semantics=scene_semantics
            )
            scene_context_unit_id = f"director_scene:{scene_id}"
            scene_context_payload = build_director_scene_context_payload(
                scene_context_input, unit_id=scene_context_unit_id
            )

            def validate_scene_context(value: Any, *, ctx=copy.deepcopy(scene_context_input)):
                if not isinstance(value, dict):
                    return value, [_unit_shape_error("scene_director_context", "object", value)], 0
                normalized, changes = canonicalize_director_scene_context(value, ctx)
                errors = validate_director_scene_context(normalized, ctx)
                return normalized, errors, changes

            scene_director_context, scene_context_status = self._execute_optional_model_unit(
                run, unit_id=scene_context_unit_id, stage="director",
                contract_version=DIRECTOR_SCENE_CONTRACT, model_stage="director_scene_context",
                payload=scene_context_payload, prompt=system_prompt("director_scene_context"),
                validate=validate_scene_context, enforce_model_envelope=True,
            )
            run.setdefault("artifacts", {}).setdefault("director_scene_contexts", {})[scene_id] = {
                "scene_context_status": scene_context_status,
                "scene_director_context": copy.deepcopy(scene_director_context),
            }
            self._save(run)

            context_ref = str(scene.get("context_ref") or "")
            transition = str(plan_scene.get("context_transition") or "")
            resume_context_ref = str(plan_scene.get("resume_context_ref") or "")
            try:
                previous_state_out = context_states.begin_scene(plan_scene, previous_state_out)
            except Exception as exc:
                self._pause_deterministic_failure(
                    run, unit_id=f"director:context:{scene_id or 'unknown'}", stage="director",
                    message=f"context state scheduling failed at {scene_id}: {exc}",
                    failure_kind="director_context_schedule_failure",
                    errors=[{"type": "director_context_schedule_failure", "scene_id": scene_id, "detail": str(exc)}],
                    retryable=True, retry_mode=RETRY_MODE_REGENERATE_SOURCES, source_unit_ids=["scene_plan"],
                )

            scene_meta = {"scene_id": scene_id, "context_ref": context_ref, "location_ref": scene.get("location_ref")}
            for shot in scene.get("shots", []) or []:
                shot_index += 1
                unit_id = f"director:{shot.get('shot_id')}"
                state_in = copy.deepcopy(previous_state_out)
                shot_id = str(shot.get("shot_id") or "")
                semantics = semantics_by_shot.get(shot_id)
                if not isinstance(semantics, dict):
                    self._pause_deterministic_failure(
                        run, unit_id=f"director:context:{shot_id or 'unknown'}", stage="director",
                        message=f"missing Production Semantics for {shot_id}",
                        failure_kind="director_prerequisite_failure",
                        errors=[{"type": "director_missing_production_semantics", "shot_id": shot_id}],
                        retryable=True, retry_mode=RETRY_MODE_REGENERATE_SOURCES,
                        source_unit_ids=[f"production_semantics:{shot_id}"],
                    )
                context = builder.director_context(shot_id, previous_state_out=state_in, production_semantics=semantics)
                program_owned = context.setdefault("program_owned", {})
                program_owned["recent_shot_designs"] = copy.deepcopy(recent_shot_designs[-2:])
                def _counts(field: str) -> dict[str, int]:
                    counts: dict[str, int] = {}
                    for item in scene_design_history:
                        value = item.get(field)
                        if field == "framing_type":
                            value = ((item.get("execution_framing") or {}).get("framing_type") if isinstance(item.get("execution_framing"), dict) else None)
                        key = str(value or "")
                        if key:
                            counts[key] = counts.get(key, 0) + 1
                    return counts
                scene_distribution_so_far = {
                    "prior_shot_count": len(scene_design_history),
                    "shot_size_counts": _counts("shot_size"),
                    "camera_counts": _counts("camera"),
                    "movement_counts": _counts("movement"),
                    "framing_counts": _counts("framing_type"),
                    "purpose_counts": _counts("shot_purpose"),
                    "scene_position_counts": _counts("scene_position"),
                }
                # v17 compatibility input retained; v18 exposes explicit names as
                # separate program-owned context rather than silently repurposing it.
                program_owned["scene_design_summary"] = copy.deepcopy(scene_distribution_so_far)
                program_owned["scene_director_context"] = copy.deepcopy(scene_director_context)
                program_owned["scene_context_status"] = scene_context_status
                context_available = scene_context_status in {"available", "repaired"}
                derived_scene_position = (
                    _scene_position_for_shot(scene_director_context, shot_id)
                    if context_available and isinstance(scene_director_context, dict) else ""
                )
                program_owned["scene_position"] = derived_scene_position or None
                program_owned["scene_position_source"] = "scene_context" if derived_scene_position else "legacy_model"
                program_owned["reaction_opportunity"] = bool(
                    context_available
                    and isinstance(scene_director_context, dict)
                    and _scene_reaction_opportunity(scene_director_context, shot_id)
                )
                program_owned["scene_camera_baseline"] = copy.deepcopy(
                    scene_director_context.get("camera_strategy") or {}
                ) if context_available and isinstance(scene_director_context, dict) else {}
                program_owned["previous_shot_design"] = copy.deepcopy(scene_design_history[-1] if scene_design_history else {})

                next_shot_purpose: dict[str, Any] | None = None
                current_shots = scene.get("shots", []) or []
                try:
                    current_position_index = next(
                        i for i, candidate_shot in enumerate(current_shots)
                        if isinstance(candidate_shot, dict) and str(candidate_shot.get("shot_id") or "") == shot_id
                    )
                except StopIteration:
                    current_position_index = -1
                if context_available and current_position_index >= 0 and current_position_index + 1 < len(current_shots):
                    next_shot = current_shots[current_position_index + 1]
                    next_shot_id = str(next_shot.get("shot_id") or "") if isinstance(next_shot, dict) else ""
                    next_position = _scene_position_for_shot(scene_director_context, next_shot_id)
                    if next_position:
                        next_shot_purpose = {"scene_position": next_position}
                program_owned["next_shot_purpose"] = next_shot_purpose
                program_owned["scene_distribution_so_far"] = copy.deepcopy(scene_distribution_so_far)
                program_owned["narrative_context_transition"] = {
                    "context_ref": context_ref,
                    "context_transition": transition,
                    "resume_context_ref": resume_context_ref,
                }
                payload = build_director_shot_payload(context, unit_id=unit_id, is_first_global_shot=(shot_index == 1))

                def validate(value: Any, *, base_shot=copy.deepcopy(shot), sm=copy.deepcopy(scene_meta), first=(shot_index == 1)):
                    if not isinstance(value, dict):
                        return value, [_unit_shape_error("director", "object", value)], 0
                    value = copy.deepcopy(value)
                    normalized, errors, changes = _director_shot_errors(
                        story, script, sm, base_shot, value, context, is_first=first
                    )
                    return normalized if normalized is not None else value, errors, changes

                director = self._execute_unit(
                    run, unit_id=unit_id, stage="director", model_stage="director_shot", payload=payload, prompt=system_prompt("director_shot"),
                    extract=lambda x: x,
                    validate=validate,
                    soft_error_types=DIRECTOR_SOFT_ERROR_TYPES,
                    enforce_model_envelope=True,
                )
                shot["director"] = director
                effect = build_shot_context_effect_audit(shot, director, program_owned)
                scene_effect_audits.append(copy.deepcopy(effect))
                effect_artifact["shots"][shot_id] = copy.deepcopy(effect)
                effect_artifact["scenes"][scene_id] = aggregate_scene_context_effect(
                    scene_id,
                    scene_context_status,
                    scene_effect_audits,
                    phase_count=(
                        len(scene_director_context.get("emotional_arc") or [])
                        if isinstance(scene_director_context, dict) and scene_context_status in {"available", "repaired"}
                        else 0
                    ),
                )
                exact_state_in = resolve_state_in(previous_state_out, director["continuity_scope"])
                self._set_unit(
                    run,
                    unit_id,
                    state_in=copy.deepcopy(exact_state_in),
                    context_ref=context_ref,
                    context_transition=transition,
                    resume_context_ref=resume_context_ref,
                )
                previous_state_out = copy.deepcopy(director["state_out"])
                effective_design = director.get("execution_shot_design") if isinstance(director.get("execution_shot_design"), dict) else {}
                design_record = {
                    "shot_id": shot_id,
                    "scene_id": scene_id,
                    "shot_size": effective_design.get("shot_size") or shot.get("shot_size"),
                    "camera": effective_design.get("camera") or shot.get("camera"),
                    "movement": effective_design.get("movement") or shot.get("movement"),
                    "shot_purpose": director.get("shot_purpose") or "continuity",
                    "scene_position": director.get("scene_position") or "setup",
                    "execution_framing": copy.deepcopy(director.get("execution_framing") or {}),
                    "visual_target": copy.deepcopy(director.get("visual_target") or {}),
                }
                recent_shot_designs.append(copy.deepcopy(design_record))
                scene_design_history.append(copy.deepcopy(design_record))
                context_states.finish_shot(previous_state_out)
                run["artifacts"]["storyboard_partial"] = copy.deepcopy(out)
                self._save(run)
        return out

    def _run_state_shotspec_stage(self, run: dict[str, Any], storyboard: dict[str, Any], scene_plan: dict[str, Any]) -> list[dict[str, Any]]:
        unit_id = "state_shotspec"
        payload = build_state_shotspec_payload(storyboard, scene_plan)
        contract_id = f"{self.CONTRACTS['state_shotspec']}|deterministic.v1"
        reusable = self.checkpoints.get_reusable(
            run["run_id"], unit_id, payload, contract_id=contract_id
        )
        if reusable is not None:
            self._set_unit(
                run, unit_id, stage="state_shotspec", status="completed",
                input_hash=reusable["input_hash"], contract_id=contract_id, attempts=reusable.get("attempts", []),
                repair_count=0, normalization_count=0, reused=True, error=None,
                failure_kind=None, retryable=None,
            )
            self._save(run)
            return copy.deepcopy(reusable.get("output") or [])

        ih = unit_input_hash(payload)
        self._set_unit(
            run, unit_id, stage="state_shotspec", status="running", input_hash=ih, contract_id=contract_id,
            attempts=[], repair_count=0, normalization_count=0, reused=False, error=None,
            failure_kind=None, retryable=None, started_at=_now(), finished_at=None,
        )
        run["current_unit"] = unit_id
        run["current_stage"] = "state_shotspec"
        self._save(run)
        specs, errors = build_state_shot_specs(storyboard, scene_plan=scene_plan)
        if errors:
            run.setdefault("validations", {})["state_shotspec"] = {
                "passed": False, "errors": copy.deepcopy(errors)
            }
            msg = f"state/ShotSpec validation failed: {errors}"
            self._pause_deterministic_failure(
                run, unit_id=unit_id, stage="state_shotspec", message=msg,
                failure_kind="state_shotspec_validation", errors=errors,
                retryable=False, retry_mode=RETRY_MODE_INSPECT_RUNTIME,
            )
        unit = self._set_unit(
            run, unit_id, status="completed", finished_at=_now(),
            attempts=[{"attempt": 1, "status": "passed", "errors": []}],
            failure_kind=None, retryable=None,
        )
        self.checkpoints.save(
            run["run_id"], unit_id, {**copy.deepcopy(unit), "contract_id": contract_id, "output": copy.deepcopy(specs)}
        )
        self._save(run)
        return specs

    def _remap_storyboard_quality_warnings(self, run: dict[str, Any], board: dict[str, Any]) -> None:
        by_scene = {str(scene.get("scene_id")): scene for scene in board.get("scenes", []) or []}
        for warning in run.get("quality_warnings", []) or []:
            if warning.get("stage") != "storyboard":
                continue
            unit_id = str(warning.get("unit_id") or "")
            scene_id = unit_id.split(":", 1)[1] if unit_id.startswith("storyboard:") and ":" in unit_id else ""
            index = warning.get("shot_index")
            scene = by_scene.get(scene_id) or {}
            shots = scene.get("shots", []) or []
            if isinstance(index, int) and 0 <= index < len(shots):
                warning["shot_id"] = shots[index].get("shot_id")
                warning["scene_id"] = scene_id

    def _apply_storyboard_quality_warnings(self, run: dict[str, Any], artifacts: dict[str, Any]) -> None:
        warning_map = {
            "storyboard_non_atomic_time_window": (
                "W010_NON_ATOMIC_TIME_WINDOW",
                "单镜时间跨度风险",
                "基础分镜仍包含长叙事时间或多个时间阶段；已继续编译，但该镜需要人工复核或重新生成基础分镜。",
            ),
            "storyboard_non_visual_description": (
                "W011_NON_VISUAL_DESCRIPTION",
                "镜头描述可视化风险",
                "基础分镜仍包含不可直接视觉化的叙事/心理/作者评论/纯声音信息；已继续编译，但该镜需要人工复核或重新生成基础分镜。",
            ),
        }
        compiled = artifacts.get("compiled_project") or {}
        if str(compiled.get("compiler_version") or "") != "consumption_v1":
            return
        prompts = {str(item.get("shot_id")): item for item in compiled.get("shot_prompts", []) or []}
        project_warnings = compiled.setdefault("warnings", [])
        added = 0
        for source in run.get("quality_warnings", []) or []:
            mapped = warning_map.get(str(source.get("type") or ""))
            shot_id = str(source.get("shot_id") or "")
            target = prompts.get(shot_id)
            if not mapped or not target:
                continue
            code, label, fallback = mapped
            item = {
                "code": code,
                "label": label,
                "detail": str(source.get("detail") or fallback),
                "source_layer": "Storyboard Base",
                "source_ref": f"shots[{shot_id}]",
                "suggested_fix": "回到基础分镜重新生成或人工复核该镜；不要在消费编译层改写剧情事实。",
            }
            if not any(w.get("code") == code for w in target.get("warnings", []) or []):
                target.setdefault("warnings", []).append(copy.deepcopy(item))
                project_warnings.append(dict(copy.deepcopy(item), target_type="shot", target_id=shot_id, shot_id=shot_id))
                added += 1
            if target.get("compile_status") == "ok":
                target["compile_status"] = "warning"
        if added:
            if compiled.get("compile_status") == "ok":
                compiled["compile_status"] = "warning"
            evaluation = artifacts.get("consumption_evaluation") or {}
            evaluation["compile_status"] = compiled.get("compile_status")
            evaluation["warnings"] = copy.deepcopy(project_warnings)

    def _compile(self, run: dict[str, Any], artifacts: dict[str, Any]) -> None:
        unit_id = "compile"
        self._set_unit(run, unit_id, stage="compile", status="running", started_at=_now(), repair_count=0, normalization_count=0, attempts=[], reused=False, error=None)
        self._save(run)
        try:
            if not all(key in artifacts for key in ("pvb", "psb", "style_guide")):
                self._materialize_asset_prompts(run, artifacts)

            asset_preflight_errors = validate_visible_character_asset_preflight(
                artifacts["story_bible"], artifacts["pvb"], artifacts["shot_specs"]
            )
            if asset_preflight_errors:
                source_units = _ordered_unique([
                    f"pvb:{ref}"
                    for item in asset_preflight_errors
                    for ref in (item.get("target_character_refs") or [])
                    if isinstance(ref, str) and ref
                ])
                self._pause_deterministic_failure(
                    run, unit_id=unit_id, stage="compile",
                    message=f"Compile asset preflight failed: {asset_preflight_errors}",
                    failure_kind="compile_asset_preflight_failure", errors=asset_preflight_errors,
                    retryable=bool(source_units),
                    retry_mode=RETRY_MODE_REGENERATE_SOURCES, source_unit_ids=source_units,
                )

            compiled_result, compile_errors = compile_and_evaluate(
                project_id=run["run_id"],
                story_bible=artifacts["story_bible"],
                script=artifacts["script"],
                storyboard=artifacts["storyboard"],
                shot_specs=artifacts["shot_specs"],
                pvb=artifacts["pvb"],
                psb=artifacts["psb"],
                style_guide=artifacts["style_guide"],
                scene_plan=artifacts.get("scene_plan"),
                production_semantics=artifacts.get("production_semantics"),
            )
            artifacts.update(compiled_result)
            self._apply_storyboard_quality_warnings(run, artifacts)
            run["validations"]["static_evaluation"] = artifacts["static_evaluation"]
            run["validations"]["consumption_evaluation"] = artifacts["consumption_evaluation"]
            run["validations"]["production_readiness"] = artifacts["production_readiness"]
            run["compiler_version"] = artifacts["compiled_project"].get("compiler_version")
            run["compile_status"] = artifacts["compiled_project"].get("compile_status")
            if compile_errors:
                shot_scene = {
                    str(shot.get("shot_id")): str(scene.get("scene_id"))
                    for scene in artifacts["storyboard"].get("scenes", []) or []
                    for shot in scene.get("shots", []) or []
                    if shot.get("shot_id") and scene.get("scene_id")
                }
                source_units: list[str] = []
                for item in compile_errors:
                    source_layer = str(item.get("source_layer") or "")
                    error_type = str(item.get("type") or "")
                    shot_id = str(item.get("shot_id") or item.get("target_id") or "")
                    target_id = str(item.get("target_id") or "")
                    target_character_refs = [
                        str(ref) for ref in (item.get("target_character_refs") or [])
                        if isinstance(ref, str) and ref
                    ]
                    if target_character_refs and (
                        error_type in {"E023_SHOT_NOT_SELF_CONTAINED", "pvb_visible_identity_anchor_missing"}
                        or "PVB" in source_layer
                        or "Asset Registry" in source_layer
                    ):
                        source_units.extend(f"pvb:{ref}" for ref in target_character_refs)
                    elif shot_id.startswith("SH"):
                        if "Storyboard" in source_layer or "ShotSpec" in source_layer:
                            scene_id = shot_scene.get(shot_id)
                            if scene_id:
                                source_units.append(f"storyboard:{scene_id}")
                        else:
                            source_units.append(f"director:{shot_id}")
                    elif target_id.startswith("char_"):
                        source_units.append(f"pvb:{target_id}")
                    elif target_id.startswith("scene_"):
                        source_units.append(f"psb:{target_id}")
                self._pause_deterministic_failure(
                    run, unit_id=unit_id, stage="compile",
                    message=f"Compile/static evaluation failed: {compile_errors}",
                    failure_kind="compile_static_evaluation_failure", errors=compile_errors,
                    retryable=bool(source_units),
                    retry_mode=RETRY_MODE_REGENERATE_SOURCES, source_unit_ids=source_units,
                )
            self._set_unit(run, unit_id, status="completed", finished_at=_now(), failure_kind=None, retryable=None, source_unit_ids=[])
        except RuntimePaused:
            raise
        except Exception as exc:
            errors = [{"type": "compile_runtime_failure", "detail": str(exc)}]
            self._pause_deterministic_failure(
                run, unit_id=unit_id, stage="compile", message=str(exc),
                failure_kind="compile_runtime_failure", errors=errors,
                retryable=False, retry_mode=RETRY_MODE_INSPECT_RUNTIME,
            )
        self._save(run)

    def _execute(self, run: dict[str, Any]) -> dict[str, Any]:
        previous_build = str(run.get("build_id") or "")
        build_changed = bool(previous_build and previous_build != self.BUILD_ID)
        if build_changed:
            self._event(run, "build_changed", status="running", message=f"{previous_build} -> {self.BUILD_ID}")
            # Repair hints embed validator-specific target metadata from the build that
            # produced the paused failure. Replaying them across a build boundary can
            # bypass newer precise repair contracts (for example must_change_any_of_paths).
            # Drop only stale repair hints; completed semantic checkpoints remain eligible
            # for normal input/contract reuse, so a resume still starts at the failed Unit.
            recovery = run.setdefault("recovery", {})
            stale_hints = recovery.get("source_repair_hints")
            if isinstance(stale_hints, dict) and stale_hints:
                stale_hints.clear()
                self._event(
                    run, "stale_repair_hints_cleared", status="running",
                    message="build changed; validator-specific repair hints will be rebuilt under the current runtime",
                )
        run["build_id"] = self.BUILD_ID
        run["contracts"] = copy.deepcopy(self.CONTRACTS)
        run["status"] = "running"
        run["error"] = None
        source_text = run["source_text"]
        a = run.setdefault("artifacts", {})
        try:
            a["story_bible"] = self._run_story_bible_stage(run, source_text)
            run["validations"]["story_bible"] = {"passed": True, "errors": []}

            a["scene_plan"] = self._run_scene_plan_stage(run, source_text, a["story_bible"])
            run["validations"]["scene_plan"] = {"passed": True, "errors": []}

            a["script"] = self._run_script_units(run, source_text, a["story_bible"], a["scene_plan"])
            run["validations"]["script"] = {"passed": True, "errors": []}

            canonical_storyboard_base = self._run_storyboard_units(run, source_text, a["story_bible"], a["scene_plan"], a["script"])
            a["storyboard_base"] = self._resolve_storyboard_redistribution_override(
                run, canonical_board=canonical_storyboard_base, script=a["script"]
            )
            storyboard_warnings = [copy.deepcopy(w) for w in (run.get("quality_warnings") or []) if w.get("stage") == "storyboard"]
            run["validations"]["storyboard_base"] = {"passed": True, "errors": [], "warnings": storyboard_warnings}

            # Production Closeout: resolve speech/narration timing while FrozenText
            # allocation is still Storyboard-owned. Compiler remains consumption-only.
            self._apply_preproduction_duration_authority(run, a)

            a["pvb_candidate"], a["psb_candidate"], a["style_guide_candidate"] = self._run_asset_units(run, source_text, a["story_bible"], a)
            run["validations"]["pvb_candidate"] = {"passed": True, "errors": []}
            run["validations"]["psb_candidate"] = {"passed": True, "errors": []}
            run["validations"]["style_guide_candidate"] = {"passed": True, "errors": []}
            # Freeze production-design candidates immediately. This is deterministic
            # and catches asset-lock violations before spending Production Semantics /
            # Director calls; it also keeps usable asset prompts when a later stage pauses.
            self._materialize_asset_prompts(run, a)

            a["production_semantics"] = self._run_production_semantics_units(
                run, a["story_bible"], a["script"], a["storyboard_base"]
            )
            self._enforce_production_semantics_readiness(run, a["production_semantics"])

            a["storyboard"] = self._run_director_units(
                run, a["story_bible"], a["script"], a["storyboard_base"], a["scene_plan"], a["production_semantics"]
            )
            director_validation = validate_storyboard_director_v1_3a(a["story_bible"], a["script"], a["storyboard"])
            director_errors = [copy.deepcopy(e) for e in _filter_runtime_director_core_errors(
                list(director_validation.get("errors") or []), a["script"], a["storyboard"]
            )]
            director_source_units = _ordered_unique([
                f"director:{e.get('shot_id')}" for e in director_errors if e.get("shot_id")
            ])
            if director_errors and not director_source_units:
                director_source_units = [
                    uid for uid, unit in run.get("units", {}).items()
                    if unit.get("stage") == "director" and uid.startswith("director:SH")
                ]
            self._enforce_stage_gate(
                run, stage="director", unit_id="director:gate", errors=director_errors, validation_key="director",
                failure_kind="director_assembly_gate",
                message=f"assembled director validation failed: {director_errors}",
                source_unit_ids=director_source_units,
            )

            a["shot_specs"] = self._run_state_shotspec_stage(run, a["storyboard"], a["scene_plan"])
            run["validations"]["state_shotspec"] = {"passed": True, "errors": []}
            self._apply_final_shotspec_duration_authority(run, a)

            self._compile(run, a)
            run["counts"] = {
                "characters": len(a["story_bible"].get("characters", []) or []),
                "physical_scenes": len(a["story_bible"].get("scenes", []) or []),
                "beats": sum(len(s.get("beat_list", []) or []) for s in a["scene_plan"].get("scenes", []) or []),
                "shots": len(a["shot_specs"]),
                "character_prompts": len(a["compiled_project"].get("character_prompts", []) or []),
                "scene_prompts": len(a["compiled_project"].get("scene_prompts", []) or []),
                "shot_prompts": len(a["compiled_project"].get("shot_prompts", []) or []),
            }
            run["status"] = "completed"
            run["current_stage"] = "completed"
            run["current_unit"] = None
            run["error"] = None
            redistribution = run.get("storyboard_redistribution")
            if (
                isinstance(redistribution, dict)
                and redistribution.get("status") in {"applied", "applied_downstream_paused"}
                and isinstance(a.get("storyboard_redistribution_override"), dict)
            ):
                self._finalize_storyboard_redistribution_after_downstream(run)
                residual = len((run.get("storyboard_redistribution") or {}).get("residual_overloaded_shot_ids") or [])
                self._event(
                    run, "storyboard_redistribution_completed",
                    stage="storyboard_redistribution", status="completed",
                    message=f"resumed downstream pipeline completed with redistribution override; residual overloaded shots: {residual}",
                )
            self._event(run, "run_completed", status="completed")
        except RuntimePaused:
            if run.get("status") != "paused":
                run["status"] = "paused"
        except Exception as exc:
            failed_at = _now()
            unit_id = run.get("current_unit")
            stage = run.get("current_stage")
            message = str(exc)
            run["status"] = "paused"
            run["error"] = {
                "unit_id": unit_id, "stage": stage, "message": message,
                "failure_kind": "runtime_unhandled_exception", "retryable": False,
                "retry_mode": RETRY_MODE_INSPECT_RUNTIME,
            }
            run.setdefault("failure_history", []).append({
                "unit_id": unit_id, "stage": stage, "message": message,
                "failure_kind": "runtime_unhandled_exception", "retryable": False,
                "retry_mode": RETRY_MODE_INSPECT_RUNTIME, "failed_at": failed_at,
            })
            self._event(
                run, "runtime_failed", unit_id=unit_id, stage=stage,
                status="failed", message=message,
            )
        self._save(run)
        return run

    def create(self, source_text: str, title: str | None = None) -> dict[str, Any]:
        source_text = (source_text or "").strip()
        if not source_text:
            raise ValueError("source_text is required")
        explicit_title = bool(isinstance(title, str) and title.strip())
        display_title = (title or "未命名小说").strip() or "未命名小说"
        source_index = build_source_index(
            source_text,
            project_title=display_title if explicit_title else None,
            title_is_explicit=explicit_title,
        )
        run = {
            "run_id": f"run_{uuid.uuid4().hex[:12]}",
            "runtime_version": self.VERSION,
            "framework_version": self.FRAMEWORK_VERSION,
            "build_id": self.BUILD_ID,
            "contracts": copy.deepcopy(self.CONTRACTS),
            "title": display_title,
            "title_is_explicit": explicit_title,
            "source_index": source_index,
            "status": "pending",
            "created_at": _now(), "updated_at": _now(),
            "current_stage": "starting", "current_unit": None,
            "source_text": source_text,
            "units": {}, "stages": [], "events": [], "validations": {}, "artifacts": {}, "counts": {},
            "recovery": {"total_repairs": 0, "repaired_units": []},
            "token_usage": {
                "requests": 0, "repair_requests": 0, "prompt_tokens": 0, "completion_tokens": 0,
                "total_tokens": 0, "input_chars": 0, "output_chars": 0, "by_stage": {},
            },
            "failure_history": [],
            "quality_warnings": [],
            "error": None,
        }
        self._event(run, "run_created", status="pending")
        self._save(run)
        return run

    def start(self, source_text: str, title: str | None = None) -> dict[str, Any]:
        run = self.create(source_text, title)
        return self._execute(run)

    def execute(self, run_id: str) -> dict[str, Any]:
        run = self.store.get(run_id)
        if run is None:
            raise KeyError(run_id)
        if run.get("status") == "completed":
            return run
        return self._execute(run)

    def resume(self, run_id: str) -> dict[str, Any]:
        run = self.store.get(run_id)
        if run is None:
            raise KeyError(run_id)
        error = run.get("error") or {}
        if str(error.get("stage") or "") == "storyboard_redistribution":
            return self.redistribute_overloaded_shots(run_id)
        if error.get("retry_mode") == RETRY_MODE_REGENERATE_SOURCES:
            source_unit_ids = _ordered_unique([
                str(x) for x in (error.get("source_unit_ids") or []) if str(x)
            ])
            for target_id in source_unit_ids:
                self._invalidate_from(run, target_id)
            if source_unit_ids:
                self._event(
                    run, "run_resume_sources_invalidated", unit_id=error.get("unit_id"),
                    stage=error.get("stage"), status="pending",
                    message=f"resume source units: {source_unit_ids}",
                )
                self._save(run)
        if run.get("status") == "completed":
            return run
        return self._execute(run)

    def retry_unit(self, run_id: str, unit_id: str) -> dict[str, Any]:
        run = self.store.get(run_id)
        if run is None:
            raise KeyError(run_id)
        unit = (run.get("units") or {}).get(unit_id) or {}
        if unit.get("stage") == "storyboard_redistribution":
            self._invalidate_from(run, unit_id)
            self._event(run, "unit_retry_requested", unit_id=unit_id, stage="storyboard_redistribution", status="pending")
            self._save(run)
            return self.redistribute_overloaded_shots(run_id)
        source_unit_ids = _ordered_unique([
            str(x) for x in (unit.get("source_unit_ids") or []) if str(x) and str(x) != unit_id
        ])
        retry_targets = source_unit_ids or [unit_id]
        for target_id in retry_targets:
            self._invalidate_from(run, target_id)
        self._event(
            run, "unit_retry_requested", unit_id=unit_id, stage=unit.get("stage"), status="pending",
            message=(f"retry source units: {retry_targets}" if source_unit_ids else None),
        )
        self._save(run)
        return self._execute(run)

    def _invalidate_from(self, run: dict[str, Any], unit_id: str) -> None:
        """Invalidate only the requested semantic unit.

        Downstream checkpoints are not eagerly deleted. Their input hashes include
        authoritative upstream outputs, so changed inputs naturally invalidate only
        the units that actually depend on the changed result. This is the Runtime 2.0
        rule: never regenerate validated work when its input hash is unchanged.
        """
        units = run.get("units", {})
        target = units.get(unit_id, {})
        stage = target.get("stage") or unit_id.split(":", 1)[0]
        self.checkpoints.delete(run["run_id"], unit_id)
        units.pop(unit_id, None)

        # Deterministic stage gates and validation summaries are materialized views.
        # A retry invalidates only gates at or downstream of the changed semantic
        # layer; unaffected upstream Units remain eligible for hash/contract reuse.
        gate_order = ["script", "storyboard", "production_semantics", "director"]
        if stage in {"story_bible", "scene_plan"}:
            first_gate = 0
        elif stage in gate_order:
            first_gate = gate_order.index(stage)
        else:
            first_gate = len(gate_order)
        for gate_stage in gate_order[first_gate:]:
            gate_id = f"{gate_stage}:gate"
            units.pop(gate_id, None)
            self.checkpoints.delete(run["run_id"], gate_id)
        if first_gate <= gate_order.index("director"):
            units.pop("director:preflight", None)
            self.checkpoints.delete(run["run_id"], "director:preflight")

        validation_order = [
            "story_bible", "scene_plan", "script", "storyboard_base",
            "production_semantics", "director", "state_shotspec", "duration_authority",
            "static_evaluation", "consumption_evaluation", "production_readiness",
        ]
        stage_validation_key = {
            "story_bible": "story_bible",
            "scene_plan": "scene_plan",
            "script": "script",
            "storyboard": "storyboard_base",
            "production_semantics": "production_semantics",
            "director": "director",
            "state_shotspec": "state_shotspec",
        }.get(stage)
        validations = run.setdefault("validations", {})
        if stage in {"story_bible", "scene_plan", "script", "storyboard", "production_semantics", "director"}:
            validations.pop("director_prerequisites", None)
        if stage_validation_key in validation_order:
            start = validation_order.index(stage_validation_key)
            for key in validation_order[start:]:
                validations.pop(key, None)
        elif stage == "pvb":
            for key in ("pvb_candidate", "production_lock", "static_evaluation", "consumption_evaluation", "production_readiness"):
                validations.pop(key, None)
        elif stage == "psb":
            for key in ("psb_candidate", "production_lock", "static_evaluation", "consumption_evaluation", "production_readiness"):
                validations.pop(key, None)
        elif stage == "style_guide":
            for key in ("style_guide_candidate", "production_lock", "static_evaluation", "consumption_evaluation", "production_readiness"):
                validations.pop(key, None)

        # Aggregated artifacts are rebuilt from unit checkpoints on the next execute.
        # Remove only materialized views at/after the retried semantic layer; the
        # completed unit checkpoints remain available for hash-based reuse.
        artifacts = run.get("artifacts", {})
        if stage == "story_bible":
            run.pop("storyboard_redistribution", None)
            artifacts.clear()
        elif stage == "scene_plan":
            artifacts.pop("storyboard_redistribution_override", None)
            run.pop("storyboard_redistribution", None)
            for key in ["scene_plan", "script", "storyboard_base", "production_semantics", "director_scene_contexts", "storyboard_partial", "storyboard", "pvb_candidate", "psb_candidate", "style_guide_candidate", "pvb", "psb", "style_guide", "shot_specs", "compiled_project", "static_evaluation"]:
                artifacts.pop(key, None)
        elif stage == "script":
            artifacts.pop("storyboard_redistribution_override", None)
            run.pop("storyboard_redistribution", None)
            for key in ["script", "storyboard_base", "production_semantics", "director_scene_contexts", "storyboard_partial", "storyboard", "shot_specs", "compiled_project", "static_evaluation"]:
                artifacts.pop(key, None)
        elif stage == "storyboard":
            artifacts.pop("storyboard_redistribution_override", None)
            run.pop("storyboard_redistribution", None)
            for key in ["storyboard_base", "production_semantics", "director_scene_contexts", "storyboard_partial", "storyboard", "shot_specs", "compiled_project", "static_evaluation"]:
                artifacts.pop(key, None)
        elif stage == "production_semantics":
            for key in ["production_semantics", "director_scene_contexts", "storyboard_partial", "storyboard", "shot_specs", "compiled_project", "static_evaluation"]:
                artifacts.pop(key, None)
        elif stage == "director":
            for key in ["director_scene_contexts", "storyboard_partial", "storyboard", "shot_specs", "compiled_project", "static_evaluation"]:
                artifacts.pop(key, None)
        elif stage == "pvb":
            for key in ["pvb_candidate", "pvb", "asset_prompts", "compiled_project", "static_evaluation"]:
                artifacts.pop(key, None)
        elif stage == "psb":
            for key in ["psb_candidate", "psb", "asset_prompts", "compiled_project", "static_evaluation"]:
                artifacts.pop(key, None)
        elif stage == "style_guide":
            for key in ["style_guide_candidate", "style_guide", "asset_prompts", "compiled_project", "static_evaluation"]:
                artifacts.pop(key, None)
        elif stage == "storyboard_redistribution":
            # Fragment retries occur before commit. Preserve the last completed production
            # artifacts and rebuild the redistribution plan/fragments through the dedicated
            # operation instead of silently dropping the user's current result.
            run.pop("storyboard_redistribution", None)
        else:
            for key in ["compiled_project", "static_evaluation"]:
                artifacts.pop(key, None)

        if stage in {"story_bible", "scene_plan", "script", "storyboard"}:
            # Storyboard quality warnings describe a specific upstream rendering. Any
            # retry at or before Storyboard invalidates them; reused Storyboard units
            # will repopulate their own warnings through _sync_unit_quality_warnings.
            run["quality_warnings"] = [
                w for w in (run.get("quality_warnings") or []) if w.get("stage") != "storyboard"
            ]

        # Runtime consumption compilation added extra materialized views. Any upstream
        # retry invalidates all compile-layer views together so the Web UI cannot show
        # stale block/warning results while the retried unit is rebuilding.
        for key in ["compiled_project", "consumption_v1_compiled_project", "legacy_compiled_project", "static_evaluation", "consumption_evaluation", "production_readiness"]:
            artifacts.pop(key, None)
        validations.pop("static_evaluation", None)
        validations.pop("consumption_evaluation", None)
        validations.pop("production_readiness", None)
        if stage in {"story_bible", "scene_plan", "script", "storyboard", "production_semantics", "director", "state_shotspec"}:
            artifacts.pop("duration_authority_report", None)
            validations.pop("duration_authority", None)
        run.pop("compiler_version", None)
        run.pop("compile_status", None)

        # Compile is deterministic and always rematerialized; stale status must not
        # appear as completed while a semantic unit is being retried.
        if stage in {"story_bible", "scene_plan", "script", "storyboard", "production_semantics", "director", "state_shotspec"}:
            units.pop("state_shotspec", None)
            self.checkpoints.delete(run["run_id"], "state_shotspec")
        units.pop("compile", None)
        if stage in {"story_bible", "scene_plan", "pvb", "psb", "style_guide"}:
            units.pop("compile:assets", None)
        run["status"] = "pending"
        run["current_unit"] = None
        run["current_stage"] = "pending"
        run["error"] = None

