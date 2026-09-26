from __future__ import annotations

import copy
import re
from typing import Any

from runtime.value_normalization import coerce_unambiguous_bool

from runtime.source_index import build_source_index, find_refs_for_exact_quote, narrative_source_index, refs_to_span, source_index_map
from runtime.text_authority import text_is_anchored
from runtime.authority_contract import authority_manifest
from runtime.story_projection import project_story_bible


CONTRACT_VERSION = "scene_plan.v8"

SOFT_QUALITY_ERROR_TYPES = frozenset({"scene_plan_beat_low_source_overlap"})

SYSTEM_PROMPT = """你是 Prompt Foundry Runtime 2.x 的 Stage 2：Scene Planner。
你的唯一任务是依据小说原文与 canonical Story Bible，把故事按原文顺序规划成 Scene 与 Beat；不写 Script，不拆 Shot，不做 Director 或生产设计。

权责边界：
1. 模型负责：Scene 边界、Beat 边界、source_refs、location/context/character/prop 引用选择、time、continuous_with_previous、context_transition，以及 dramatic_goal/conflict/turning_point/Beat description/type 的语义规划。
2. 程序负责：scene_id、beat_id 与 resume_context_ref。不要输出这些程序字段；即使输出也会被程序覆盖。resume_context_ref 由程序按上下文栈确定性计算。
3. 只能使用 reference_manifest 中存在的 location_ref/context_ref/character_refs/prop_refs，以及 source_index 中存在的 source_ref。不得创造任何新的 ID。

结构规则：
- 一个 Scene 必须绑定一个且仅一个 physical location_ref。
- context_ref 只能是一个 context_XXX 或空字符串；不能把多个 context 拼成字符串、数组或自然语言。
- context_transition 只能 continue / enter / return / switch。第一 Scene 必须 continue；同一 context 延续用 continue；从当前 context 暂时进入另一个 narrative context 用 enter；结束临时 context 并恢复此前 context 用 return；不需要恢复此前状态的永久上下文切换用 switch。
- 剧情跨 narrative context 时必须拆 Scene，每个 Scene 只保留一个 context_ref。enter/return/switch 的 Scene 必须 continuous_with_previous=false，因为叙事上下文已经发生切换。
- scenes 与 beat_list 必须按原文叙事顺序排列；每个 Scene 至少一个 Beat。
- 每个 Scene 必须提供 source_refs，选择 source_index 中覆盖该 Scene 原文的连续 source_ref。source_refs 决定后续 Script 唯一可读取的原文范围；不得跨 Scene 借用其他段落。
- character_refs / prop_refs 是当前 Scene 实际涉及的 Story Bible refs；不要重复同一个 ref。
- 若当前 Scene.source_refs 对应原文明示对 Story Bible 已知道具的物理交互（拿取、放置、攥握、递交、倒入、打开、擦拭、食用等），该道具必须包含在当前 Scene.prop_refs；纯对白提到不算物理出现。Beat.description 只是摘要，不作为道具硬校验的事实来源。
- 若 repair_instruction.validation_errors 含 scene_plan_missing_physical_prop_ref，只允许补充指定既有 prop_ref；不得改写 Beat.description、拆并 Scene/Beat 或新增剧情来规避错误。
- 若 repair_instruction.validation_errors 含 context_switch_same_context：保留该 Scene 的 context_ref、source_refs、Scene/Beat 边界与其他合法字段，只把该 Scene.context_transition 从 switch 改为 continue。相同 context 不是 switch，不得原样返回。
- 若 repair_instruction.validation_errors 含 context_enter_same_context：保留该 Scene 的 context_ref、source_refs、Scene/Beat 边界与其他合法字段，只把该 Scene.context_transition 从 enter 改为 continue。相同 context 不是 enter，不得原样返回。
- continuous_with_previous 只表达与前一个 Scene 的时间/空间连续；第一 Scene 必须为 false。
- 每个 Beat 必须提供 source_refs，且只能引用当前 Scene.source_refs；相邻 Beat 可共享同一 source_ref，但所有 Beat.source_refs 的并集必须覆盖当前 Scene.source_refs。Beat.description 必须只概括自己 source_refs 支持的剧情单元。
- Beat.description 是结构化语义摘要，不是原文摘录。它必须忠实概括本 Beat.source_refs 的剧情单元，但允许使用与原文不同的简洁措辞；source_refs 才是下游事实权威。Beat.type 必须是非空字符串。不要自行创造新的 beat taxonomy 约束。
- 不要为了让 description 与原文词面接近而复制整段小说；不要在 description 中新增 source_refs 不支持的事件。
- 不新增剧情、对白、人物、地点、道具、关系、心理或原文不存在的事件。
- dramatic_goal/conflict/turning_point 是结构性描述；原文没有明显 conflict/turning point 时使用空字符串，不要硬编。
- 所有必填 array 必须实际输出 []，禁止 null；所有必填字段不得省略。
- 如果 user payload 含 repair_instruction：必须以 repair_instruction.invalid_output 为基底，只修 validation_errors 指向的 Scene/Beat 字段；未报错的 Scene 边界、Beat 顺序、refs 与合法语义保持不变，不得重新规划整部 Scene Plan。
- 只输出一个 JSON object，不要 markdown、解释或前后缀文本。
"""


