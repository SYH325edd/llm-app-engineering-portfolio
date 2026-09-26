from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any, Iterable

LINT_VERSION = "consumption_lint_v1"

ERROR_LABELS = {
    "E001_ENTITY_MISBIND": "实体错绑",
    "E002_CHAR_REF_MISMATCH": "人物引用不一致",
    "E003_SPATIOTEMPORAL_POLLUTION": "时空 / 跨镜污染",
    "E004_HARD_FACT_CONFLICT": "硬事实冲突",
    "E005_DIALOGUE_SPEAKER_MISMATCH": "对白说话人不一致",
    "E006_UNRESOLVABLE_PROP_STATE": "关键道具状态无法解析",
    "E007_NON_CHINESE_OUTPUT": "最终提示词存在非中文文本",
}

WARNING_LABELS = {
    "W001_MISSING_COLOR": "配色信息缺失",
    "W002_MISSING_LIGHTING": "光照信息缺失",
    "W003_DURATION_RISK": "时长风险",
    "W004_STYLE_PSB_DRIFT": "全局风格与场景视觉资产漂移",
    "W005_PROMPT_LENGTH_HIGH": "提示词偏长",
    "W006_VISUAL_FOCUS_CONFLICT": "视觉重点与景别潜在冲突",
    "W007_STYLE_HARD_FACT_DRIFT": "全局风格与硬事实漂移",
    "W008_TIME_INCONSISTENCY": "场景时间语义不一致",
    "W009_CONTINUITY_BUDGET_HIGH": "连续性信息预算偏高",
    "W010_ACTION_AMBIGUOUS_SUBJECT": "动作主体代词存在歧义",
    "W011_NON_CHINESE_ASSET_FIELD": "资产字段存在非中文文本",
    "W012_PERFORMANCE_TOO_ABSTRACT": "表演解释过于抽象或缺少权威依据",
    "W013_ACTION_TRANSITION_MISSING": "复杂动作缺少明确转换",
    "W014_PERFORMANCE_DENSITY_MISMATCH": "表演密度与镜头需求不匹配",
    "W015_PERFORMANCE_BUDGET_HIGH": "导演表演信息预算偏高",
}

_QUOTED_TEXT_RE = re.compile(r'[‘’“”"\'].*?[‘’“”"\']')


def _norm(value: Any) -> str:
    text = str(value or "").lower()
    text = re.sub(r"[\s\u3000，。！？；：、“”‘’（）()\[\]{}<>《》,.!?;:'\"`~_-]+", "", text)
    return text


def _flatten_strings(value: Any) -> list[str]:
    out: list[str] = []
    if isinstance(value, dict):
        for item in value.values():
            out.extend(_flatten_strings(item))
    elif isinstance(value, list):
        for item in value:
            out.extend(_flatten_strings(item))
    elif value not in (None, "", False):
        out.append(str(value))
    return out


def text_related(a: Any, b: Any, *, threshold: float = 0.52) -> bool:
    na, nb = _norm(a), _norm(b)
    if not na or not nb:
        return False
    if na in nb or nb in na:
        return True
    # Very short strings are too noisy for fuzzy matching.
    if min(len(na), len(nb)) < 4:
        return False
    return SequenceMatcher(None, na, nb).ratio() >= threshold




def _source_layer_label(source_layer: str) -> str:
    labels = {
        "Storyboard Base": "基础分镜",
        "Director": "导演执行",
        "ShotSpec": "镜头规格",
        "ShotSpec / Director": "镜头规格 / 导演执行",
        "Story Bible / PSB": "故事设定 / 场景视觉资产",
        "Style Guide": "全局视觉风格",
        "Consumption Compiler": "消费编译器",
    }
    return labels.get(source_layer, "上游数据")

