from __future__ import annotations

import copy
import re
from difflib import SequenceMatcher
from typing import Any

from runtime.value_normalization import coerce_unambiguous_bool
from runtime.authority_contract import authority_manifest

from app.shape_validation import validate_stage_shape
from runtime.source_index import build_source_index, materialize_evidence, narrative_source_index, refs_to_span, source_index_map

CONTRACT_VERSION = "story_bible.v14"

CHARACTER_VISUAL_LOCK_FIELDS = {
    "age_appearance", "face", "hair", "body", "skin",
    "default", "outerwear", "shirt", "footwear", "accessory",
}
SCENE_VISUAL_LOCK_FIELDS = {"space", "layout", "materials", "lighting", "color", "environment"}
VALID_ROLE_TYPES = {"main", "supporting", "background", "referenced_only"}
SOFT_QUALITY_ERROR_TYPES = frozenset({
    "story_bible_identity_lock_weak_lexical_anchor",
    "story_bible_explicit_fact_weak_lexical_anchor",
    "story_bible_unverifiable_explicit_fact_dropped",
    "story_bible_unproven_identity_attribute_dropped",
})

SYSTEM_PROMPT = """你是 Prompt Foundry Runtime 2.x 的 Stage 1：Story Bible Extractor。
你的唯一任务是从小说原文提取可验证的叙事事实；不做 Scene Plan、Script、Storyboard、Director 或生产设计。

权责边界：
1. 模型负责：实体顺序、canonical_name、aliases、role_type、显式事实、必要且低风险的 inferred_facts、identity_lock、原文明示 visual_lock、source_evidence，以及 narrative context 的语义维度。
2. 程序负责：bible_id、project_id、version、character_id、scene_id、prop_id、context_id。不要自行设计或依赖这些 ID；按 output_template 保留字段即可，程序会在模型输出后统一覆盖。
3. characters / scenes / props / narrative_contexts 的数组顺序必须按原文首次有效出现顺序，程序将据此分配稳定 ID。

事实规则：
- explicit_facts 是“可核验事实”，不是身份归一化摘要。保持原文的实体指称、人称、主客体和动作方向；除非绑定证据直接支持，不得把代词/称谓改成 canonical_name 或自行合成关系名。只允许不改变上述语义角色的轻微语法整理，也不要把不同句子分别证明的动作/属性压成一条复合事实。
- explicit_facts 是可选的局部事实摘要，不负责替代原文对白。若一句事实必须把问句、省略对白、说话行为或上下文关系大幅转述后才能成立，优先不写该 fact；后续 Script 会直接消费原文。
- 一条 explicit_fact 若确实需要相邻多句共同证明，必须让同一个 source_evidence 项的 source_refs 覆盖这些最小连续 source units；证据只覆盖事实的一半视为不合格。
- physical scene 只能是可拍摄物理地点；叙事时间、现实层或表现层变化用 narrative_contexts 表达，不要把 flashback/dream 当成新的物理地点。
- 非空故事原文必须至少建立一个 physical scene。若原文没有明确地点，不得编造具体地点；建立最小“未明确空间”场景并用对应 source_refs 锚定，确保下游 Scene Plan 有合法 location_ref。
- explicit_facts 与 visual_lock 必须由其最小连续 source evidence window 直接建立。identity_lock 是对原文稳定身份属性的规范化提取：必须绑定真实、局部、最小的 source evidence，但允许使用不与原句逐字相同的规范化类别词；不得借其他不相邻 evidence、其他字段或模型常识新增身份。
- visual_lock 只保存原文明示且稳定的视觉事实；不得为了“完整角色设计”自行补脸、发型、服装、灯光或色彩。
- scene.visual_lock.environment 只记录原文明示、在该物理场景中可直接看见或直接陈述的环境元素与空间关系；不得把场景 canonical_name、外部地点归属或推断出的邻近/方位关系拼入该字段。
- 一个 visual_lock 字符串可以包含多个以句号/分号等分隔的原子视觉事实。多个彼此独立的原子事实允许由多条局部 source_evidence 共同覆盖，并重复绑定同一个 visual_lock.<key> support_path；每条 evidence 只需真实支持其中相关原子事实，不要为了让单条 evidence 证明整串字段而扩大到远距离上下文。Runtime 会按原子事实全集检查覆盖。
- character.visual_lock 只允许 age_appearance/face/hair/body/skin/default/outerwear/shirt/footwear/accessory。
- scene.visual_lock 只允许 space/layout/materials/lighting/color/environment。
- role_type 只能 main/supporting/background/referenced_only。
- source_evidence 输出 {"source_refs":["<source_index中的source_ref>"],"supports":["explicit_facts[0]"]}。source_refs 必须来自 source_index；supports 必须逐项指出这条证据支持的当前实体事实路径。不要手工复制长 quote；程序会根据 source_refs 写入精确 quote 与 source_start/source_end。
- legacy quote 仅用于兼容旧数据；新生成时不要依赖 quote。每条 evidence 应选择最小、连续、足以支持 supports 所列事实的 source_refs。characters 的 supports 可引用 explicit_facts[i] / identity_lock.<key> / visual_lock.<key>；scenes 可引用 explicit_facts[i] / time / weather / visual_lock.<key>；props 可引用 explicit_facts[i]。
- narrative_contexts 没有真实上下文变化时必须输出 []。有上下文时每项固定包含 context_id/reality_status/temporal_mode/representation_mode/source_evidence；三个语义维度必须用非空字符串说明该 context。
- 所有必填 array/object 必须用 []/{}，禁止 null；所有必填字段不得省略。
- 输出必须严格等于 output_contract 定义的字段集合，禁止添加未声明字段；identity_lock 内部键除外，它只承载由局部原文证据可建立的稳定身份属性。
- 模型输出的 source_evidence 每项只允许 source_refs + supports；程序 canonicalize 后会形成 source_refs/source_start/source_end/quote/supports。不得附带解释或置信度。
- 如果 user payload 含 repair_instruction：必须以 repair_instruction.invalid_output 为基底，只修 validation_errors 指向的字段；未报错的实体、顺序、原文证据和既有合法事实保持不变，不得把 Repair 当成重新抽取整部 Story Bible。
- source_evidence 可以绑定多个 source_refs。遇到代词指代、说话者身份、跨相邻句动作/属性共同支撑一个事实时，必须选择最小且连续、足以完整证明该事实的 source_refs，不能只绑其中半句。
- identity_lock 是可选的 source-derived attribute。必须尽量为每个保留属性提供 source_evidence.supports；若 Runtime 在确定性绑定后仍找不到某个 identity_lock leaf 的 provenance，该可选属性会被隔离删除，而不是阻断整条生产线。
- 若 validation_errors 为 invalid_source_evidence_ref / evidence_quote_not_in_source / story_bible_fact_provenance_missing：只修仍属硬权威字段的 source_refs/supports，必须从 source_index 选择真实 source_ref；不得通过改写 quote 规避。
- 若 validation_errors 为 story_bible_fact_not_supported：优先检查当前 evidence 是否只是缺少相邻上下文（如问答省略、说话者、代词先行词或跨相邻句事实）。若最小连续 source window 能完整建立该 leaf，只改该 evidence 的 source_refs；若连续上下文仍不能建立 leaf，再收缩/修正或删除该 factual leaf，并同步 supports。禁止用远距离、不连续 evidence 或其他字段事后拼接支持。其他合法事实不得改动。
- repair_instruction.preserve_unrelated_story_facts=true 表示“保留未报错事实”，不表示禁止纠正当前 validation_errors 明确指向的错误事实。
- 只输出一个 JSON object，不要 markdown、解释或前后缀文本。
"""