def output_template() -> dict[str, Any]:
    return {
        "scenes": [{
            "source_refs": ["SRC0001"],
            "context_ref": "",
            "context_transition": "continue",
            "location_ref": "scene_001",
            "time": "",
            "character_refs": ["char_001"],
            "prop_refs": [],
            "continuous_with_previous": False,
            "dramatic_goal": "",
            "conflict": "",
            "turning_point": "",
            "beat_list": [{
                "source_refs": ["SRC0001"],
                "description": "",
                "type": "setup",
            }],
        }]
    }


def output_contract() -> dict[str, Any]:
    return {
        "required_top_level_fields": ["scenes"],
        "model_scene_fields": [
            "source_refs", "context_ref", "context_transition", "location_ref", "time", "character_refs", "prop_refs",
            "continuous_with_previous", "dramatic_goal", "conflict", "turning_point", "beat_list",
        ],
        "model_beat_fields": ["description", "type"],
        "optional_model_beat_fields": ["source_refs"],
        "canonical_scene_fields": [
            "scene_id", "source_refs", "source_start", "source_end", "context_ref", "context_transition", "resume_context_ref", "location_ref", "time", "character_refs", "prop_refs",
            "continuous_with_previous", "dramatic_goal", "conflict", "turning_point", "beat_list",
        ],
        "canonical_beat_fields": ["beat_id", "source_refs", "description", "type"],
        "program_owned_fields": ["scene_id", "beat_id", "resume_context_ref", "source_start", "source_end"],
        "allowed_context_transitions": ["continue", "enter", "return", "switch"],
        "reference_rule": "all refs must be exact IDs from reference_manifest",
        "context_ref_rule": "exactly one allowed context_ref or empty string",
        "context_transition_rule": "continue=same context, enter=push current and enter temporary context, return=restore stack target, switch=replace active context without restore",
        "ordering_rule": "scenes and beats remain in source narrative order; program assigns IDs by this order",
        "beat_description_authority": "semantic_summary; source_refs are factual authority; lexical overlap is advisory only",
        "prop_ref_authority": "physical prop hard-gates are derived from exact Scene source_refs text, never from Beat.description summaries",
        "authority_manifest": authority_manifest("scene_plan"),
        "null_policy": "required arrays must use []; required scalar fields must not be null",
    }


def _ids(items: Any, key: str) -> list[str]:
    if not isinstance(items, list):
        return []
    return [str(item.get(key)) for item in items if isinstance(item, dict) and item.get(key)]


def reference_manifest(story_bible: dict[str, Any]) -> dict[str, list[str]]:
    return {
        "character_refs": _ids(story_bible.get("characters"), "character_id"),
        "location_refs": _ids(story_bible.get("scenes"), "scene_id"),
        "prop_refs": _ids(story_bible.get("props"), "prop_id"),
        "context_refs": _ids(story_bible.get("narrative_contexts"), "context_id"),
    }


