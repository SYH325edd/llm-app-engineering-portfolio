from __future__ import annotations

import copy
from typing import Any

CONTRACT_VERSION = "director_scene_context.v1_1"

SCENE_PHASES = {"setup", "reveal", "reaction", "escalation", "confirmation", "transition", "release"}
INTENSITIES = {"low", "medium", "high"}
RELATION_MODES = {"speaker_listener", "confrontation", "observation", "concealment", "support", "distance"}
POWER_BALANCES = {"balanced", "first_dominant", "second_dominant"}
REACTION_PRIORITIES = {"low", "medium", "high"}
CAMERA_STABILITIES = {"stable", "mixed", "unstable"}
FRAMING_TENDENCIES = {"close_dominant", "medium_dominant", "wide_dominant", "mixed"}
MOVEMENT_POLICIES = {"mostly_static", "selective_motion", "dynamic"}
BASELINE_ENERGIES = {"restrained", "neutral", "active"}
BASELINE_CONTROLS = {"controlled", "mixed", "unstable"}
SOCIAL_POSTURES = {"dominant", "equal", "submissive", "guarded"}
EVIDENCE_TYPES = {
    "scene_plan_beat", "script_beat", "story_character", "story_context",
    "storyboard_shot", "production_semantics_shot",
}

SYSTEM_PROMPT = """你是 Prompt Foundry Director v18.0_1 的 Scene Director Context 层。你每次只处理一个已经冻结事实的 Scene。
只输出 JSON：{"scene_director_context": {...}}。

你的职责是识别整场戏中连续发生的 Dramatic Turns，并给 Shot Director 提供场景级创意上下文；不是重写剧情，也不是逐镜规定摄影答案。Fact Spine 已冻结，任何新增人物、对白、事件、关系、历史、道具或剧情结果都属于越权。

你可以：
- 识别场景戏剧功能 dramatic_function；
- 读取现有 Beat + Shot sequence，将 Scene 划分为连续 dramatic phases；
- 同一个 Beat 内如果现有 Shot 的叙事功能发生变化，可以划分多个连续 Phase；
- 分析当前已存在人物之间的 relationship_dynamics；
- 标记 reaction_strategy；
- 定义场景级 camera_strategy baseline；
- 定义 character_performance_baselines。

Dramatic Phase 的硬边界：
- 一个 Beat 不等于一个 Dramatic Phase；
- 只能重新对现有 Shot 分组，不得新增、删除、拆分、合并或重排 Shot；
- 不得改变任何 Shot 的 Beat ownership；
- emotional_arc 必须完整覆盖当前 Scene 全部 Shot，每个 Shot 恰好出现一次；
- 每个 Phase 必须对应连续 Shot 区间，Phase 顺序必须和 Storyboard Shot 顺序一致，不得交叉、重复或留洞；
- phase.beat_refs 必须严格对应该 Phase 中 Shot 原本所属 Beat。

Camera Strategy 只是 Scene Baseline，不是逐 Shot 指令：
- stability 表示整场稳定性倾向，不代表所有 Shot 必须相同机位；
- framing_tendency 表示主要视觉尺度倾向，不代表所有 Shot 必须相同景别；
- movement_policy 表示整场运动阈值/节奏倾向，不代表所有 Shot 都 static 或都运动。
不得在 Scene Context 中规定具体 shot size、具体 camera angle、具体 movement、具体 composition、具体 blocking 或具体 performance action。

你不得：
- 生成具体人物动作，例如“某人扶墙、吸烟、递文件”；
- 生成具体机位角度、摄影机距离或具体运镜轨迹；
- 新增/删除/重排 Storyboard Shot；
- 新增或改写对白、人物关系、历史、事件或道具事实；
- 输出当前 Schema 以外字段。

所有 character_ref / beat_ref / shot_ref / evidence ref 必须来自 program_owned.allowed_*。
evidence_sources 只能选择 program_owned.allowed_evidence_refs 中已有 source_type/source_ref，不得自由造 ref。
character_performance_baselines 只表达 energy / control / social posture 基线，不写具体动作。

若 user payload 含 repair_instruction：以 invalid_output 为基础，只修 validation_errors 指向的 Phase membership / function / ordering 或其他非法字段；不得借 Repair 改剧情事实。
"""