def _leaf_evidence() -> list[dict[str, Any]]:
    return [{"source_refs": ["SRC0001"], "supports": ["explicit_facts[0]"]}]


def output_template() -> dict[str, Any]:
    return {
        "bible_id": "",
        "project_id": "",
        "version": 1,
        "characters": [{
            "character_id": "",
            "canonical_name": "",
            "aliases": [],
            "role_type": "main",
            "explicit_facts": [],
            "inferred_facts": [],
            "identity_lock": {},
            "visual_lock": {},
            "source_evidence": _leaf_evidence(),
        }],
        "scenes": [{
            "scene_id": "",
            "canonical_name": "",
            "name": "",
            "time": "",
            "weather": "",
            "explicit_facts": [],
            "visual_lock": {},
            "source_evidence": _leaf_evidence(),
        }],
        "props": [{
            "prop_id": "",
            "canonical_name": "",
            "name": "",
            "aliases": [],
            "narrative_importance": "medium",
            "visual_presence": "present",
            "visual_asset_required": True,
            "explicit_facts": [],
            "source_evidence": _leaf_evidence(),
        }],
        "narrative_contexts": [{
            "context_id": "",
            "reality_status": "",
            "temporal_mode": "",
            "representation_mode": "",
            "source_evidence": _leaf_evidence(),
        }],
    }


def output_contract() -> dict[str, Any]:
    return {
        "required_top_level_fields": [
            "bible_id", "project_id", "version", "characters", "scenes", "props", "narrative_contexts"
        ],
        "program_owned_fields": [
            "bible_id", "project_id", "version", "character_id", "scene_id", "prop_id", "context_id"
        ],
        "required_character_fields": [
            "character_id", "canonical_name", "aliases", "role_type", "explicit_facts", "inferred_facts",
            "identity_lock", "visual_lock", "source_evidence",
        ],
        "required_scene_fields": [
            "scene_id", "canonical_name", "name", "time", "weather", "explicit_facts", "visual_lock", "source_evidence",
        ],
        "required_prop_fields": [
            "prop_id", "canonical_name", "name", "aliases", "narrative_importance", "visual_presence",
            "visual_asset_required", "explicit_facts", "source_evidence",
        ],
        "required_context_fields": [
            "context_id", "reality_status", "temporal_mode", "representation_mode", "source_evidence",
        ],
        "character_visual_lock_fields": sorted(CHARACTER_VISUAL_LOCK_FIELDS),
        "scene_visual_lock_fields": sorted(SCENE_VISUAL_LOCK_FIELDS),
        "source_evidence_shape": "model=array<object{source_refs:string[],supports:string[]}>; canonical=array<object{source_refs,source_start,source_end,quote,supports}>",
        "null_policy": "required arrays/objects must use []/{}; null is forbidden",
        "authority_manifest": authority_manifest("story_bible"),
    }