def _suggested_fix(code: str, source_layer: str) -> str:
    if code == "E001_ENTITY_MISBIND":
        if "Director" in source_layer:
            return "回到导演执行，检查本镜 action_delta / state_out 是否把道具写成了另一种实体。"
        return "回到基础分镜，检查当前镜头 prop_refs 是否与画面中实际被拿取、操作或使用的道具一致。"
    if code in {"E002_CHAR_REF_MISMATCH", "E003_SPATIOTEMPORAL_POLLUTION", "E005_DIALOGUE_SPEAKER_MISMATCH"}:
        return "回到导演执行，只保留当前镜头有直接证据支持的人物、动作和说话人；删除相邻镜头或无证据内容。"
    if code == "E004_HARD_FACT_CONFLICT":
        return "回到错误来源层核对硬事实；不要在消费编译器中覆盖或猜测冲突值。"
    if code == "E006_UNRESOLVABLE_PROP_STATE":
        return "回到基础分镜 / 状态解析，补齐当前关键道具的明确状态与引用后重新编译。"
    if code == "E007_NON_CHINESE_OUTPUT":
        if "Director" in source_layer:
            return "回到导演执行，把 performance_actions.action 修复为简体中文；不得在最终提示词中保留英文 fallback。"
        if "Storyboard" in source_layer or "ShotSpec" in source_layer:
            return "回到基础分镜，把 composition / description 修复为简体中文后重新进入导演执行与编译。"
        return "检查该来源字段，补齐中文表达后重新编译；消费层不会直接输出英文。"
    return ""


def _issue(code: str, detail: str, *, source_layer: str, source_ref: str = "") -> dict[str, Any]:
    labels = ERROR_LABELS if code.startswith("E") else WARNING_LABELS
    out = {
        "code": code,
        "label": labels.get(code, code),
        "detail": detail,
        "source_layer": source_layer,
        "source_layer_label": _source_layer_label(source_layer),
        "source_ref": source_ref,
    }
    if code.startswith("E"):
        suggested = _suggested_fix(code, source_layer)
        if suggested:
            out["suggested_fix"] = suggested
    return out


def estimate_min_duration(shot: dict[str, Any]) -> float:
    """Conservative deterministic risk estimate, not a physical truth."""
    dialogue = shot.get("dialogue") or []
    chars = 0
    punctuation_cost = 0.0
    speaker_switches = 0
    previous_speaker: str | None = None
    for item in dialogue:
        if not isinstance(item, dict):
            continue
        line = str(item.get("line") or item.get("text") or "")
        chars += len(re.findall(r"[\u4e00-\u9fffA-Za-z0-9]", line))
        punctuation_cost += 0.15 * len(re.findall(r"[，、,]", line))
        punctuation_cost += 0.35 * len(re.findall(r"[。！？!?]", line))
        speaker = str(item.get("character_id") or "")
        if previous_speaker is not None and speaker and speaker != previous_speaker:
            speaker_switches += 1
        if speaker:
            previous_speaker = speaker

    dialogue_time = chars / 4.5 if chars else 0.0
    dialogue_time += punctuation_cost + speaker_switches * 0.25

    action_time = 0.0
    for action in (shot.get("director") or {}).get("performance_actions", []) or []:
        if not isinstance(action, dict):
            continue
        text = str(action.get("action") or "")
        # Pure speaking is accounted for by dialogue; visible emotion/reaction still costs time.
        if any(token in text for token in ("走", "来到", "走到", "起身", "转身", "进门", "推门", "离开", "后退", "靠近")):
            action_time += 1.5
        elif any(token in text for token in ("拿", "放", "递", "夹", "倒", "端", "拉", "扯", "按", "打开", "关上", "收下", "找零")):
            action_time += 0.7
        elif any(token in text for token in ("微笑", "摇头", "点头", "抬眼", "看向", "停", "皱眉")):
            action_time += 0.5
        elif not any(token in text for token in ("说话", "说", "对白")):
            action_time += 0.5

    movement_cost = {
        "static": 0.0,
        "push_in": 0.6,
        "pull_out": 0.6,
        "pan": 0.7,
        "tilt": 0.7,
        "zoom": 0.7,
        "dolly": 0.9,
        "truck": 0.9,
        "handheld": 0.6,
        "crane": 1.0,
    }.get(str(shot.get("movement") or ""), 0.0)

    return round((dialogue_time + action_time + movement_cost) * 1.2, 2)


def _shot_support_texts(shot: dict[str, Any]) -> list[str]:
    values: list[str] = []
    description = str(shot.get("description") or "")
    if description:
        values.append(description)
        # Director evidence is often a clause copied from a longer Shot description.
        # Keep clauses as independent support units so harmless conjunction changes
        # (e.g. “收下并找了零” vs “收下，找了零”) do not look cross-shot.
        values.extend(x.strip() for x in re.split(r"[；。！？!?]", description) if x.strip())
    values.extend(str(x.get("quote") or "") for x in shot.get("source_evidence", []) or [] if isinstance(x, dict))
    values.extend(str(x.get("line") or x.get("text") or "") for x in shot.get("dialogue", []) or [] if isinstance(x, dict))
    return [x for x in values if x]