_TOP_FIELDS = {
    "scene_id", "contract_version", "dramatic_function", "emotional_arc",
    "relationship_dynamics", "reaction_strategy", "camera_strategy",
    "character_performance_baselines", "evidence_sources",
}
_EVIDENCE_FIELDS = {"source_type", "source_ref"}
_PHASE_FIELDS = {"phase_id", "beat_refs", "shot_refs", "function", "intensity", "evidence_sources"}
_REL_FIELDS = {"character_refs", "relation_mode", "power_balance", "evidence_sources"}
_BASELINE_FIELDS = {"character_ref", "baseline_energy", "baseline_control", "baseline_social_posture"}

def _error(error_type: str, detail: str, *, path: str = "") -> dict[str, Any]:
    out: dict[str, Any] = {"type": error_type, "detail": detail}
    if path:
        out["path"] = path
    return out


def _allowed_evidence(context: dict[str, Any]) -> set[tuple[str, str]]:
    program = context.get("program_owned") if isinstance(context.get("program_owned"), dict) else {}
    out: set[tuple[str, str]] = set()
    for item in program.get("allowed_evidence_refs") or []:
        if isinstance(item, dict):
            source_type = str(item.get("source_type") or "")
            source_ref = str(item.get("source_ref") or "")
            if source_type and source_ref:
                out.add((source_type, source_ref))
    return out


def _canonical_evidence(items: Any, allowed: set[tuple[str, str]]) -> tuple[list[dict[str, str]], int]:
    if not isinstance(items, list):
        return items, 0  # validation owns the type error
    out: list[dict[str, str]] = []
    changes = 0
    seen: set[tuple[str, str]] = set()
    for item in items:
        if not isinstance(item, dict):
            out.append(item)
            continue
        source_type = str(item.get("source_type") or "")
        source_ref = str(item.get("source_ref") or "")
        key = (source_type, source_ref)
        if set(item) - _EVIDENCE_FIELDS:
            changes += 1
        if key not in allowed:
            changes += 1
            continue
        if key in seen:
            changes += 1
            continue
        seen.add(key)
        out.append({"source_type": source_type, "source_ref": source_ref})
    return out, changes