def build_story_bible_payload(
    source_text: str,
    *,
    unit_id: str,
    source_index: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    resolved_source_index = source_index or build_source_index(source_text)
    model_source_index = [
        {"source_ref": str(item["source_ref"]), "text": str(item["text"])}
        for item in narrative_source_index(resolved_source_index)
    ]
    template = output_template()
    if model_source_index:
        first_narrative_ref = model_source_index[0]["source_ref"]
        for collection in ("characters", "scenes", "props", "narrative_contexts"):
            items = template.get(collection) or []
            if items and isinstance(items[0], dict):
                evidence = items[0].get("source_evidence") or []
                if evidence and isinstance(evidence[0], dict):
                    evidence[0]["source_refs"] = [first_narrative_ref]
    return {
        "unit_id": unit_id,
        "contract_version": CONTRACT_VERSION,
        # document_heading remains in the audit Source Index but never enters story facts.
        "source_index": model_source_index,
        "output_template": template,
        "output_contract": output_contract(),
    }


def _set(target: dict[str, Any], key: str, value: Any) -> int:
    if key in target and target.get(key) == value:
        return 0
    target[key] = value
    return 1


def canonicalize_story_bible(candidate: dict[str, Any], *, run_id: str, source_text: str = "", source_index: list[dict[str, Any]] | None = None) -> tuple[dict[str, Any], int]:
    """Assign only mechanical metadata/IDs; never invent semantic content."""
    out = copy.deepcopy(candidate)
    changes = 0
    suffix = run_id[4:] if run_id.startswith("run_") else run_id
    changes += _set(out, "bible_id", f"bible_{suffix}")
    changes += _set(out, "project_id", run_id)
    changes += _set(out, "version", 1)

    resolved_source_index = source_index or (build_source_index(source_text) if source_text else [])
    groups = (
        ("characters", "character_id", "char"),
        ("scenes", "scene_id", "scene"),
        ("props", "prop_id", "prop"),
        ("narrative_contexts", "context_id", "context"),
    )
    for collection, key, prefix in groups:
        items = out.get(collection)
        if not isinstance(items, list):
            continue
        for index, item in enumerate(items, 1):
            if isinstance(item, dict):
                changes += _set(item, key, f"{prefix}_{index:03d}")
                if collection == "props" and "visual_asset_required" in item:
                    normalized_bool, bool_changed = coerce_unambiguous_bool(item.get("visual_asset_required"))
                    if normalized_bool is not None and (
                        type(item.get("visual_asset_required")) is not bool
                        or item.get("visual_asset_required") != normalized_bool
                    ):
                        item["visual_asset_required"] = normalized_bool
                    if bool_changed:
                        changes += 1
                if source_text:
                    evidence, delta = materialize_evidence(
                        item.get("source_evidence"),
                        source_text=source_text,
                        source_index=resolved_source_index,
                    )
                    if delta:
                        item["source_evidence"] = evidence
                        changes += delta
                    # `supports` is a pointer layer, not a source of story facts. A model
                    # may return stale explicit_facts[n] references after it removes or
                    # leaves a factual leaf empty. Prune only those dangling pointers
                    # deterministically before provenance inference/validation; never
                    # recreate the missing fact from the numeric index. Existing source
                    # refs/quotes remain available for `_infer_fact_supports()` to bind
                    # to real leaves they actually support.
                    changes += _prune_dangling_support_paths(item)
                    required_paths: list[str] = []
                    if collection == "characters":
                        required_paths = [f"explicit_facts[{idx}]" for idx, fact in enumerate(item.get("explicit_facts") or []) if isinstance(fact, str) and fact.strip()]
                        required_paths += _flatten_lock_paths(item.get("identity_lock") or {}, "identity_lock")
                        required_paths += _flatten_lock_paths(item.get("visual_lock") or {}, "visual_lock")
                    elif collection == "scenes":
                        required_paths = [f"explicit_facts[{idx}]" for idx, fact in enumerate(item.get("explicit_facts") or []) if isinstance(fact, str) and fact.strip()]
                        required_paths += _flatten_lock_paths(item.get("visual_lock") or {}, "visual_lock")
                    elif collection == "props":
                        required_paths = [f"explicit_facts[{idx}]" for idx, fact in enumerate(item.get("explicit_facts") or []) if isinstance(fact, str) and fact.strip()]
                    changes += _expand_minimal_supporting_evidence_windows(
                        item, source_text=source_text, source_index=resolved_source_index
                    )
                    changes += _infer_fact_supports(item, required_paths)
    return out, changes


def _error(errors: list[dict[str, Any]], etype: str, detail: str, **context: Any) -> None:
    item: dict[str, Any] = {"type": etype, "detail": detail}
    item.update(context)
    errors.append(item)


def _require_fields(errors: list[dict[str, Any]], item: dict[str, Any], fields: list[str], *, path: str) -> None:
    for field in fields:
        if field not in item:
            _error(errors, "missing_story_bible_field", f"{path}.{field} is required", path=path, field=field)


def _reject_extra_fields(errors: list[dict[str, Any]], item: dict[str, Any], fields: list[str], *, path: str) -> None:
    for field in sorted(set(item) - set(fields)):
        _error(errors, "extra_story_bible_field", f"{path}.{field} is not allowed by the Story Bible contract", path=path, field=field)


def _require_string(errors: list[dict[str, Any]], item: dict[str, Any], field: str, *, path: str, nonempty: bool = False) -> None:
    value = item.get(field)
    if not isinstance(value, str):
        _error(errors, "invalid_story_bible_scalar", f"{path}.{field} must be string", path=path, field=field)
    elif nonempty and not value.strip():
        _error(errors, "invalid_story_bible_scalar", f"{path}.{field} must be nonempty string", path=path, field=field)


def _require_string_list(errors: list[dict[str, Any]], value: Any, *, path: str) -> None:
    if not isinstance(value, list):
        return
    for idx, item in enumerate(value):
        if not isinstance(item, str):
            _error(errors, "invalid_story_bible_list_item", f"{path}[{idx}] must be string", path=f"{path}[{idx}]")


def _validate_evidence(errors: list[dict[str, Any]], evidence: Any, *, path: str, source_text: str, source_index: list[dict[str, Any]]) -> None:
    if not isinstance(evidence, list):
        return
    if not evidence:
        _error(errors, "missing_source_evidence", f"{path} requires at least one source evidence item", path=path)
        return
    valid_refs = set(source_index_map(narrative_source_index(source_index)))
    for idx, item in enumerate(evidence):
        ep = f"{path}[{idx}]"
        if not isinstance(item, dict):
            continue
        allowed_fields = {"source_refs", "source_start", "source_end", "quote", "supports"}
        for field in sorted(set(item) - allowed_fields):
            _error(errors, "extra_story_bible_field", f"{ep}.{field} is not part of canonical source evidence", path=ep, field=field)
        refs = item.get("source_refs")
        quote = item.get("quote")
        start = item.get("source_start")
        end = item.get("source_end")
        supports = item.get("supports")
        if supports is not None and (not isinstance(supports, list) or not all(isinstance(x, str) and x for x in supports)):
            _error(errors, "invalid_source_evidence_supports", f"{ep}.supports must be non-empty string array when present", path=f"{ep}.supports")
        if isinstance(refs, list) and refs:
            if not all(isinstance(ref, str) and ref in valid_refs for ref in refs):
                _error(errors, "invalid_source_evidence_ref", f"{ep}.source_refs contains unknown source_ref", path=ep, source_refs=refs)
        elif not (isinstance(quote, str) and quote):
            _error(errors, "invalid_source_evidence_ref", f"{ep} requires source_refs or legacy quote", path=ep)
        if isinstance(quote, str) and quote:
            if quote not in source_text:
                _error(errors, "evidence_quote_not_in_source", f"{ep}.quote is not an exact substring of source_text", path=ep, quote=quote)
            elif isinstance(start, int) and isinstance(end, int) and source_text[start:end] != quote:
                _error(errors, "evidence_span_mismatch", f"{ep} offsets do not reproduce quote", path=ep)


def _check_duplicate_canonical_names(errors: list[dict[str, Any]], items: list[dict[str, Any]], *, entity_type: str) -> None:
    seen: dict[str, str] = {}
    for item in items:
        name = item.get("canonical_name")
        if not isinstance(name, str) or not name.strip():
            continue
        key = " ".join(name.split()).casefold()
        if key in seen:
            _error(
                errors,
                "duplicate_story_entity",
                f"duplicate {entity_type} canonical_name: {name}",
                entity_type=entity_type,
                canonical_name=name,
                first_id=seen[key],
            )
        else:
            ref_key = {"character": "character_id", "scene": "scene_id", "prop": "prop_id"}[entity_type]
            seen[key] = str(item.get(ref_key) or "")


_FACT_NORMALIZE_RE = re.compile(r"[\s，。！？；：、‘’“”\"'（）()【】\[\]]+")


def _normalize_fact_text(value: Any) -> str:
    return _FACT_NORMALIZE_RE.sub("", str(value or "")).casefold()


def _bigram_coverage(fact: str, evidence: str) -> float:
    if len(fact) < 2:
        return 1.0 if fact and fact in evidence else 0.0
    grams = [fact[i:i+2] for i in range(len(fact)-1)]
    return sum(1 for gram in grams if gram in evidence) / max(1, len(grams))


def _fact_text_is_supported(value: Any, quote: str) -> bool:
    fact = _normalize_fact_text(value)
    evidence = _normalize_fact_text(quote)
    if not fact or not evidence:
        return False
    if fact in evidence:
        return True
    if SequenceMatcher(None, fact, evidence).ratio() >= 0.55:
        return True
    return _bigram_coverage(fact, evidence) >= 0.45




_VISUAL_ATOM_SPLIT_RE = re.compile(r"[；;。！？!?\n]+")


def _visual_atomic_facts(value: Any) -> list[str]:
    """Split a composite visual_lock string into independently provable source facts.

    visual_lock fields remain strings for downstream compatibility, but a single field
    may legitimately summarize several source-authored visual facts. Provenance is
    therefore evaluated per atomic clause across the evidence set instead of requiring
    every evidence item to reproduce the entire composite string.
    """
    if not isinstance(value, str):
        return []
    atoms: list[str] = []
    for part in _VISUAL_ATOM_SPLIT_RE.split(value):
        atom = part.strip(" \t\r\n，、：:'\"‘’“”（）()[]【】")
        if atom and atom not in atoms:
            atoms.append(atom)
    return atoms


def _is_composite_visual_support_path(support_path: str, value: Any) -> bool:
    return (
        isinstance(support_path, str)
        and support_path.startswith("visual_lock.")
        and len(_visual_atomic_facts(value)) > 1
    )


def _supported_visual_atoms(value: Any, quote: str) -> list[str]:
    return [atom for atom in _visual_atomic_facts(value) if _fact_text_is_supported(atom, quote)]


def _fact_text_is_strongly_supported(value: Any, quote: str) -> bool:
    """Conservative gate used only for deterministic evidence-window expansion.

    Runtime may widen provenance automatically, but must not do so merely because a
    long neighboring sentence happens to share a few character runs. Requiring the
    existing bigram threshold (instead of the looser SequenceMatcher OR branch) keeps
    automatic expansion local and evidence-led; ambiguous cases remain model Repair.
    """
    fact = _normalize_fact_text(value)
    evidence = _normalize_fact_text(quote)
    if not fact or not evidence:
        return False
    return fact in evidence or _bigram_coverage(fact, evidence) >= 0.45


_EXPLICIT_FACT_PATH_RE = re.compile(r"^explicit_facts\[(\d+)\]$")


def _drop_explicit_fact_and_reindex_supports(item: dict[str, Any], index: int) -> int:
    facts = item.get("explicit_facts")
    if not isinstance(facts, list) or not (0 <= index < len(facts)):
        return 0
    facts.pop(index)
    changes = 1
    evidence = item.get("source_evidence")
    if not isinstance(evidence, list):
        return changes
    for ev in evidence:
        if not isinstance(ev, dict) or not isinstance(ev.get("supports"), list):
            continue
        rebuilt: list[str] = []
        changed = False
        for support in ev.get("supports") or []:
            if not isinstance(support, str):
                rebuilt.append(support)
                continue
            match = _EXPLICIT_FACT_PATH_RE.match(support)
            if not match:
                rebuilt.append(support)
                continue
            current = int(match.group(1))
            if current == index:
                changed = True
                continue
            if current > index:
                support = f"explicit_facts[{current - 1}]"
                changed = True
            if support not in rebuilt:
                rebuilt.append(support)
        if changed:
            ev["supports"] = rebuilt
            changes += 1
    return changes


def sanitize_unverifiable_explicit_facts(value: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]], int]:
    """Drop optional explicit-fact summaries that Runtime cannot verify reliably.

    Story Bible source provenance remains authoritative. explicit_facts are convenience
    summaries for downstream context; a weak lexical paraphrase must never block the
    entire pipeline or propagate as a trusted fact. By the time this function runs,
    deterministic local evidence-window expansion has already been attempted.
    """
    out = copy.deepcopy(value)
    warnings: list[dict[str, Any]] = []
    changes = 0
    for collection in ("characters", "scenes", "props"):
        items = out.get(collection)
        if not isinstance(items, list):
            continue
        for item_index, item in enumerate(items):
            if not isinstance(item, dict):
                continue
            facts = item.get("explicit_facts")
            evidence = item.get("source_evidence")
            if not isinstance(facts, list) or not isinstance(evidence, list):
                continue
            weak_indices: list[int] = []
            for fact_index, fact in enumerate(facts):
                if not isinstance(fact, str) or not fact.strip():
                    continue
                support_path = f"explicit_facts[{fact_index}]"
                supporting = [
                    ev for ev in evidence
                    if isinstance(ev, dict)
                    and support_path in (ev.get("supports") or [])
                    and isinstance(ev.get("quote"), str)
                    and ev.get("quote")
                ]
                # Missing provenance remains a hard validator error; do not hide it here.
                if not supporting:
                    continue
                if any(_fact_text_is_supported(fact, str(ev.get("quote") or "")) for ev in supporting):
                    continue
                weak_indices.append(fact_index)
                warnings.append({
                    "type": "story_bible_unverifiable_explicit_fact_dropped",
                    "detail": "optional explicit_fact could not be reliably verified from its local provenance and was omitted from canonical Story Bible",
                    "path": f"{collection}[{item_index}].explicit_facts[{fact_index}]",
                    "fact": fact,
                    "source_refs": [
                        ref
                        for ev in supporting
                        for ref in (ev.get("source_refs") or [])
                        if isinstance(ref, str)
                    ],
                })
            for fact_index in reversed(weak_indices):
                changes += _drop_explicit_fact_and_reindex_supports(item, fact_index)
    return out, warnings, changes