def build_scene_plan_payload(
    source_text: str,
    story_bible: dict[str, Any],
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
        template["scenes"][0]["source_refs"] = [first_narrative_ref]
        template["scenes"][0]["beat_list"][0]["source_refs"] = [first_narrative_ref]
    return {
        "unit_id": unit_id,
        "contract_version": CONTRACT_VERSION,
        # document_heading is audit metadata, never a Scene/Beat coverage unit.
        "source_index": model_source_index,
        "story_bible": project_story_bible(story_bible),
        "reference_manifest": reference_manifest(story_bible),
        "output_template": template,
        "output_contract": output_contract(),
    }


def _ordered_unique(values: list[Any]) -> tuple[list[Any], int]:
    out: list[Any] = []
    seen: set[Any] = set()
    changes = 0
    for value in values:
        try:
            marker = (type(value).__name__, value)
            duplicate = marker in seen
        except TypeError:
            # Shape validation will reject non-scalar refs later. Do not guess how to normalize them.
            out.append(value)
            continue
        if duplicate:
            changes += 1
            continue
        seen.add(marker)
        out.append(value)
    return out, changes


def _set(target: dict[str, Any], key: str, value: Any) -> int:
    if key in target and target.get(key) == value:
        return 0
    target[key] = value
    return 1



def _source_ref_for_offset(source_index: list[dict[str, Any]], offset: int) -> str | None:
    for item in source_index:
        if not isinstance(item, dict):
            continue
        if int(item.get("start", -1)) <= offset < int(item.get("end", -1)):
            return str(item.get("source_ref") or "") or None
    return None

def _infer_legacy_scene_source_refs(
    scenes: list[Any], source_text: str, source_index: list[dict[str, Any]], story_bible: dict[str, Any] | None = None
) -> int:
    """Migration-only source range recovery for old Scene Plan checkpoints.

    New model output must select source_refs itself. For legacy outputs we fill ranges
    only when ownership is deterministic: one Scene owns the whole source, or every
    Scene has an exact, strictly ordered Beat-description anchor in source_text.
    """
    if not scenes or not source_index:
        return 0
    missing=[x for x in scenes if isinstance(x,dict) and not (x.get("source_refs") or [])]
    if not missing:
        return 0
    all_refs=[str(x.get("source_ref")) for x in source_index if isinstance(x,dict) and x.get("source_ref")]
    if len(scenes)==1 and isinstance(scenes[0],dict):
        scenes[0]["source_refs"]=all_refs
        return 1
    anchors: list[int] = []
    for scene in scenes:
        if not isinstance(scene,dict):
            return 0
        positions=[]
        for beat in scene.get("beat_list",[]) or []:
            if not isinstance(beat,dict):
                continue
            desc=str(beat.get("description") or "").strip()
            if not desc:
                continue
            first=source_text.find(desc)
            if first >= 0 and source_text.find(desc, first+1) < 0:
                positions.append(first)
        if not positions and isinstance(story_bible, dict):
            # Legacy migration fallback: use the referenced Story-Bible location's
            # already-canonical source evidence as a deterministic anchor. New v5
            # model output must provide source_refs directly; this path exists only
            # so old checkpoints/tests do not become unrecoverable after upgrade.
            location_ref = str(scene.get("location_ref") or "")
            story_scene = next((x for x in story_bible.get("scenes", []) or []
                                if isinstance(x, dict) and str(x.get("scene_id") or "") == location_ref), None)
            if story_scene:
                for ev in story_scene.get("source_evidence", []) or []:
                    if isinstance(ev, dict) and isinstance(ev.get("source_start"), int):
                        positions.append(int(ev["source_start"]))
                        break
        if not positions:
            return 0
        anchors.append(min(positions))
    if anchors != sorted(anchors) or len(set(anchors)) != len(anchors):
        return 0
    ref_positions=[]
    ref_index={str(item.get("source_ref")):i for i,item in enumerate(source_index) if isinstance(item,dict)}
    for offset in anchors:
        ref=_source_ref_for_offset(source_index,offset)
        if not ref or ref not in ref_index:
            return 0
        ref_positions.append(ref_index[ref])
    if ref_positions != sorted(ref_positions) or len(set(ref_positions)) != len(ref_positions):
        return 0
    changes=0
    for i,scene in enumerate(scenes):
        if scene.get("source_refs"):
            continue
        start=0 if i==0 else ref_positions[i]
        end=(ref_positions[i+1] if i+1 < len(scenes) else len(all_refs))
        if start >= end:
            return 0
        scene["source_refs"]=all_refs[start:end]
        changes += 1
    return changes

def _infer_legacy_beat_source_refs(scene: dict[str, Any], source_text: str, source_index: list[dict[str, Any]]) -> int:
    """Migration-only Beat provenance recovery when exact ownership is deterministic."""
    beats = scene.get("beat_list")
    scene_refs = [str(x) for x in (scene.get("source_refs") or []) if isinstance(x, str)]
    if not isinstance(beats, list) or not beats or not scene_refs:
        return 0
    changes = 0
    # A one-Beat Scene necessarily owns the Scene source range.
    if len(beats) == 1 and isinstance(beats[0], dict) and not beats[0].get("source_refs"):
        beats[0]["source_refs"] = list(scene_refs)
        return 1
    for beat in beats:
        if not isinstance(beat, dict) or beat.get("source_refs"):
            continue
        desc = str(beat.get("description") or "").strip()
        if not desc:
            continue
        refs = [ref for ref in find_refs_for_exact_quote(source_text, source_index, desc) if ref in scene_refs]
        if refs:
            beat["source_refs"] = refs
            changes += 1
    return changes


def canonicalize_scene_plan(candidate: dict[str, Any], *, source_text: str = "", source_index: list[dict[str, Any]] | None = None, story_bible: dict[str, Any] | None = None) -> tuple[dict[str, Any], int]:
    """Own only mechanical Scene/Beat IDs and exact duplicate refs.

    Semantic fields, scene boundaries, beat boundaries and reference selection remain model-owned.
    """
    out = copy.deepcopy(candidate)
    changes = 0
    scenes = out.get("scenes")
    if not isinstance(scenes, list):
        return out, changes

    if source_text:
        index = narrative_source_index(source_index or build_source_index(source_text))
        changes += _infer_legacy_scene_source_refs(scenes, source_text, index, story_bible)
    beat_index = 1
    active_context = ""
    context_stack: list[str] = []
    for scene_index, scene in enumerate(scenes, 1):
        if not isinstance(scene, dict):
            continue
        changes += _set(scene, "scene_id", f"SC{scene_index:03d}")
        if "continuous_with_previous" in scene:
            normalized_bool, bool_changed = coerce_unambiguous_bool(scene.get("continuous_with_previous"))
            if normalized_bool is not None and (
                type(scene.get("continuous_with_previous")) is not bool
                or scene.get("continuous_with_previous") != normalized_bool
            ):
                scene["continuous_with_previous"] = normalized_bool
            if bool_changed:
                changes += 1
        for field in ("character_refs", "prop_refs"):
            values = scene.get(field)
            if isinstance(values, list):
                normalized, count = _ordered_unique(values)
                if count:
                    scene[field] = normalized
                    changes += count
        if source_text and isinstance(scene.get("source_refs"), list):
            index = narrative_source_index(source_index or build_source_index(source_text))
            span = refs_to_span(source_text, index, [str(x) for x in scene.get("source_refs") or [] if isinstance(x, str)])
            if span:
                changes += _set(scene, "source_start", int(span["source_start"]))
                changes += _set(scene, "source_end", int(span["source_end"]))
            changes += _infer_legacy_beat_source_refs(scene, source_text, index)
        context_ref = str(scene.get("context_ref") or "")
        transition = str(scene.get("context_transition") or "")
        if scene_index == 1:
            changes += _set(scene, "continuous_with_previous", False)
            active_context = context_ref
            changes += _set(scene, "resume_context_ref", "")
        elif transition == "enter":
            context_stack.append(active_context)
            changes += _set(scene, "resume_context_ref", active_context)
            active_context = context_ref
        elif transition == "return":
            expected = context_stack.pop() if context_stack else ""
            changes += _set(scene, "resume_context_ref", expected)
            active_context = context_ref
        elif transition == "switch":
            changes += _set(scene, "resume_context_ref", "")
            context_stack.clear()
            active_context = context_ref
        else:
            changes += _set(scene, "resume_context_ref", "")
            active_context = context_ref
        beats = scene.get("beat_list")
        if not isinstance(beats, list):
            continue
        for beat in beats:
            if not isinstance(beat, dict):
                continue
            changes += _set(beat, "beat_id", f"B{beat_index:03d}")
            beat_index += 1
    return out, changes


def _error(errors: list[dict[str, Any]], etype: str, detail: str, **context: Any) -> None:
    item: dict[str, Any] = {"type": etype, "detail": detail}
    item.update(context)
    errors.append(item)


def _require_fields(errors: list[dict[str, Any]], item: dict[str, Any], fields: list[str], *, path: str) -> None:
    for field in fields:
        if field not in item:
            _error(errors, "missing_scene_plan_field", f"{path}.{field} is required", path=path, field=field)


def _string(errors: list[dict[str, Any]], item: dict[str, Any], field: str, *, path: str, nonempty: bool = False) -> None:
    value = item.get(field)
    if not isinstance(value, str):
        _error(errors, "invalid_scene_plan_scalar", f"{path}.{field} must be string", path=path, field=field)
    elif nonempty and not value.strip():
        _error(errors, "invalid_scene_plan_scalar", f"{path}.{field} must be nonempty string", path=path, field=field)


def _string_list(errors: list[dict[str, Any]], value: Any, *, path: str) -> None:
    if not isinstance(value, list):
        _error(errors, "shape_type_mismatch", f"{path} must be JSON array", path=path, expected="JSON array", actual_type=type(value).__name__)
        return
    for idx, item in enumerate(value):
        if not isinstance(item, str):
            _error(errors, "shape_type_mismatch", f"{path}[{idx}] must be string", path=f"{path}[{idx}]", expected="string", actual_type=type(item).__name__)


def _looks_like_multiple_contexts(value: Any) -> bool:
    if isinstance(value, (list, tuple, set, dict)):
        return True
    if not isinstance(value, str):
        return bool(value)
    text = value.strip()
    if not text:
        return False
    tokens = re.findall(r"context_\d+", text)
    return len(tokens) > 1 or any(sep in text for sep in [",", "，", "/", "、", ";", "；"])


_PHYSICAL_PROP_TOKENS = (
    "端着", "拿着", "拿起", "放下", "放在", "放进", "放到", "攥着", "攥在", "捂着",
    "翻出", "递给", "递出", "夹", "倒", "流进", "打开", "擦", "收起", "盖上", "关上",
    "吃", "咬", "盛", "被放", "握着", "抓着",
)
_QUOTED_TEXT_RE = re.compile(r"[‘’“”\"'].*?[‘’“”\"']")
_NEGATION_TOKENS = ("没有", "并未", "未曾", "不曾", "未", "不")


def _story_prop_names(prop: dict[str, Any]) -> list[str]:
    values = [prop.get("canonical_name") or prop.get("name"), *((prop.get("aliases") or []))]
    return [str(x).strip() for x in values if isinstance(x, str) and x.strip()]


def _verb_is_negated(text: str, verb_pos: int) -> bool:
    prefix = text[max(0, verb_pos - 10):verb_pos]
    return any(token in prefix for token in _NEGATION_TOKENS)


def _text_physically_mentions_prop(text: str, names: list[str]) -> bool:
    if not text:
        return False
    # Quoted dialogue is context, not proof that the prop is physically present.
    text = _QUOTED_TEXT_RE.sub("", text)
    for name in names:
        start = text.find(name)
        while start >= 0:
            left = max(0, start - 12)
            right = min(len(text), start + len(name) + 12)
            window = text[left:right]
            name_pos = start - left
            for token in _PHYSICAL_PROP_TOKENS:
                search = 0
                while True:
                    pos = window.find(token, search)
                    if pos < 0:
                        break
                    if abs(pos - name_pos) <= 10 and not _verb_is_negated(window, pos):
                        return True
                    search = pos + max(1, len(token))
            start = text.find(name, start + len(name))
    return False


def _required_physical_prop_refs(story_bible: dict[str, Any], source_authority_text: str) -> set[str]:
    """Derive required physical props only from exact source authority.

    Beat.description is a semantic summary and must never become the factual input of a
    hard gate. The runtime can objectively require a prop ref only when the Scene's
    exact source window itself names the Story Bible prop near a physical interaction.
    """
    required: set[str] = set()
    if not isinstance(source_authority_text, str) or not source_authority_text:
        return required
    for prop in story_bible.get("props", []) or []:
        if not isinstance(prop, dict) or not prop.get("prop_id"):
            continue
        names = _story_prop_names(prop)
        if names and _text_physically_mentions_prop(source_authority_text, names):
            required.add(str(prop["prop_id"]))
    return required


def validate_scene_plan_output(
    story_bible: dict[str, Any],
    value: Any,
    *,
    source_text: str = "",
    require_beat_provenance: bool = False,
    source_index: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    if not isinstance(value, dict):
        return [{"type": "shape_type_mismatch", "path": "$", "detail": "scene plan must be JSON object", "expected": "JSON object", "actual_type": type(value).__name__}]
    if "scenes" not in value:
        _error(errors, "missing_scene_plan_field", "$.scenes is required", path="$", field="scenes")
        return errors
    scenes = value.get("scenes")
    if not isinstance(scenes, list):
        _error(errors, "shape_type_mismatch", "scenes must be JSON array", path="scenes", expected="JSON array", actual_type=type(scenes).__name__)
        return errors
    if not scenes:
        _error(errors, "empty_scene_plan", "scene plan requires at least one scene", path="scenes")
        return errors

    manifest = reference_manifest(story_bible)
    source_index = (source_index or build_source_index(source_text)) if source_text else []
    source_index = narrative_source_index(source_index)
    allowed_source_refs = set(source_index_map(source_index))
    allowed_chars = set(manifest["character_refs"])
    allowed_locations = set(manifest["location_refs"])
    allowed_props = set(manifest["prop_refs"])
    allowed_contexts = set(manifest["context_refs"])

    scene_fields = output_contract()["canonical_scene_fields"]
    beat_fields = output_contract()["canonical_beat_fields"]

    extra_top = sorted(set(value) - {"scenes"})
    for field in extra_top:
        _error(errors, "extra_scene_plan_field", f"$.{field} is not part of canonical Scene Plan", path=f"$.{field}", field=field)

    expected_beat_index = 1
    active_context = ""
    context_stack: list[str] = []

    for si, scene in enumerate(scenes):
        path = f"scenes[{si}]"
        if not isinstance(scene, dict):
            _error(errors, "shape_type_mismatch", f"{path} must be JSON object", path=path, expected="JSON object", actual_type=type(scene).__name__)
            continue
        required_scene_fields = [f for f in scene_fields if f not in {"source_refs", "source_start", "source_end"}]
        if source_text:
            required_scene_fields.append("source_refs")
        _require_fields(errors, scene, required_scene_fields, path=path)
        for field in sorted(set(scene) - set(scene_fields)):
            _error(errors, "extra_scene_plan_field", f"{path}.{field} is not part of canonical Scene", path=f"{path}.{field}", field=field)
        _string(errors, scene, "scene_id", path=path, nonempty=True)
        _string(errors, scene, "context_ref", path=path)
        _string(errors, scene, "context_transition", path=path, nonempty=True)
        _string(errors, scene, "resume_context_ref", path=path)
        _string(errors, scene, "location_ref", path=path, nonempty=True)
        _string(errors, scene, "time", path=path)
        _string(errors, scene, "dramatic_goal", path=path)
        _string(errors, scene, "conflict", path=path)
        _string(errors, scene, "turning_point", path=path)
        if source_text:
            refs = scene.get("source_refs")
            _string_list(errors, refs, path=f"{path}.source_refs")
            if isinstance(refs, list):
                if not refs:
                    _error(errors, "missing_scene_source_refs", f"{path}.source_refs must not be empty", scene_id=scene.get("scene_id"))
                for ref in refs:
                    if isinstance(ref, str) and ref not in allowed_source_refs:
                        _error(errors, "unknown_scene_source_ref", f"unknown source_ref: {ref}", scene_id=scene.get("scene_id"), source_ref=ref)
                positions = [int(ref[3:]) for ref in refs if isinstance(ref, str) and ref.startswith("SRC") and ref[3:].isdigit()]
                if positions and positions != sorted(positions):
                    _error(errors, "scene_source_order_mismatch", "source_refs must remain in source order", scene_id=scene.get("scene_id"))
                if positions and any(b-a != 1 for a,b in zip(positions, positions[1:])):
                    _error(errors, "scene_source_refs_not_contiguous", "source_refs for one Scene must be contiguous", scene_id=scene.get("scene_id"))
            span = refs_to_span(source_text, source_index, refs if isinstance(refs, list) else [])
            if span and (scene.get("source_start") != span["source_start"] or scene.get("source_end") != span["source_end"]):
                _error(errors, "scene_source_span_mismatch", "program-owned source_start/source_end do not match source_refs", scene_id=scene.get("scene_id"))
        if not isinstance(scene.get("continuous_with_previous"), bool):
            _error(errors, "invalid_scene_plan_scalar", f"{path}.continuous_with_previous must be boolean", path=path, field="continuous_with_previous")
        elif si == 0 and scene.get("continuous_with_previous") is not False:
            _error(errors, "invalid_first_scene_continuity", "first scene continuous_with_previous must be false", scene_id=scene.get("scene_id"))

        _string_list(errors, scene.get("character_refs"), path=f"{path}.character_refs")
        _string_list(errors, scene.get("prop_refs"), path=f"{path}.prop_refs")

        location_ref = scene.get("location_ref")
        if isinstance(location_ref, str) and location_ref not in allowed_locations:
            _error(errors, "unknown_location_ref", f"unknown location_ref: {location_ref}", scene_id=scene.get("scene_id"))
        context_ref = scene.get("context_ref")
        if _looks_like_multiple_contexts(context_ref):
            _error(errors, "multiple_context_refs", f"context_ref must contain exactly one context id or empty string: {context_ref}", scene_id=scene.get("scene_id"))
        elif isinstance(context_ref, str) and context_ref and context_ref not in allowed_contexts:
            _error(errors, "unknown_context_ref", f"unknown context_ref: {context_ref}", scene_id=scene.get("scene_id"))

        transition = scene.get("context_transition")
        if transition not in {"continue", "enter", "return", "switch"}:
            _error(errors, "invalid_context_transition", f"unsupported context_transition: {transition}", scene_id=scene.get("scene_id"))
        elif si == 0:
            if transition != "continue":
                _error(errors, "invalid_first_context_transition", "first Scene context_transition must be continue", scene_id=scene.get("scene_id"))
            active_context = str(context_ref or "")
            if scene.get("resume_context_ref") != "":
                _error(errors, "invalid_resume_context_ref", "first Scene resume_context_ref must be empty", scene_id=scene.get("scene_id"))
        elif transition == "continue":
            if str(context_ref or "") != active_context:
                _error(errors, "context_continue_mismatch", f"continue must keep active context {active_context!r}, got {context_ref!r}", scene_id=scene.get("scene_id"))
            if scene.get("resume_context_ref") != "":
                _error(errors, "invalid_resume_context_ref", "continue resume_context_ref must be empty", scene_id=scene.get("scene_id"))
        elif transition == "enter":
            if str(context_ref or "") == active_context:
                _error(
                    errors,
                    "context_enter_same_context",
                    "enter must change to a different context",
                    scene_id=scene.get("scene_id"),
                    path=f"{path}.context_transition",
                    target_path=f"{path}.context_transition",
                    active_context=active_context,
                    context_ref=str(context_ref or ""),
                    repair_action="change_same_context_enter_to_continue",
                    allowed_repair_values=["continue"],
                )
            expected_resume = active_context
            if scene.get("resume_context_ref") != expected_resume:
                _error(errors, "invalid_resume_context_ref", f"enter resume_context_ref must equal previous active context {expected_resume!r}", scene_id=scene.get("scene_id"))
            context_stack.append(active_context)
            active_context = str(context_ref or "")
        elif transition == "return":
            if not context_stack:
                _error(errors, "context_return_without_entry", "return requires a previously entered context", scene_id=scene.get("scene_id"))
                expected_resume = ""
            else:
                expected_resume = context_stack.pop()
            if str(context_ref or "") != expected_resume:
                _error(errors, "context_return_target_mismatch", f"return must restore context {expected_resume!r}, got {context_ref!r}", scene_id=scene.get("scene_id"))
            if scene.get("resume_context_ref") != expected_resume:
                _error(errors, "invalid_resume_context_ref", f"return resume_context_ref must equal restored context {expected_resume!r}", scene_id=scene.get("scene_id"))
            active_context = str(context_ref or "")
        elif transition == "switch":
            if str(context_ref or "") == active_context:
                _error(
                    errors,
                    "context_switch_same_context",
                    "switch must change to a different context",
                    scene_id=scene.get("scene_id"),
                    path=f"{path}.context_transition",
                    target_path=f"{path}.context_transition",
                    active_context=active_context,
                    context_ref=str(context_ref or ""),
                    repair_action="change_same_context_switch_to_continue",
                    allowed_repair_values=["continue"],
                )
            if scene.get("resume_context_ref") != "":
                _error(errors, "invalid_resume_context_ref", "switch resume_context_ref must be empty", scene_id=scene.get("scene_id"))
            context_stack.clear()
            active_context = str(context_ref or "")

        if transition in {"enter", "return", "switch"} and scene.get("continuous_with_previous") is not False:
            _error(errors, "context_transition_requires_discontinuity", "context transition Scene must set continuous_with_previous=false", scene_id=scene.get("scene_id"))

        if isinstance(scene.get("character_refs"), list):
            for ref in scene["character_refs"]:
                if isinstance(ref, str) and ref not in allowed_chars:
                    _error(errors, "unknown_character_ref", f"unknown character_ref: {ref}", scene_id=scene.get("scene_id"))
        if isinstance(scene.get("prop_refs"), list):
            for ref in scene["prop_refs"]:
                if isinstance(ref, str) and ref not in allowed_props:
                    _error(errors, "unknown_prop_ref", f"unknown prop_ref: {ref}", scene_id=scene.get("scene_id"))

        beats = scene.get("beat_list")
        if not isinstance(beats, list):
            _error(errors, "shape_type_mismatch", f"{path}.beat_list must be JSON array", path=f"{path}.beat_list", expected="JSON array", actual_type=type(beats).__name__)
            continue
        if not beats:
            _error(errors, "empty_scene_plan_beats", f"{path}.beat_list requires at least one Beat", scene_id=scene.get("scene_id"))
            continue
        for bi, beat in enumerate(beats):
            bp = f"{path}.beat_list[{bi}]"
            if not isinstance(beat, dict):
                _error(errors, "shape_type_mismatch", f"{bp} must be JSON object", path=bp, expected="JSON object", actual_type=type(beat).__name__)
                continue
            required_beat_fields = beat_fields if require_beat_provenance else [f for f in beat_fields if f != "source_refs"]
            _require_fields(errors, beat, required_beat_fields, path=bp)
            allowed_beat_fields = set(beat_fields) | set(output_contract().get("optional_model_beat_fields") or []) | {"beat_id"}
            for field in sorted(set(beat) - allowed_beat_fields):
                _error(errors, "extra_scene_plan_field", f"{bp}.{field} is not part of canonical Beat", path=f"{bp}.{field}", field=field)
            _string(errors, beat, "beat_id", path=bp, nonempty=True)
            _string(errors, beat, "description", path=bp, nonempty=True)
            _string(errors, beat, "type", path=bp, nonempty=True)
            if require_beat_provenance:
                beat_refs = beat.get("source_refs")
                scene_refs = set(scene.get("source_refs") or [])
                if not isinstance(beat_refs, list) or not beat_refs or not all(isinstance(x, str) and x for x in beat_refs):
                    _error(errors, "scene_plan_beat_source_refs_missing", "each Beat requires non-empty source_refs", path=f"{bp}.source_refs")
                else:
                    outside = [ref for ref in beat_refs if ref not in scene_refs]
                    if outside:
                        _error(errors, "scene_plan_beat_source_ref_outside_scene", "Beat source_refs must be a subset of current Scene source_refs", path=f"{bp}.source_refs", source_refs=outside)
                    elif source_text:
                        positions = [int(ref[3:]) for ref in beat_refs if isinstance(ref, str) and ref.startswith("SRC") and ref[3:].isdigit()]
                        if positions and positions != sorted(positions):
                            _error(errors, "scene_plan_beat_source_order_mismatch", "Beat source_refs must remain in source order", path=f"{bp}.source_refs", source_refs=beat_refs)
                        if positions and any(b - a != 1 for a, b in zip(positions, positions[1:])):
                            _error(errors, "scene_plan_beat_source_refs_not_contiguous", "Beat source_refs must form one contiguous source window", path=f"{bp}.source_refs", source_refs=beat_refs)
                        beat_span = refs_to_span(source_text, source_index, beat_refs)
                        authority_text = str((beat_span or {}).get("source_text") or "")
                        # Beat.description is a semantic planning label, not an extractive quote.
                        # Lexical similarity is only a quality signal; factual authority is the
                        # validated contiguous Beat.source_refs window consumed by Script.
                        if authority_text and not text_is_anchored(beat.get("description"), [authority_text]):
                            _error(errors, "scene_plan_beat_low_source_overlap", "Beat description has low lexical overlap with its source window; source_refs remain the factual authority", path=f"{bp}.description", source_refs=beat_refs)
            expected_bid = f"B{expected_beat_index:03d}"
            if beat.get("beat_id") != expected_bid:
                _error(errors, "noncanonical_beat_id", f"expected {expected_bid}, got {beat.get('beat_id')}", scene_id=scene.get("scene_id"), beat_id=beat.get("beat_id"))
            expected_beat_index += 1

        if require_beat_provenance and isinstance(beats, list):
            scene_refs = [ref for ref in (scene.get("source_refs") or []) if isinstance(ref, str)]
            beat_union: set[str] = set()
            for beat in beats:
                if isinstance(beat, dict) and isinstance(beat.get("source_refs"), list):
                    beat_union.update(ref for ref in beat.get("source_refs") if isinstance(ref, str))
            missing_beat_refs = [ref for ref in scene_refs if ref not in beat_union]
            if missing_beat_refs:
                _error(errors, "scene_plan_beat_source_coverage_gap", "Beat source_refs do not cover the full Scene source range", scene_id=scene.get("scene_id"), missing_source_refs=missing_beat_refs)

        if isinstance(scene.get("prop_refs"), list):
            current_prop_refs = {ref for ref in scene.get("prop_refs", []) if isinstance(ref, str)}
            scene_authority_text = ""
            if source_text:
                scene_refs = [str(x) for x in (scene.get("source_refs") or []) if isinstance(x, str)]
                scene_span = refs_to_span(source_text, source_index, scene_refs) if scene_refs else None
                scene_authority_text = str((scene_span or {}).get("source_text") or "")
            required_physical_props = _required_physical_prop_refs(story_bible, scene_authority_text)
            for ref in sorted(required_physical_props - current_prop_refs):
                _error(
                    errors,
                    "scene_plan_missing_physical_prop_ref",
                    f"Current Scene source physically handles Story Bible prop {ref}, but scene.prop_refs omits it",
                    scene_id=scene.get("scene_id"),
                    path=f"{path}.prop_refs",
                    prop_ref=ref,
                )

        expected_sid = f"SC{si + 1:03d}"
        if scene.get("scene_id") != expected_sid:
            _error(errors, "noncanonical_scene_id", f"expected {expected_sid}, got {scene.get('scene_id')}", scene_id=scene.get("scene_id"))

    if source_text:
        # Every indexed source unit must belong to exactly one Scene. This is a story
        # completeness hard gate; scene boundaries remain model-owned, coverage does not.
        expected_refs = [str(x.get("source_ref")) for x in source_index if isinstance(x, dict) and x.get("source_ref")]
        actual_refs = [
            str(ref)
            for scene in scenes if isinstance(scene, dict)
            for ref in (scene.get("source_refs", []) or [])
            if isinstance(ref, str)
        ]
        missing_refs = [ref for ref in expected_refs if ref not in actual_refs]
        duplicate_refs = sorted({ref for ref in actual_refs if actual_refs.count(ref) > 1})
        if missing_refs:
            _error(errors, "scene_source_coverage_gap", "Scene Plan does not cover all source units", missing_source_refs=missing_refs)
        if duplicate_refs:
            _error(errors, "scene_source_coverage_duplicate", "A source unit is assigned to more than one Scene", duplicate_source_refs=duplicate_refs)
        if actual_refs and [ref for ref in actual_refs if ref in allowed_source_refs] != expected_refs:
            _error(errors, "scene_source_global_order_mismatch", "Scene source_refs must cover the source exactly once in narrative order")
        last_end = -1
        for scene in scenes:
            if not isinstance(scene, dict) or not isinstance(scene.get("source_start"), int) or not isinstance(scene.get("source_end"), int):
                continue
            if scene["source_start"] < last_end:
                _error(errors, "scene_source_overlap", "Scene source spans must be ordered and non-overlapping", scene_id=scene.get("scene_id"))
            last_end = max(last_end, scene["source_end"])
    return errors