def canonicalize_director_scene_context(raw: Any, context: dict[str, Any]) -> tuple[Any, int]:
    """Deterministic cleanup only. Invalid enums/text remain validator errors."""
    if not isinstance(raw, dict):
        return raw, 0
    allowed_chars = set((context.get("program_owned") or {}).get("allowed_character_refs") or [])
    allowed_beats = set((context.get("program_owned") or {}).get("allowed_beat_refs") or [])
    allowed_shots = set((context.get("program_owned") or {}).get("allowed_shot_refs") or [])
    allowed_evidence = _allowed_evidence(context)
    out = {key: copy.deepcopy(value) for key, value in raw.items() if key in _TOP_FIELDS}
    changes = len(set(raw) - _TOP_FIELDS)

    dramatic = out.get("dramatic_function")
    if isinstance(dramatic, dict):
        cleaned = {key: copy.deepcopy(value) for key, value in dramatic.items() if key in {"summary", "evidence_sources"}}
        changes += len(set(dramatic) - {"summary", "evidence_sources"})
        ev, c = _canonical_evidence(cleaned.get("evidence_sources"), allowed_evidence)
        cleaned["evidence_sources"] = ev
        changes += c
        out["dramatic_function"] = cleaned

    phases = out.get("emotional_arc")
    if isinstance(phases, list):
        cleaned_phases: list[Any] = []
        for phase in phases:
            if not isinstance(phase, dict):
                cleaned_phases.append(phase)
                continue
            item = {key: copy.deepcopy(value) for key, value in phase.items() if key in _PHASE_FIELDS}
            changes += len(set(phase) - _PHASE_FIELDS)
            if isinstance(item.get("beat_refs"), list):
                before = list(item["beat_refs"])
                item["beat_refs"] = [str(ref) for ref in before if str(ref) in allowed_beats]
                changes += int(before != item["beat_refs"])
            if isinstance(item.get("shot_refs"), list):
                before = list(item["shot_refs"])
                item["shot_refs"] = [str(ref) for ref in before if str(ref) in allowed_shots]
                changes += int(before != item["shot_refs"])
            ev, c = _canonical_evidence(item.get("evidence_sources"), allowed_evidence)
            item["evidence_sources"] = ev
            changes += c
            cleaned_phases.append(item)
        out["emotional_arc"] = cleaned_phases

    relations = out.get("relationship_dynamics")
    if isinstance(relations, list):
        cleaned_relations: list[Any] = []
        for relation in relations:
            if not isinstance(relation, dict):
                cleaned_relations.append(relation)
                continue
            item = {key: copy.deepcopy(value) for key, value in relation.items() if key in _REL_FIELDS}
            changes += len(set(relation) - _REL_FIELDS)
            refs = item.get("character_refs")
            if isinstance(refs, list):
                refs = [str(ref) for ref in refs if str(ref) in allowed_chars]
                if refs != item.get("character_refs"):
                    changes += 1
                item["character_refs"] = refs
            if len(item.get("character_refs") or []) < 2:
                changes += 1
                continue
            ev, c = _canonical_evidence(item.get("evidence_sources"), allowed_evidence)
            item["evidence_sources"] = ev
            changes += c
            cleaned_relations.append(item)
        out["relationship_dynamics"] = cleaned_relations

    reaction = out.get("reaction_strategy")
    if isinstance(reaction, dict):
        cleaned = {key: copy.deepcopy(value) for key, value in reaction.items() if key in {"priority", "preferred_reaction_shot_refs"}}
        changes += len(set(reaction) - {"priority", "preferred_reaction_shot_refs"})
        refs = cleaned.get("preferred_reaction_shot_refs")
        if isinstance(refs, list):
            before = list(refs)
            cleaned["preferred_reaction_shot_refs"] = [str(ref) for ref in refs if str(ref) in allowed_shots]
            changes += int(before != cleaned["preferred_reaction_shot_refs"])
        out["reaction_strategy"] = cleaned

    camera = out.get("camera_strategy")
    if isinstance(camera, dict):
        allowed_fields = {"stability", "framing_tendency", "movement_policy"}
        cleaned = {key: copy.deepcopy(value) for key, value in camera.items() if key in allowed_fields}
        changes += len(set(camera) - allowed_fields)
        out["camera_strategy"] = cleaned

    baselines = out.get("character_performance_baselines")
    if isinstance(baselines, list):
        cleaned_baselines: list[Any] = []
        for baseline in baselines:
            if not isinstance(baseline, dict):
                cleaned_baselines.append(baseline)
                continue
            item = {key: copy.deepcopy(value) for key, value in baseline.items() if key in _BASELINE_FIELDS}
            changes += len(set(baseline) - _BASELINE_FIELDS)
            if str(item.get("character_ref") or "") not in allowed_chars:
                changes += 1
                continue
            cleaned_baselines.append(item)
        out["character_performance_baselines"] = cleaned_baselines

    ev, c = _canonical_evidence(out.get("evidence_sources"), allowed_evidence)
    out["evidence_sources"] = ev
    changes += c
    return out, changes