def _drop_identity_lock_leaf(item: dict[str, Any], support_path: str) -> int:
    prefix = "identity_lock."
    if not support_path.startswith(prefix):
        return 0
    parts = [part for part in support_path[len(prefix):].split(".") if part]
    if not parts:
        return 0
    root = item.get("identity_lock")
    if not isinstance(root, dict):
        return 0

    current = root
    parents: list[tuple[dict[str, Any], str]] = []
    for part in parts[:-1]:
        child = current.get(part)
        if not isinstance(child, dict):
            return 0
        parents.append((current, part))
        current = child

    leaf = parts[-1]
    if leaf not in current:
        return 0
    del current[leaf]
    changes = 1

    # Prune only containers made empty by removing this optional attribute.
    for parent, key in reversed(parents):
        child = parent.get(key)
        if isinstance(child, dict) and not child:
            del parent[key]
        else:
            break
    return changes


def sanitize_unproven_identity_attributes(value: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]], int]:
    """Quarantine optional normalized identity attributes that lack provenance.

    identity_lock is a source-derived convenience layer, not the immutable source of
    truth. Runtime first gives canonicalization a chance to infer an unambiguous
    support binding. Any remaining unbound identity leaf is omitted rather than
    sending the same model back to guess provenance during Repair. Hard source
    evidence, visual_lock facts and required Story Bible structure remain unchanged.
    """
    out = copy.deepcopy(value)
    warnings: list[dict[str, Any]] = []
    changes = 0

    characters = out.get("characters")
    if not isinstance(characters, list):
        return out, warnings, changes

    for character_index, character in enumerate(characters):
        if not isinstance(character, dict):
            continue
        identity_paths = _flatten_lock_paths(character.get("identity_lock") or {}, "identity_lock")
        if not identity_paths:
            continue
        covered = _support_coverage(character.get("source_evidence"))
        missing = [path for path in identity_paths if path not in covered]
        for support_path in missing:
            value_at_path = _value_at_support_path(character, support_path)
            if not _drop_identity_lock_leaf(character, support_path):
                continue
            changes += 1
            warnings.append({
                "type": "story_bible_unproven_identity_attribute_dropped",
                "detail": "optional identity attribute had no exact local provenance binding and was omitted from canonical Story Bible",
                "path": f"characters[{character_index}].{support_path}",
                "support_path": support_path,
                "value": value_at_path,
            })
    return out, warnings, changes