def _semantic_state_text(value: Any) -> str:
    text = str(value or "")
    if not text or re.search(r"[A-Za-z_]", text):
        return ""
    text = re.sub(r"(?:继续|仍然|仍旧|依旧|正在|还在|仍|着|了|已经|轻轻|微微|带)", "", text)
    return _norm(text)


def _semantic_state_match(action_text: str, state_text: str) -> bool:
    action = _semantic_state_text(action_text)
    state = _semantic_state_text(state_text)
    if not action or not state:
        return False
    if action in state or state in action:
        return True
    if min(len(action), len(state)) >= 2 and SequenceMatcher(None, action, state).ratio() >= 0.6:
        return True
    return False


def _held_prop_refs_for_character(shot: dict[str, Any], cid: str) -> set[str]:
    state_in = shot.get("state_in") or {}
    refs: set[str] = set()
    cstate = ((state_in.get("characters") or {}).get(cid) or {})
    direct = cstate.get("held_prop_refs")
    if isinstance(direct, list):
        refs.update(str(x) for x in direct if x)
    elif isinstance(direct, str) and direct:
        refs.add(direct)
    single = cstate.get("prop_in_hand")
    if isinstance(single, str) and single and single != "无":
        refs.add(single)
    for pid, pstate in (state_in.get("props") or {}).items():
        if isinstance(pstate, dict) and str(pstate.get("held_by") or "") == cid:
            refs.add(str(pid))
    return refs


def _prop_terms(story_bible: dict[str, Any], prop_ids: set[str]) -> list[str]:
    out: list[str] = []
    for prop in story_bible.get("props", []) or []:
        if str(prop.get("prop_id") or "") not in prop_ids:
            continue
        name = str(prop.get("canonical_name") or prop.get("name") or "")
        if name:
            out.append(name)
        out.extend(str(x) for x in prop.get("aliases", []) or [] if isinstance(x, str) and x)
    return out


def _action_supported_by_state(action: dict[str, Any], shot: dict[str, Any], story_bible: dict[str, Any]) -> bool:
    cid = str(action.get("character_ref") or "")
    state_in = shot.get("state_in") or {}
    character_state = ((state_in.get("characters") or {}).get(cid) or {}) if cid else {}
    action_texts = [str(action.get("action") or "")]
    action_texts.extend(str(x.get("quote") or "") for x in action.get("source_evidence", []) or [] if isinstance(x, dict))

    # First, compare directly visible Chinese state values. Opaque internal tokens are ignored.
    state_texts = _flatten_strings(character_state)
    if any(_semantic_state_match(a, b) for a in action_texts for b in state_texts):
        return True

    # For prop continuity, use structural refs + Story Bible names rather than
    # story-specific action/state strings. A continuing action must explicitly
    # name a prop already held by this character and carry continuation aspect.
    tags = set(str(x) for x in action.get("dependency_tags") or [])
    if "prop_interaction" in tags and cid:
        held_refs = _held_prop_refs_for_character(shot, cid)
        terms = _prop_terms(story_bible, held_refs)
        action_text = str(action.get("action") or "")
        continuing = bool(re.search(r"(?:继续|仍然|仍旧|依旧|正在|还在|着)", action_text))
        if continuing and any(term and term in action_text for term in terms):
            return True
    return False


def _director_cross_shot_errors(shot: dict[str, Any], story_bible: dict[str, Any]) -> list[dict[str, Any]]:
    support = _shot_support_texts(shot)
    errors: list[dict[str, Any]] = []
    for idx, action in enumerate((shot.get("director") or {}).get("performance_actions", []) or []):
        if not isinstance(action, dict):
            continue
        evidence = [str(x.get("quote") or "") for x in action.get("source_evidence", []) or [] if isinstance(x, dict) and x.get("quote")]
        if not evidence:
            continue
        if any(text_related(q, base, threshold=0.48) for q in evidence for base in support):
            continue
        if _action_supported_by_state(action, shot, story_bible):
            # Legitimate previous-shot visible continuity supported by current structured state.
            continue
        errors.append(_issue(
            "E003_SPATIOTEMPORAL_POLLUTION",
            f"导演表演动作的证据不属于当前镜头，也无法由镜头开始状态的连续信息支持：{evidence[0]}",
            source_layer="Director",
            source_ref=f"shots[{shot.get('shot_id')}].director.performance_actions[{idx}]",
        ))
    return errors