def _validate_evidence(errors: list[dict[str, Any]], items: Any, allowed: set[tuple[str, str]], path: str) -> None:
    if not isinstance(items, list):
        errors.append(_error("scene_context_shape_error", "evidence_sources must be array", path=path))
        return
    for index, item in enumerate(items):
        p = f"{path}[{index}]"
        if not isinstance(item, dict) or set(item) != _EVIDENCE_FIELDS:
            errors.append(_error("scene_context_shape_error", "evidence item must contain source_type/source_ref only", path=p))
            continue
        source_type = item.get("source_type")
        source_ref = item.get("source_ref")
        if source_type not in EVIDENCE_TYPES:
            errors.append(_error("scene_context_invalid_evidence_type", f"unsupported source_type: {source_type}", path=f"{p}.source_type"))
        if (str(source_type or ""), str(source_ref or "")) not in allowed:
            errors.append(_error("scene_context_unknown_evidence_ref", f"unsupported evidence ref: {source_type}:{source_ref}", path=p))


def validate_director_scene_context(value: Any, context: dict[str, Any]) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    if not isinstance(value, dict):
        return [_error("scene_context_shape_error", "scene_director_context must be object", path="scene_director_context")]
    if set(value) != _TOP_FIELDS:
        missing = sorted(_TOP_FIELDS - set(value))
        extra = sorted(set(value) - _TOP_FIELDS)
        errors.append(_error("scene_context_shape_error", f"top-level fields mismatch: missing={missing}, extra={extra}", path="scene_director_context"))

    program = context.get("program_owned") or {}
    allowed_chars = set(program.get("allowed_character_refs") or [])
    allowed_beats = set(program.get("allowed_beat_refs") or [])
    allowed_shots = set(program.get("allowed_shot_refs") or [])
    evidence = _allowed_evidence(context)
    expected_scene_id = str((context.get("scene") or {}).get("scene_id") or "")
    if value.get("scene_id") != expected_scene_id:
        errors.append(_error("scene_context_scene_mismatch", "scene_id must match current Scene", path="scene_director_context.scene_id"))
    if value.get("contract_version") != CONTRACT_VERSION:
        errors.append(_error("scene_context_contract_mismatch", f"contract_version must be {CONTRACT_VERSION}", path="scene_director_context.contract_version"))

    dramatic = value.get("dramatic_function")
    if not isinstance(dramatic, dict) or set(dramatic) != {"summary", "evidence_sources"}:
        errors.append(_error("scene_context_shape_error", "dramatic_function must contain summary/evidence_sources", path="scene_director_context.dramatic_function"))
    else:
        if not isinstance(dramatic.get("summary"), str) or not dramatic.get("summary", "").strip():
            errors.append(_error("scene_context_shape_error", "dramatic_function.summary must be non-empty string", path="scene_director_context.dramatic_function.summary"))
        _validate_evidence(errors, dramatic.get("evidence_sources"), evidence, "scene_director_context.dramatic_function.evidence_sources")

    phases = value.get("emotional_arc")
    if not isinstance(phases, list):
        errors.append(_error("scene_context_shape_error", "emotional_arc must be array", path="scene_director_context.emotional_arc"))
    else:
        seen_phase_ids: set[str] = set()
        for index, phase in enumerate(phases):
            p = f"scene_director_context.emotional_arc[{index}]"
            if not isinstance(phase, dict) or set(phase) != _PHASE_FIELDS:
                errors.append(_error("scene_context_shape_error", f"emotional_arc item fields must equal {sorted(_PHASE_FIELDS)}", path=p))
                continue
            phase_id = phase.get("phase_id")
            if not isinstance(phase_id, str) or not phase_id.strip() or phase_id in seen_phase_ids:
                errors.append(_error("scene_context_invalid_phase_id", "phase_id must be unique non-empty string", path=f"{p}.phase_id"))
            else:
                seen_phase_ids.add(phase_id)
            for field, allowed_refs in (("beat_refs", allowed_beats), ("shot_refs", allowed_shots)):
                refs = phase.get(field)
                if (
                    not isinstance(refs, list)
                    or not refs
                    or not all(isinstance(ref, str) and ref in allowed_refs for ref in refs)
                ):
                    errors.append(_error("scene_context_invalid_ref", f"{field} must be a non-empty array of current-Scene refs", path=f"{p}.{field}"))
            if phase.get("function") not in SCENE_PHASES:
                errors.append(_error("scene_context_invalid_phase_function", f"unsupported function: {phase.get('function')}", path=f"{p}.function"))
            if phase.get("intensity") not in INTENSITIES:
                errors.append(_error("scene_context_invalid_intensity", f"unsupported intensity: {phase.get('intensity')}", path=f"{p}.intensity"))
            _validate_evidence(errors, phase.get("evidence_sources"), evidence, f"{p}.evidence_sources")

        # v1_1: available/repaired Scene Context must be a complete ordered
        # partition of the existing Storyboard shots. This is a structural
        # invariant only; it does not judge creative phase quality.
        if all(isinstance(phase, dict) for phase in phases):
            storyboard_shots = [
                shot for shot in ((context.get("storyboard_scene") or {}).get("shots") or [])
                if isinstance(shot, dict) and str(shot.get("shot_id") or "")
            ]
            expected_shots = [str(shot.get("shot_id") or "") for shot in storyboard_shots]
            shot_to_beat = {
                str(shot.get("shot_id") or ""): str(shot.get("beat_id") or "")
                for shot in storyboard_shots
            }
            flattened: list[str] = []
            for index, phase in enumerate(phases):
                refs = phase.get("shot_refs") if isinstance(phase.get("shot_refs"), list) else []
                flattened.extend(str(ref) for ref in refs)
                expected_beats: list[str] = []
                for ref in refs:
                    beat_ref = shot_to_beat.get(str(ref), "")
                    if beat_ref and beat_ref not in expected_beats:
                        expected_beats.append(beat_ref)
                if list(phase.get("beat_refs") or []) != expected_beats:
                    errors.append(_error(
                        "scene_context_phase_beat_ownership_mismatch",
                        f"phase beat_refs must equal the original Beat ownership of its Shot interval: expected={expected_beats}",
                        path=f"scene_director_context.emotional_arc[{index}].beat_refs",
                    ))
            if flattened != expected_shots:
                errors.append(_error(
                    "scene_context_phase_partition_invalid",
                    "emotional_arc must cover every current-Scene Shot exactly once, in Storyboard order, using contiguous non-overlapping Phase intervals",
                    path="scene_director_context.emotional_arc",
                ))

    relations = value.get("relationship_dynamics")
    if not isinstance(relations, list):
        errors.append(_error("scene_context_shape_error", "relationship_dynamics must be array", path="scene_director_context.relationship_dynamics"))
    else:
        for index, relation in enumerate(relations):
            p = f"scene_director_context.relationship_dynamics[{index}]"
            if not isinstance(relation, dict) or set(relation) != _REL_FIELDS:
                errors.append(_error("scene_context_shape_error", f"relationship item fields must equal {sorted(_REL_FIELDS)}", path=p))
                continue
            refs = relation.get("character_refs")
            if not isinstance(refs, list) or len(refs) < 2 or not all(isinstance(ref, str) and ref in allowed_chars for ref in refs):
                errors.append(_error("scene_context_invalid_character_ref", "relationship character_refs require >=2 allowed refs", path=f"{p}.character_refs"))
            if relation.get("relation_mode") not in RELATION_MODES:
                errors.append(_error("scene_context_invalid_relation_mode", f"unsupported relation_mode: {relation.get('relation_mode')}", path=f"{p}.relation_mode"))
            if relation.get("power_balance") not in POWER_BALANCES:
                errors.append(_error("scene_context_invalid_power_balance", f"unsupported power_balance: {relation.get('power_balance')}", path=f"{p}.power_balance"))
            _validate_evidence(errors, relation.get("evidence_sources"), evidence, f"{p}.evidence_sources")

    reaction = value.get("reaction_strategy")
    if not isinstance(reaction, dict) or set(reaction) != {"priority", "preferred_reaction_shot_refs"}:
        errors.append(_error("scene_context_shape_error", "reaction_strategy shape invalid", path="scene_director_context.reaction_strategy"))
    else:
        if reaction.get("priority") not in REACTION_PRIORITIES:
            errors.append(_error("scene_context_invalid_reaction_priority", f"unsupported priority: {reaction.get('priority')}", path="scene_director_context.reaction_strategy.priority"))
        refs = reaction.get("preferred_reaction_shot_refs")
        if not isinstance(refs, list) or not all(isinstance(ref, str) and ref in allowed_shots for ref in refs):
            errors.append(_error("scene_context_invalid_ref", "preferred_reaction_shot_refs contains unknown ref", path="scene_director_context.reaction_strategy.preferred_reaction_shot_refs"))

    camera = value.get("camera_strategy")
    camera_fields = {"stability", "framing_tendency", "movement_policy"}
    if not isinstance(camera, dict) or set(camera) != camera_fields:
        errors.append(_error("scene_context_shape_error", "camera_strategy must contain scene-level stability/framing_tendency/movement_policy only", path="scene_director_context.camera_strategy"))
    else:
        if camera.get("stability") not in CAMERA_STABILITIES:
            errors.append(_error("scene_context_invalid_camera_strategy", f"unsupported stability: {camera.get('stability')}", path="scene_director_context.camera_strategy.stability"))
        if camera.get("framing_tendency") not in FRAMING_TENDENCIES:
            errors.append(_error("scene_context_invalid_camera_strategy", f"unsupported framing_tendency: {camera.get('framing_tendency')}", path="scene_director_context.camera_strategy.framing_tendency"))
        if camera.get("movement_policy") not in MOVEMENT_POLICIES:
            errors.append(_error("scene_context_invalid_camera_strategy", f"unsupported movement_policy: {camera.get('movement_policy')}", path="scene_director_context.camera_strategy.movement_policy"))

    baselines = value.get("character_performance_baselines")
    if not isinstance(baselines, list):
        errors.append(_error("scene_context_shape_error", "character_performance_baselines must be array", path="scene_director_context.character_performance_baselines"))
    else:
        for index, baseline in enumerate(baselines):
            p = f"scene_director_context.character_performance_baselines[{index}]"
            if not isinstance(baseline, dict) or set(baseline) != _BASELINE_FIELDS:
                errors.append(_error("scene_context_shape_error", f"baseline fields must equal {sorted(_BASELINE_FIELDS)}", path=p))
                continue
            if baseline.get("character_ref") not in allowed_chars:
                errors.append(_error("scene_context_invalid_character_ref", f"unknown character_ref: {baseline.get('character_ref')}", path=f"{p}.character_ref"))
            if baseline.get("baseline_energy") not in BASELINE_ENERGIES:
                errors.append(_error("scene_context_invalid_baseline", f"unsupported baseline_energy: {baseline.get('baseline_energy')}", path=f"{p}.baseline_energy"))
            if baseline.get("baseline_control") not in BASELINE_CONTROLS:
                errors.append(_error("scene_context_invalid_baseline", f"unsupported baseline_control: {baseline.get('baseline_control')}", path=f"{p}.baseline_control"))
            if baseline.get("baseline_social_posture") not in SOCIAL_POSTURES:
                errors.append(_error("scene_context_invalid_baseline", f"unsupported baseline_social_posture: {baseline.get('baseline_social_posture')}", path=f"{p}.baseline_social_posture"))

    _validate_evidence(errors, value.get("evidence_sources"), evidence, "scene_director_context.evidence_sources")
    return errors