MAX_EVIDENCE_CONTEXT_EXPANSION_UNITS = 4


def _evidence_support_values(item: dict[str, Any], evidence_item: dict[str, Any]) -> list[Any]:
    """Return only leaves that require lexical support for deterministic auto-expansion.

    identity_lock values are normalized semantic attributes. They still require exact
    provenance bindings, but lexical overlap is advisory and must not drive evidence
    window expansion.
    """
    values: list[Any] = []
    for support_path in evidence_item.get("supports") or []:
        if not isinstance(support_path, str):
            continue
        if support_path.startswith("identity_lock."):
            continue
        value = _value_at_support_path(item, support_path)
        if value in (None, "", [], {}):
            continue
        if _is_composite_visual_support_path(support_path, value):
            quote = str(evidence_item.get("quote") or "")
            matched_atoms = _supported_visual_atoms(value, quote)
            values.extend(matched_atoms or _visual_atomic_facts(value))
        else:
            values.append(value)
    return values


def _minimal_contiguous_supporting_refs(
    item: dict[str, Any],
    evidence_item: dict[str, Any],
    *,
    source_text: str,
    source_index: list[dict[str, Any]],
) -> list[str] | None:
    refs = evidence_item.get("source_refs")
    if not isinstance(refs, list) or not refs or not source_index:
        return None

    values = _evidence_support_values(item, evidence_item)
    if not values:
        return None
    current_quote = str(evidence_item.get("quote") or "")
    if current_quote and all(_fact_text_is_strongly_supported(value, current_quote) for value in values):
        return list(refs)

    ref_positions = {str(row.get("source_ref")): idx for idx, row in enumerate(source_index)}
    positions = [ref_positions.get(str(ref)) for ref in refs]
    if any(pos is None for pos in positions):
        return None
    start = min(int(pos) for pos in positions if pos is not None)
    end = max(int(pos) for pos in positions if pos is not None)

    # Expand only around the current evidence, smallest window first. This supports
    # local ellipsis/coreference without allowing distant facts to be stitched in.
    for added in range(1, MAX_EVIDENCE_CONTEXT_EXPANSION_UNITS + 1):
        for left_added in range(added + 1):
            right_added = added - left_added
            left = start - left_added
            right = end + right_added
            if left < 0 or right >= len(source_index):
                continue
            candidate_refs = [str(source_index[idx]["source_ref"]) for idx in range(left, right + 1)]
            span = refs_to_span(source_text, source_index, candidate_refs)
            quote = str(span.get("source_text") or "") if span else ""
            if quote and all(_fact_text_is_strongly_supported(value, quote) for value in values):
                return candidate_refs
    return None


def _expand_minimal_supporting_evidence_windows(
    item: dict[str, Any],
    *,
    source_text: str,
    source_index: list[dict[str, Any]],
) -> int:
    evidence = item.get("source_evidence")
    if not isinstance(evidence, list) or not source_text or not source_index:
        return 0
    changes = 0
    for evidence_item in evidence:
        if not isinstance(evidence_item, dict):
            continue
        candidate_refs = _minimal_contiguous_supporting_refs(
            item, evidence_item, source_text=source_text, source_index=source_index
        )
        current_refs = list(evidence_item.get("source_refs") or [])
        if not candidate_refs or candidate_refs == current_refs:
            continue
        span = refs_to_span(source_text, source_index, candidate_refs)
        if not span:
            continue
        evidence_item["source_refs"] = candidate_refs
        evidence_item["source_start"] = span["source_start"]
        evidence_item["source_end"] = span["source_end"]
        evidence_item["quote"] = span["source_text"]
        changes += 1
    return changes