def _prop_is_physically_present(description: str, names: list[str]) -> bool:
    """Return True only when the current Shot visibly handles/places the prop.

    Mere dialogue or narration about a prop is not enough to require prop_refs.
    """
    if not description:
        return False
    description = _QUOTED_TEXT_RE.sub("", description)
    physical_tokens = (
        "端着", "拿着", "拿起", "放下", "放在", "放进", "攥着", "攥在", "捂着",
        "翻出", "递给", "递出", "夹", "倒", "打开", "擦", "收起", "盖上", "关上",
        "走向", "走到", "吃", "咬", "盛", "被放", "放到",
    )
    for name in names:
        if not name:
            continue
        offset = 0
        while True:
            idx = description.find(name, offset)
            if idx < 0:
                break
            left = max(0, idx - 12)
            right = min(len(description), idx + len(name) + 12)
            window = description[left:right]
            if any(token in window for token in physical_tokens):
                return True
            offset = idx + len(name)
    return False


def _prop_entity_errors(shot: dict[str, Any], story_bible: dict[str, Any]) -> list[dict[str, Any]]:
    props = story_bible.get("props", []) or []
    refs = set(str(x) for x in shot.get("prop_refs", []) or [])
    description = str(shot.get("description") or "")
    expected: set[str] = set()

    for prop in props:
        pid = str(prop.get("prop_id") or "")
        if not pid:
            continue
        names = [str(prop.get("canonical_name") or prop.get("name") or "")]
        names.extend(str(x) for x in prop.get("aliases", []) or [])
        direct_names = [x for x in names if len(_norm(x)) >= 2]
        if _prop_is_physically_present(description, direct_names):
            expected.add(pid)

    missing = sorted(pid for pid in expected if pid not in refs)
    if missing and refs:
        name_map = {str(p.get("prop_id")): str(p.get("canonical_name") or p.get("name") or p.get("prop_id")) for p in props}
        return [_issue(
            "E001_ENTITY_MISBIND",
            f"当前镜头可见动作明确涉及 {', '.join(name_map.get(x, x) for x in missing)}，但镜头道具引用为 {', '.join(name_map.get(x, x) for x in sorted(refs))}。",
            source_layer="Storyboard Base",
            source_ref=f"shots[{shot.get('shot_id')}].prop_refs",
        )]

    # A state that literally says one prop is being treated as another entity is a hard binding failure.
    for pid, fields in (((shot.get("director") or {}).get("action_delta") or {}).get("props") or {}).items():
        for value in _flatten_strings(fields):
            lowered = value.lower()
            if "_as_" in lowered or "作为" in value:
                return [_issue(
                    "E001_ENTITY_MISBIND",
                    f"道具“{next((str(p.get('canonical_name') or p.get('name') or pid) for p in props if str(p.get('prop_id')) == str(pid)), str(pid))}”的内部状态把该道具描述成了另一实体或用途状态。",
                    source_layer="Director",
                    source_ref=f"shots[{shot.get('shot_id')}].director.action_delta.props.{pid}",
                )]
    return []


def _reference_errors(shot: dict[str, Any]) -> list[dict[str, Any]]:
    director = shot.get("director") or {}
    allowed = set(str(x) for x in shot.get("character_refs", []) or [])
    refs: set[str] = set(str(x) for x in director.get("primary_subject_refs", []) or [])
    refs.update(str(x) for x in director.get("reaction_target_refs", []) or [])
    refs.update(str(x.get("character_ref")) for x in director.get("performance_actions", []) or [] if isinstance(x, dict) and x.get("character_ref"))
    invalid = sorted(x for x in refs if x not in allowed)
    errors: list[dict[str, Any]] = []
    if invalid:
        errors.append(_issue(
            "E002_CHAR_REF_MISMATCH",
            f"导演层引用了当前镜头人物列表之外的人物：{', '.join(invalid)}",
            source_layer="Director",
            source_ref=f"shots[{shot.get('shot_id')}].director",
        ))

    speakers = []
    for item in shot.get("dialogue", []) or []:
        if isinstance(item, dict) and item.get("character_id") and item.get("character_id") not in speakers:
            speakers.append(item.get("character_id"))
    if set(speakers) != set(director.get("speaker_target_refs", []) or []):
        errors.append(_issue(
            "E005_DIALOGUE_SPEAKER_MISMATCH",
            "导演层说话人引用与当前镜头对白说话人不一致。",
            source_layer="Director",
            source_ref=f"shots[{shot.get('shot_id')}].director.speaker_target_refs",
        ))
    return errors