def build_director_scene_context_payload(context: dict[str, Any], *, unit_id: str) -> dict[str, Any]:
    program = copy.deepcopy(context.get("program_owned") or {})
    scene = copy.deepcopy(context.get("scene") or {})
    scene_id = str(scene.get("scene_id") or "")
    payload = {
        "scene": scene,
        "scene_plan": copy.deepcopy(context.get("scene_plan") or {}),
        "script_scene": copy.deepcopy(context.get("script_scene") or {}),
        "storyboard_scene": copy.deepcopy(context.get("storyboard_scene") or {}),
        "production_semantics_digest": copy.deepcopy(context.get("production_semantics_digest") or []),
        "assets": copy.deepcopy(context.get("assets") or {}),
        "program_owned": program,
        "unit_id": unit_id,
        "contract_version": CONTRACT_VERSION,
    }
    payload["output_contract"] = {
        "root": "object{scene_director_context}",
        "allowed_values": {
            "emotional_arc[*].function": sorted(SCENE_PHASES),
            "emotional_arc[*].intensity": sorted(INTENSITIES),
            "relationship_dynamics[*].relation_mode": sorted(RELATION_MODES),
            "relationship_dynamics[*].power_balance": sorted(POWER_BALANCES),
            "reaction_strategy.priority": sorted(REACTION_PRIORITIES),
            "camera_strategy.stability": sorted(CAMERA_STABILITIES),
            "camera_strategy.framing_tendency": sorted(FRAMING_TENDENCIES),
            "camera_strategy.movement_policy": sorted(MOVEMENT_POLICIES),
            "character_performance_baselines[*].baseline_energy": sorted(BASELINE_ENERGIES),
            "character_performance_baselines[*].baseline_control": sorted(BASELINE_CONTROLS),
            "character_performance_baselines[*].baseline_social_posture": sorted(SOCIAL_POSTURES),
            "evidence_sources[*].source_type": sorted(EVIDENCE_TYPES),
        },
        "boundary": "scene strategy only; no new story facts, concrete actions, precise camera angles or movement trajectories",
        "unknown_fields": "forbidden; Runtime canonicalizer removes extras before validation",
    }
    template = {
        "scene_director_context": {
            "scene_id": scene_id,
            "contract_version": CONTRACT_VERSION,
            "dramatic_function": {"summary": "", "evidence_sources": []},
            "emotional_arc": [],
            "relationship_dynamics": [],
            "reaction_strategy": {"priority": "low", "preferred_reaction_shot_refs": []},
            "camera_strategy": {"stability": "stable", "framing_tendency": "mixed", "movement_policy": "mostly_static"},
            "character_performance_baselines": [],
            "evidence_sources": [],
        }
    }
    payload["output_template"] = template
    provider = copy.deepcopy(template)
    sample_evidence = next(iter(program.get("allowed_evidence_refs") or []), {"source_type": "storyboard_shot", "source_ref": next(iter(program.get("allowed_shot_refs") or ["SH001"]), "SH001")})
    sample_char = next(iter(program.get("allowed_character_refs") or ["char_001"]), "char_001")
    sample_beat = next(iter(program.get("allowed_beat_refs") or ["B001"]), "B001")
    sample_shot = next(iter(program.get("allowed_shot_refs") or ["SH001"]), "SH001")
    provider["scene_director_context"]["dramatic_function"] = {"summary": "场景戏剧功能", "evidence_sources": [copy.deepcopy(sample_evidence)]}
    provider["scene_director_context"]["emotional_arc"] = [{
        "phase_id": "phase_01", "beat_refs": [sample_beat], "shot_refs": [sample_shot],
        "function": "setup", "intensity": "low",
        "evidence_sources": [copy.deepcopy(sample_evidence)],
    }]
    provider["scene_director_context"]["relationship_dynamics"] = [{
        "character_refs": [sample_char, sample_char], "relation_mode": "observation", "power_balance": "balanced",
        "evidence_sources": [copy.deepcopy(sample_evidence)],
    }]
    provider["scene_director_context"]["reaction_strategy"] = {"priority": "low", "preferred_reaction_shot_refs": [sample_shot]}
    provider["scene_director_context"]["camera_strategy"] = {
        "stability": "stable", "framing_tendency": "mixed", "movement_policy": "mostly_static",
    }
    provider["scene_director_context"]["character_performance_baselines"] = [{
        "character_ref": sample_char, "baseline_energy": "neutral", "baseline_control": "controlled", "baseline_social_posture": "equal",
    }]
    provider["scene_director_context"]["evidence_sources"] = [copy.deepcopy(sample_evidence)]
    payload["provider_output_template"] = provider
    return payload