def _value_at_support_path(item: dict[str, Any], path: str) -> Any:
    if path.startswith("explicit_facts[") and path.endswith("]"):
        try:
            idx = int(path[len("explicit_facts["):-1])
            facts = item.get("explicit_facts") or []
            return facts[idx] if isinstance(facts, list) and 0 <= idx < len(facts) else None
        except ValueError:
            return None
    current: Any = item
    for part in path.split("."):
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current


def _prune_dangling_support_paths(item: dict[str, Any]) -> int:
    """Remove support pointers whose target factual leaf is absent or empty.

    `source_evidence` remains intact. This is deliberately pointer hygiene only:
    supports cannot resurrect a deleted/empty Story Bible fact, and no semantic
    field is edited here. When a quote also supports another existing required
    leaf, `_infer_fact_supports()` may bind that valid leaf afterwards.
    """
    evidence = item.get("source_evidence")
    if not isinstance(evidence, list):
        return 0

    changes = 0
    for ev in evidence:
        if not isinstance(ev, dict):
            continue
        supports = ev.get("supports")
        if not isinstance(supports, list):
            continue

        rebuilt: list[str] = []
        for support_path in supports:
            if not isinstance(support_path, str) or not support_path:
                # Shape validation owns malformed support values. Do not silently
                # reinterpret them as a different factual path.
                rebuilt.append(support_path)
                continue
            value = _value_at_support_path(item, support_path)
            if value in (None, "", [], {}):
                changes += 1
                continue
            if support_path not in rebuilt:
                rebuilt.append(support_path)

        if rebuilt == supports:
            continue
        if rebuilt:
            ev["supports"] = rebuilt
        else:
            # `supports=[]` itself is invalid by the canonical evidence shape. Keep
            # the evidence/provenance but omit an empty pointer list.
            ev.pop("supports", None)
        changes += 1
    return changes


def _valid_support_paths_for_item(item: dict[str, Any], *, path: str) -> list[str]:
    paths = [
        f"explicit_facts[{idx}]"
        for idx, fact in enumerate(item.get("explicit_facts") or [])
        if isinstance(fact, str) and fact.strip()
    ]
    if path.startswith("characters["):
        paths += _flatten_lock_paths(item.get("identity_lock") or {}, "identity_lock")
        paths += _flatten_lock_paths(item.get("visual_lock") or {}, "visual_lock")
    elif path.startswith("scenes["):
        for scalar in ("time", "weather"):
            value = item.get(scalar)
            if isinstance(value, str) and value.strip():
                paths.append(scalar)
        paths += _flatten_lock_paths(item.get("visual_lock") or {}, "visual_lock")
    return paths


def _infer_fact_supports(item: dict[str, Any], required_paths: list[str]) -> int:
    evidence = item.get("source_evidence")
    if not isinstance(evidence, list):
        return 0
    changes = 0
    covered = _support_coverage(evidence)
    for fact_path in required_paths:
        value = _value_at_support_path(item, fact_path)
        if _is_composite_visual_support_path(fact_path, value):
            atoms = _visual_atomic_facts(value)
            atom_coverage: set[str] = set()
            # Existing bindings count only for the atoms their local quote actually supports.
            for ev in evidence:
                if not isinstance(ev, dict) or fact_path not in (ev.get("supports") or []):
                    continue
                quote = str(ev.get("quote") or "")
                atom_coverage.update(_supported_visual_atoms(value, quote))
            # Add this support path to additional local evidence only when it proves a
            # still-uncovered atom. One composite field may therefore have several
            # evidence items, each responsible for a different atomic visual fact.
            for atom in atoms:
                if atom in atom_coverage:
                    continue
                for ev in evidence:
                    if not isinstance(ev, dict) or not isinstance(ev.get("quote"), str):
                        continue
                    if not _fact_text_is_supported(atom, ev["quote"]):
                        continue
                    supports = ev.get("supports")
                    if not isinstance(supports, list):
                        supports = []
                        ev["supports"] = supports
                    if fact_path not in supports:
                        supports.append(fact_path)
                        changes += 1
                    atom_coverage.update(_supported_visual_atoms(value, ev["quote"]))
                    break
            if atom_coverage:
                covered.add(fact_path)
            continue

        if fact_path in covered:
            continue
        for ev in evidence:
            if not isinstance(ev, dict) or not isinstance(ev.get("quote"), str):
                continue
            if _fact_text_is_supported(value, ev["quote"]):
                supports = ev.get("supports")
                if not isinstance(supports, list):
                    supports = []
                    ev["supports"] = supports
                supports.append(fact_path)
                covered.add(fact_path)
                changes += 1
                break
    return changes