def _style_warnings(shot: dict[str, Any], story_bible: dict[str, Any], style_guide: dict[str, Any]) -> list[dict[str, Any]]:
    scene_id = str(shot.get("location_ref") or "")
    scene = next((x for x in story_bible.get("scenes", []) or [] if str(x.get("scene_id")) == scene_id), {})
    hard = " ".join(_flatten_strings(scene.get("visual_lock") or {}))
    style = " ".join(_flatten_strings(style_guide or {})).lower()
    warnings: list[dict[str, Any]] = []
    if "白炽" in hard and "fluorescent" in style:
        warnings.append(_issue(
            "W007_STYLE_HARD_FACT_DRIFT",
            "全局视觉风格带有“荧光灯照明”倾向，但场景硬事实锁定为白炽灯管；最终提示词按硬事实编译。",
            source_layer="Style Guide",
            source_ref="style_guide.visual_reference",
        ))
    return warnings


def _visual_focus_warnings(shot: dict[str, Any]) -> list[dict[str, Any]]:
    focus = ((shot.get("director") or {}).get("visual_focus") or {})
    regions = {str(region) for items in (focus.get("body_regions") or {}).values() for region in (items or [])}
    size = str(shot.get("shot_size") or "")
    conflict = False
    if size in {"wide", "extreme_wide"} and regions.intersection({"face", "eyes", "hands", "mouth"}):
        conflict = True
    if conflict:
        size_labels = {"wide": "全景", "extreme_wide": "大远景"}
        region_labels = {
            "face": "面部", "eyes": "眼部", "hands": "手部", "mouth": "嘴部",
            "head": "头部", "neck": "颈部", "upper_body": "上半身", "lower_body": "下半身", "full_body": "全身",
        }
        region_text = "、".join(region_labels.get(x, x) for x in sorted(regions))
        return [_issue(
            "W006_VISUAL_FOCUS_CONFLICT",
            f"当前景别为{size_labels.get(size, size)}，但导演层同时要求局部视觉重点（{region_text}），存在潜在不协调；消费编译器不会自行修改景别。",
            source_layer="ShotSpec / Director",
            source_ref=f"shots[{shot.get('shot_id')}].director.visual_focus",
        )]
    return []


def lint_shot(
    shot: dict[str, Any],
    story_bible: dict[str, Any],
    style_guide: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    errors.extend(_reference_errors(shot))
    errors.extend(_prop_entity_errors(shot, story_bible))
    errors.extend(_director_cross_shot_errors(shot, story_bible))
    warnings.extend(_style_warnings(shot, story_bible, style_guide))
    warnings.extend(_visual_focus_warnings(shot))

    current = float(shot.get("duration") or 0.0)
    estimate = estimate_min_duration(shot)
    if current > 0 and estimate > current + 0.25:
        warnings.append(_issue(
            "W003_DURATION_RISK",
            f"当前镜头 {current:g} 秒，按第一版确定性估算建议最低约 {estimate:g} 秒；仅作风险提示，不自动改时长或拆镜。",
            source_layer="ShotSpec",
            source_ref=f"shots[{shot.get('shot_id')}].duration",
        ))

    # Stable de-duplication by code + source_ref + detail.
    def unique(items: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
        seen: set[tuple[str, str, str]] = set(); out: list[dict[str, Any]] = []
        for item in items:
            key = (str(item.get("code")), str(item.get("source_ref")), str(item.get("detail")))
            if key in seen:
                continue
            seen.add(key); out.append(item)
        return out

    return unique(errors), unique(warnings)