def _validate_support_semantics(errors: list[dict[str, Any]], item: dict[str, Any], *, path: str) -> None:
    evidence = item.get("source_evidence")
    if not isinstance(evidence, list):
        return

    composite_bindings: dict[str, list[tuple[int, dict[str, Any]]]] = {}
    for ei, ev in enumerate(evidence):
        if not isinstance(ev, dict) or not isinstance(ev.get("quote"), str):
            continue
        for support_path in ev.get("supports") or []:
            value = _value_at_support_path(item, support_path) if isinstance(support_path, str) else None
            if value in (None, "", [], {}):
                supports_path = f"{path}.source_evidence[{ei}].supports"
                _error(
                    errors,
                    "story_bible_invalid_support_path",
                    "evidence supports references a missing/empty factual leaf",
                    path=supports_path,
                    support_path=support_path,
                    repair_targets=[supports_path],
                    valid_support_paths=_valid_support_paths_for_item(item, path=path),
                    repair_action=(
                        "Remove only support entries that reference missing/empty factual leaves. "
                        "Do not recreate a fact from its old numeric index and do not change source_refs/quote. "
                        "If this evidence supports an existing factual leaf, bind only that valid support path."
                    ),
                )
                continue

            if isinstance(support_path, str) and _is_composite_visual_support_path(support_path, value):
                composite_bindings.setdefault(support_path, []).append((ei, ev))
                continue

            if _fact_text_is_supported(value, ev["quote"]):
                continue
            if isinstance(support_path, str) and support_path.startswith("identity_lock."):
                _error(
                    errors,
                    "story_bible_identity_lock_weak_lexical_anchor",
                    "identity_lock is a normalized identity attribute; provenance is valid but lexical overlap with the source wording is weak",
                    path=path, evidence_index=ei, evidence_path=f"{path}.source_evidence[{ei}]",
                    support_path=support_path, target_path=f"{path}.{support_path}", fact=value,
                    quote=ev["quote"], source_refs=list(ev.get("source_refs") or []),
                )
            elif isinstance(support_path, str) and support_path.startswith("explicit_facts["):
                _error(
                    errors,
                    "story_bible_explicit_fact_weak_lexical_anchor",
                    "explicit_fact is an optional semantic summary; provenance is valid but Runtime cannot verify the paraphrase strongly enough",
                    path=path, evidence_index=ei, evidence_path=f"{path}.source_evidence[{ei}]",
                    support_path=support_path, target_path=f"{path}.{support_path}", fact=value,
                    quote=ev["quote"], source_refs=list(ev.get("source_refs") or []),
                )
            else:
                _error(
                    errors,
                    "story_bible_fact_not_supported",
                    "declared Story Bible fact is not sufficiently anchored by its bound source evidence",
                    path=path, evidence_index=ei, evidence_path=f"{path}.source_evidence[{ei}]",
                    support_path=support_path, target_path=f"{path}.{support_path}", fact=value,
                    quote=ev["quote"], source_refs=list(ev.get("source_refs") or []),
                    repair_action=(
                        "First determine whether the current evidence only lacks adjacent context needed for ellipsis, speaker identity, coreference, or an immediately adjacent fact. "
                        "If a smallest contiguous source window fully establishes the leaf, replace/expand only this evidence item's source_refs to that window. "
                        "Do not use distant/noncontiguous evidence or other fields to stitch support together. "
                        "If no such contiguous window supports the leaf, correct/shrink or remove only the factual leaf at support_path and update supports."
                    ),
                )

    # Composite visual strings are source-bound collections of atomic visual facts.
    # Their provenance is valid when the union of locally bound evidence covers every
    # atom; no single evidence item is required to repeat the entire composite string.
    for support_path, bindings in composite_bindings.items():
        value = _value_at_support_path(item, support_path)
        atoms = _visual_atomic_facts(value)
        supported_atoms: set[str] = set()
        for _, ev in bindings:
            supported_atoms.update(_supported_visual_atoms(value, str(ev.get("quote") or "")))
        missing_atoms = [atom for atom in atoms if atom not in supported_atoms]
        if not missing_atoms:
            continue
        _error(
            errors,
            "story_bible_fact_not_supported",
            "composite visual Story Bible fact contains atomic clauses not covered by its bound local evidence set",
            path=path,
            support_path=support_path,
            target_path=f"{path}.{support_path}",
            fact=value,
            unsupported_atoms=missing_atoms,
            evidence_paths=[f"{path}.source_evidence[{ei}]" for ei, _ in bindings],
            source_refs=[
                ref for _, ev in bindings for ref in (ev.get("source_refs") or []) if isinstance(ref, str)
            ],
            repair_action=(
                "For a composite visual_lock value, preserve only atomic visual clauses supported by the union of local source evidence. "
                "Add only the smallest local evidence binding needed for an unsupported clause, or remove/shrink only that unsupported clause. "
                "Do not require one evidence item to prove unrelated clauses and do not stitch distant/noncontiguous source regions."
            ),
        )


def _flatten_lock_paths(value: Any, prefix: str) -> list[str]:
    out: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            child_prefix = f"{prefix}.{key}" if prefix else str(key)
            out.extend(_flatten_lock_paths(child, child_prefix))
    elif value not in (None, "", [], {}):
        out.append(prefix)
    return out


def _support_coverage(evidence: Any) -> set[str]:
    covered: set[str] = set()
    if isinstance(evidence, list):
        for item in evidence:
            if not isinstance(item, dict):
                continue
            for path in item.get("supports") or []:
                if isinstance(path, str) and path:
                    covered.add(path)
    return covered


def _require_fact_provenance(errors: list[dict[str, Any]], item: dict[str, Any], required_paths: list[str], *, path: str) -> None:
    covered = _support_coverage(item.get("source_evidence"))
    missing = [fact_path for fact_path in required_paths if fact_path not in covered]
    if missing:
        _error(errors, "story_bible_fact_provenance_missing", f"{path} factual leaves are missing evidence support bindings", path=path, missing_supports=missing)


def validate_story_bible_output(
    value: dict[str, Any],
    *,
    source_text: str,
    require_fact_provenance: bool = False,
    source_index: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    source_index = source_index or build_source_index(source_text)
    errors = validate_stage_shape("story_bible", value)
    if errors:
        return errors

    top_fields = output_contract()["required_top_level_fields"]
    _require_fields(errors, value, top_fields, path="$")
    _reject_extra_fields(errors, value, top_fields, path="$")
    _require_string(errors, value, "bible_id", path="$", nonempty=True)
    _require_string(errors, value, "project_id", path="$", nonempty=True)
    if value.get("version") != 1:
        _error(errors, "invalid_story_bible_version", "$.version must equal 1", field="version")

    _check_duplicate_canonical_names(errors, value.get("characters", []), entity_type="character")
    _check_duplicate_canonical_names(errors, value.get("scenes", []), entity_type="scene")
    if source_text.strip() and not (value.get("scenes") or []):
        _error(errors, "story_bible_missing_scene", "non-empty source requires at least one physical or explicitly unspecified Scene for downstream planning", path="scenes")
    _check_duplicate_canonical_names(errors, value.get("props", []), entity_type="prop")

    char_fields = output_contract()["required_character_fields"]
    seen_char: set[str] = set()
    for i, char in enumerate(value.get("characters", [])):
        p = f"characters[{i}]"
        _require_fields(errors, char, char_fields, path=p)
        _reject_extra_fields(errors, char, char_fields, path=p)
        _require_string(errors, char, "character_id", path=p, nonempty=True)
        _require_string(errors, char, "canonical_name", path=p, nonempty=True)
        _require_string_list(errors, char.get("aliases"), path=f"{p}.aliases")
        _require_string_list(errors, char.get("explicit_facts"), path=f"{p}.explicit_facts")
        _require_string_list(errors, char.get("inferred_facts"), path=f"{p}.inferred_facts")
        if char.get("role_type") not in VALID_ROLE_TYPES:
            _error(errors, "invalid_role_type", f"unsupported role_type: {char.get('role_type')}", character_id=char.get("character_id"))
        cid = char.get("character_id")
        if cid in seen_char:
            _error(errors, "duplicate_character_id", f"duplicate character id: {cid}", character_id=cid)
        seen_char.add(cid)
        visual_lock = char.get("visual_lock") or {}
        if isinstance(visual_lock, dict):
            extra = sorted(set(visual_lock) - CHARACTER_VISUAL_LOCK_FIELDS)
            if extra:
                _error(errors, "unsupported_character_visual_lock_field", f"unsupported character visual_lock fields: {extra}", character_id=cid, fields=extra)
            for field, leaf in visual_lock.items():
                if not isinstance(leaf, str):
                    _error(errors, "invalid_visual_lock_leaf", f"{p}.visual_lock.{field} must be string", path=f"{p}.visual_lock.{field}")
        _validate_evidence(errors, char.get("source_evidence"), path=f"{p}.source_evidence", source_text=source_text, source_index=source_index)
        if require_fact_provenance:
            required_paths = [f"explicit_facts[{idx}]" for idx, fact in enumerate(char.get("explicit_facts") or []) if isinstance(fact, str) and fact.strip()]
            required_paths += _flatten_lock_paths(char.get("identity_lock") or {}, "identity_lock")
            required_paths += _flatten_lock_paths(char.get("visual_lock") or {}, "visual_lock")
            _require_fact_provenance(errors, char, required_paths, path=p)
            _validate_support_semantics(errors, char, path=p)

    scene_fields = output_contract()["required_scene_fields"]
    seen_scene: set[str] = set()
    for i, scene in enumerate(value.get("scenes", [])):
        p = f"scenes[{i}]"
        _require_fields(errors, scene, scene_fields, path=p)
        _reject_extra_fields(errors, scene, scene_fields, path=p)
        _require_string(errors, scene, "scene_id", path=p, nonempty=True)
        _require_string(errors, scene, "canonical_name", path=p, nonempty=True)
        _require_string(errors, scene, "name", path=p, nonempty=True)
        _require_string(errors, scene, "time", path=p)
        _require_string(errors, scene, "weather", path=p)
        _require_string_list(errors, scene.get("explicit_facts"), path=f"{p}.explicit_facts")
        sid = scene.get("scene_id")
        if sid in seen_scene:
            _error(errors, "duplicate_scene_id", f"duplicate scene id: {sid}", scene_id=sid)
        seen_scene.add(sid)
        visual_lock = scene.get("visual_lock") or {}
        if isinstance(visual_lock, dict):
            extra = sorted(set(visual_lock) - SCENE_VISUAL_LOCK_FIELDS)
            if extra:
                _error(errors, "unsupported_scene_visual_lock_field", f"unsupported scene visual_lock fields: {extra}", scene_id=sid, fields=extra)
            for field, leaf in visual_lock.items():
                if not isinstance(leaf, str):
                    _error(errors, "invalid_visual_lock_leaf", f"{p}.visual_lock.{field} must be string", path=f"{p}.visual_lock.{field}")
        _validate_evidence(errors, scene.get("source_evidence"), path=f"{p}.source_evidence", source_text=source_text, source_index=source_index)
        if require_fact_provenance:
            required_paths = [f"explicit_facts[{idx}]" for idx, fact in enumerate(scene.get("explicit_facts") or []) if isinstance(fact, str) and fact.strip()]
            required_paths += _flatten_lock_paths(scene.get("visual_lock") or {}, "visual_lock")
            _require_fact_provenance(errors, scene, required_paths, path=p)
            _validate_support_semantics(errors, scene, path=p)

    prop_fields = output_contract()["required_prop_fields"]
    seen_prop: set[str] = set()
    for i, prop in enumerate(value.get("props", [])):
        p = f"props[{i}]"
        _require_fields(errors, prop, prop_fields, path=p)
        _reject_extra_fields(errors, prop, prop_fields, path=p)
        _require_string(errors, prop, "prop_id", path=p, nonempty=True)
        _require_string(errors, prop, "canonical_name", path=p, nonempty=True)
        _require_string(errors, prop, "name", path=p, nonempty=True)
        _require_string(errors, prop, "narrative_importance", path=p, nonempty=True)
        _require_string(errors, prop, "visual_presence", path=p, nonempty=True)
        _require_string_list(errors, prop.get("aliases"), path=f"{p}.aliases")
        _require_string_list(errors, prop.get("explicit_facts"), path=f"{p}.explicit_facts")
        if not isinstance(prop.get("visual_asset_required"), bool):
            _error(errors, "invalid_story_bible_scalar", f"{p}.visual_asset_required must be boolean", path=p, field="visual_asset_required")
        pid = prop.get("prop_id")
        if pid in seen_prop:
            _error(errors, "duplicate_prop_id", f"duplicate prop id: {pid}", prop_id=pid)
        seen_prop.add(pid)
        _validate_evidence(errors, prop.get("source_evidence"), path=f"{p}.source_evidence", source_text=source_text, source_index=source_index)
        if require_fact_provenance:
            required_paths = [f"explicit_facts[{idx}]" for idx, fact in enumerate(prop.get("explicit_facts") or []) if isinstance(fact, str) and fact.strip()]
            _require_fact_provenance(errors, prop, required_paths, path=p)
            _validate_support_semantics(errors, prop, path=p)

    context_fields = output_contract()["required_context_fields"]
    seen_context: set[str] = set()
    for i, context in enumerate(value.get("narrative_contexts", [])):
        p = f"narrative_contexts[{i}]"
        _require_fields(errors, context, context_fields, path=p)
        _reject_extra_fields(errors, context, context_fields, path=p)
        for field in ("context_id", "reality_status", "temporal_mode", "representation_mode"):
            _require_string(errors, context, field, path=p, nonempty=True)
        cid = context.get("context_id")
        if cid in seen_context:
            _error(errors, "duplicate_context_id", f"duplicate context id: {cid}", context_id=cid)
        seen_context.add(cid)
        _validate_evidence(errors, context.get("source_evidence"), path=f"{p}.source_evidence", source_text=source_text, source_index=source_index)

    return errors
