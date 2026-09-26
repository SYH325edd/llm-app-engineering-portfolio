from __future__ import annotations

import copy
import hashlib
import json
import re
from difflib import SequenceMatcher
from typing import Any

from .consumption_lint import ERROR_LABELS, LINT_VERSION, WARNING_LABELS, lint_shot
from .shot_manifest import build_shot_consumption_manifest, render_shot_prompt
from .shot_visibility import visible_character_refs

COMPILER_VERSION = "consumption_v1"
ASSET_COMPILER_VERSION = "consumption_v1"

SHOT_SIZE = {
    "extreme_wide": "大远景", "wide": "全景", "medium": "中景", "medium_close": "中近景",
    "close": "近景", "extreme_close": "特写",
}
CAMERA = {
    "eye_level": "平视机位", "high_angle": "高角度俯拍", "low_angle": "低角度仰拍",
    "overhead": "顶视机位", "dutch": "斜角机位", "pov": "主观视角",
}
MOVEMENT = {
    "static": "固定镜头", "pan": "横摇", "tilt": "纵摇", "dolly": "移动镜头", "truck": "平移跟拍",
    "crane": "升降", "handheld": "手持", "zoom": "变焦", "push_in": "缓慢推近", "pull_out": "缓慢拉远",
}
_QUOTED_TEXT_RE = re.compile(r'[‘’“”"\'].*?[‘’“”"\']')

# Generic semantic categories. Production code may classify a fact by role
# (time-bound, olfactory, human activity, transient state), but must not know
# entities or phrases from any individual story.
_TEMPORAL_EXPR = r"(?:第[一二三四五六七八九十百\d]+天|当天|次日|翌日|后来|之后|随后|天亮前|天快亮(?:时)?|凌晨|清晨|早晨|晨间|上午|中午|下午|傍晚|黄昏|晚上|夜晚|深夜|日出|日落|晨光|暮光|夕阳|夕照|余晖|夜色)"
_TEMPORAL_RE = re.compile(_TEMPORAL_EXPR)
_OLFACTORY_RE = re.compile(r"(?:气味|味道|香味|香气|臭味|臭气|闻起来|闻到|嗅到|嗅觉|[\u4e00-\u9fff]{1,8}味(?:道)?(?=.{0,10}(?:弥漫|飘|散|混|充满)))")
_NON_VISUAL_COGNITION_RE = re.compile(r"(?:仿佛|似乎|好像).{0,16}(?:想起|回到|记起|意识到|明白)|(?:想起|回忆起|记起|意识到|明白|觉得|想到)")
_NON_VISUAL_AUTHORIAL_RE = re.compile(r"(?:和|与).{0,20}(?:以前|过去|当年|从前).{0,8}(?:一样|相同)|(?:象征|意味着|体现|代表)")
_NON_VISUAL_AUDIO_RE = re.compile(r"(?:传来|响起|听见|听到).{0,24}(?:声音|声|音乐|歌声|叫喊|说话)|(?:声音|歌声|音乐|叫喊声).{0,16}(?:传来|响起)")
_HUMAN_ACTIVITY_RE = re.compile(r"(?:(?:正在|仍在|还在|此时|当下).{0,24}|(?:一|两|几|数|多)?(?:个|名)?[\u4e00-\u9fff]{0,6}人(?:在|正|正在).{0,16})(?:笑|交谈|聊天|说话|走动|走过|奔跑|排队|坐着|站着|忙碌|工作|等待)")
_TRANSIENT_CHANGE_RE = re.compile(rf"(?:{_TEMPORAL_EXPR}|临时).{{0,24}}(?:增加|新增|多出|多了|摆上|摆了|放上|放了|搬来|移入|换成|变成|出现)")
_TRANSIENT_STATE_RE = re.compile(r"(?:正在|仍在|还在|亮着|开着|关着|升起|腾起|冒出|飘散|散开|晃动)")
_NARRATIVE_SUMMARY_PATTERNS = [
    rf"^(?:{_TEMPORAL_EXPR}|每天|有时|有时候)",
    rf"(?:{_TEMPORAL_EXPR}|每天|有时|有时候).*(?:来|没来|多给|还有|照常|都)",
]
_COMMON_CN_REPLACEMENTS = {
    "PVC": "聚氯乙烯", "LED": "发光二极管", "T恤": "短袖上衣", "T-shirt": "短袖上衣",
}
_STANDARD_STATE_TEXT_FIELDS = {
    "position", "posture", "gaze_target", "facial_expression", "head_orientation",
    "reaction", "action", "action_state", "speaking",
}


def _find(items: list[dict[str, Any]] | None, key: str, value: str) -> dict[str, Any] | None:
    return next((item for item in items or [] if str(item.get(key)) == str(value)), None)


def _entry_value(entry: Any) -> str:
    if not isinstance(entry, dict) or entry.get("status") not in {"locked", "confirmed"}:
        return ""
    return str(entry.get("value") or "").strip()


def _has_chinese(text: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", text or ""))


def _strip_quoted_text(text: str) -> str:
    return _QUOTED_TEXT_RE.sub("", text or "")


def _strip_redundant_prefix(text: str, time_label: str = "", scene_name: str = "") -> str:
    value = str(text or "").strip()
    if not value:
        return ""
    prefixes = [x for x in (time_label, scene_name) if x]
    changed = True
    while changed and value:
        changed = False
        for prefix in prefixes:
            new_value = re.sub(rf"^{re.escape(prefix)}(?:的)?[，,、；; ]*", "", value)
            if new_value != value:
                value = new_value.strip()
                changed = True
    return value.strip("，,；; 。")


def _is_narrative_summary_text(text: str) -> bool:
    value = str(text or "").strip()
    if not value:
        return False
    return any(re.search(pattern, value) for pattern in _NARRATIVE_SUMMARY_PATTERNS)


def _is_non_visual_action_text(text: str) -> bool:
    value = str(text or "").strip()
    if not value:
        return False
    visible = _strip_quoted_text(value)
    return any(pattern.search(visible) for pattern in (_OLFACTORY_RE, _NON_VISUAL_COGNITION_RE, _NON_VISUAL_AUTHORIAL_RE, _NON_VISUAL_AUDIO_RE))


def _normalize_common_cn_terms(value: str) -> str:
    text = str(value or "")
    # Canonicalize wardrobe terms before generic replacements so compounds such
    # as “短袖T恤” do not become “短袖短袖上衣”.
    text = re.sub(r"短袖\s*(?:T恤|T-shirt)", "短袖上衣", text, flags=re.I)
    for source, target in _COMMON_CN_REPLACEMENTS.items():
        text = text.replace(source, target)
    text = re.sub(r"(短袖)(?:短袖)+(上衣)", r"\1\2", text)
    return text


def _normalized_clause_key(value: str) -> str:
    return re.sub(r"[\s，,。；;：:]", "", str(value or ""))


def _dedupe_stable_clauses(values: list[str]) -> list[str]:
    out: list[str] = []
    keys: list[str] = []
    for raw in values:
        value = str(raw or "").strip(" ，,；;。")
        if not value:
            continue
        # PVB occasionally returns an enum-like leading “等” before a body
        # adjective. Removing that orphan token is representation cleanup, not
        # story rewriting.
        value = re.sub(r"^等(?=(?:偏|较|中等|高|矮|瘦|壮|胖))", "", value)
        key = _normalized_clause_key(value)
        if not key:
            continue
        # Equal or already-covered clauses add no information.
        if any(key == existing_key or key in existing_key for existing_key in keys):
            continue
        # A later longer clause may subsume more than one earlier fragment
        # (e.g. time + generic lighting). Remove *all* covered fragments and
        # insert the richer clause at the earliest covered position.
        covered = [idx for idx, existing_key in enumerate(keys) if existing_key and existing_key in key]
        if covered:
            insert_at = covered[0]
            covered_set = set(covered)
            out = [item for idx, item in enumerate(out) if idx not in covered_set]
            keys = [item for idx, item in enumerate(keys) if idx not in covered_set]
            out.insert(insert_at, value)
            keys.insert(insert_at, key)
        else:
            out.append(value)
            keys.append(key)
    return out


def _compact_asset_field(value: str, *, max_clauses: int) -> list[str]:
    text = _normalize_common_cn_terms(_clean_character_asset_text(value))
    clauses = [x.strip() for x in re.split(r"[，,；;。]", text) if x.strip()]
    return _dedupe_stable_clauses(clauses)[:max_clauses]


def _compact_canonical_asset_field(value: str, *, max_clauses: int) -> list[str]:
    """Compact an already-canonical asset without re-running legacy prose cleanup."""
    text = _normalize_common_cn_terms(str(value or "").strip())
    clauses = [x.strip() for x in re.split(r"[，,；;。]", text) if x.strip()]
    return _dedupe_stable_clauses(clauses)[:max_clauses]


def _contains_latin(value: str) -> bool:
    return bool(re.search(r"[A-Za-z]", str(value or "")))


def _stable_text_hash(value: str) -> str:
    return hashlib.sha256(str(value or "").encode("utf-8")).hexdigest()[:16]


def _strip_time_bound_modifier(value: str, *, lighting: bool = False) -> str:
    """Remove time authority without leaving broken grammatical residue.

    v2f used raw substring deletion, which could turn a valid clause into fragments
    such as “到的自然光”. v2g works at a leading-modifier / stable-light level and
    never applies this helper to the final shot scene-state authority itself.
    """
    text = str(value or "").strip(" ，,；;。")
    if not text or not _TEMPORAL_RE.search(text):
        return text

    if lighting:
        # Prefer the stable lighting phrase already present in the clause rather
        # than deleting arbitrary temporal substrings from its middle.
        candidates = (
            r"自然光[^；;。]*",
            r"(?:室内|室外)?(?:暖白|冷白|暖色|冷色)?(?:主光|灯光|照明)[^；;。]*",
            r"(?:侧光|斜侧光|逆光|顶光|柔光|硬光)[^；;。]*",
        )
        for pattern in candidates:
            hit = re.search(pattern, text)
            if hit:
                stable = hit.group(0).strip(" ，,；;。")
                # Strip a dangling grammatical prefix if a malformed legacy asset
                # already contained one; never manufacture new wording.
                stable = re.sub(r"^(?:到|前|后|时|里的|下的|中的)+的?", "", stable).strip()
                return stable
        # A phase-light word with no independent stable light is state-only; omit
        # it from the baseline rather than degrading it into broken prose.
        return ""

    # Non-lighting stable assets may contain a leading time qualifier. Remove only
    # the complete leading qualifier, never every temporal token in the sentence.
    cleaned = re.sub(rf"^(?:{_TEMPORAL_EXPR})(?:时|里|下|中|的)?[，,、；; ]*", "", text).strip(" ，,；;。")
    return cleaned if cleaned != text else ""

def _clean_scene_asset_text(value: str, *, field_name: str) -> str:
    if not value:
        return ""
    text = _normalize_common_cn_terms(_clean_clause_text(value))
    clauses = [x.strip(" ；;，,") for x in re.split(r"[；;]", text) if x.strip(" ；;，,")]
    keep: list[str] = []
    for clause in clauses:
        if _OLFACTORY_RE.search(clause):
            continue
        if _HUMAN_ACTIVITY_RE.search(clause):
            continue
        if field_name in {"layout", "environment"} and _TRANSIENT_CHANGE_RE.search(clause):
            continue
        if field_name == "environment" and _TRANSIENT_STATE_RE.search(clause):
            continue
        if field_name == "lighting":
            had_temporal = bool(_TEMPORAL_RE.search(clause))
            if re.fullmatch(rf"{_TEMPORAL_EXPR}", clause):
                continue
            if had_temporal and any(token in clause for token in ("窗外", "天空", "天色", "云层", "地平线")):
                continue
            clause = _strip_time_bound_modifier(clause, lighting=True)
            if _TRANSIENT_STATE_RE.search(clause) and not any(token in clause for token in ("自然光", "灯光", "照明", "光线")):
                continue
        elif field_name == "color":
            if _TEMPORAL_RE.search(clause) and any(token in clause for token in ("天空", "天色", "窗外", "云层", "地平线")):
                continue
            clause = _strip_time_bound_modifier(clause)
        elif _TEMPORAL_RE.search(clause) and field_name in {"space", "materials"}:
            clause = _strip_time_bound_modifier(clause)
        if not clause or _contains_latin(clause):
            continue
        keep.append(clause)
    return "；".join(keep)


def _style_summary_cn(style_guide: dict[str, Any]) -> str:
    raw = " ".join(_entry_value(style_guide.get(k)) for k in ("era", "region", "genre", "tone", "visual_reference"))
    low = raw.lower()
    parts: list[str] = []

    def add(value: str) -> None:
        if value and value not in parts:
            parts.append(value)

    if "mainland china" in low or "中国城市" in raw or "中国北方" in raw:
        add("中国城市现实环境")
    if any(token in low for token in ("quiet realism", "slice-of-life", "neorealist")) or any(token in raw for token in ("现实主义", "写实", "生活流")):
        add("写实生活流")
    if "纪实" in raw:
        add("纪实质感")
    if "低饱和" in raw:
        add("低饱和")
    if any(token in raw for token in ("暖色", "偏暖", "暖调", "温暖")):
        add("暖调")
    if "胶片颗粒" in raw or "film grain" in low:
        add("轻微胶片颗粒")
    if "怀旧" in raw:
        add("轻微怀旧质感")
    if "磨损" in raw:
        add("保留真实生活磨损")
    if "克制" in raw or "understated" in low:
        add("克制自然")
    if "质朴" in raw or "素朴" in raw:
        add("质朴")
    return "、".join(parts[:5])

def _clean_clause_text(value: str, *, remove_dynamic_time: bool = False) -> str:
    if not value:
        return ""
    text = re.sub(r"（[^）]*(?:原文未|曾|此前|过去|以前|当时)[^）]*）", "", value)
    text = re.sub(r"\([^)]*(?:原文未|曾|此前|过去|以前|当时)[^)]*\)", "", text)
    clauses = [x.strip(" ；;，,") for x in re.split(r"[；;]", text) if x.strip(" ；;，,")]
    keep: list[str] = []
    for clause in clauses:
        if any(token in clause for token in ("原文未", "曾", "此前", "过去", "以前")):
            continue
        if remove_dynamic_time and _TEMPORAL_RE.search(clause):
            continue
        keep.append(clause)
    return "；".join(keep)


def _visual_lock_or_pvb(story_char: dict[str, Any], pvb_char: dict[str, Any] | None, field: str) -> str:
    visual_lock = story_char.get("visual_lock") or {}
    if field in visual_lock and visual_lock.get(field) not in (None, ""):
        return str(visual_lock.get(field))
    if not pvb_char:
        return ""
    if field.startswith("wardrobe."):
        return _entry_value((pvb_char.get("wardrobe") or {}).get(field.split(".", 1)[1]))
    return _entry_value((pvb_char.get("visual_identity") or {}).get(field))


def _clean_character_asset_text(value: str) -> str:
    text = _normalize_common_cn_terms(str(value or "").strip())
    if not text:
        return ""
    parts = re.split(r"([；;，,。])", text)
    cleaned: list[str] = []
    for part in parts:
        if part in {"；", ";", "，", ",", "。"}:
            cleaned.append(part)
            continue
        segment = part.strip()
        if not segment:
            continue
        match = re.match(rf"^(.+?)(?:在|于){_TEMPORAL_EXPR}(?:里|下|中)?(?:显得|看起来|呈现|泛出|映出|变得|显出)?.*$", segment)
        if match:
            segment = match.group(1).strip()
        else:
            segment = _strip_time_bound_modifier(segment)
        if segment:
            cleaned.append(segment)
    result = "".join(cleaned)
    result = re.sub(r"[，,；;]{2,}", "；", result).strip("，,；; 。")
    return result


def _asset_cn_value(value: str, warnings: list[dict[str, Any]], *, source_ref: str, strip_environment_context: bool = True) -> str:
    normalized = _clean_character_asset_text(value) if strip_environment_context else _normalize_common_cn_terms(str(value or "").strip())
    if not normalized:
        return ""
    if _contains_latin(normalized):
        warnings.append({
            "code": "W011_NON_CHINESE_ASSET_FIELD",
            "label": WARNING_LABELS["W011_NON_CHINESE_ASSET_FIELD"],
            "detail": "资产字段含无法确定性翻译的英文内容，消费编译器已停止输出该字段。",
            "source_layer": "Story Bible / PVB / PSB",
            "source_ref": source_ref,
        })
        return ""
    return normalized


ASSET_REGISTRY_VERSION = "asset_registry.v2"
CONTINUITY_ANCHOR_VERSION = "continuity_anchor_v2"


def _normalize_body_asset_value(value: str) -> str:
    """Normalize schema-like body residues without adding story facts."""
    text = _normalize_common_cn_terms(str(value or "").strip())
    # PVB body enums sometimes lose the leading 中 in “中等身高”. This is a
    # schema representation repair, not a story inference.
    text = re.sub(r"(^|[，,；;])等身高(?=$|[，,；;。])", r"\1中等身高", text)
    text = re.sub(r"([，,；;。])\1+", r"\1", text)
    return text.strip(" ，,；;。")


def _wardrobe_key(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    first = re.split(r"[，,；;。]", text, maxsplit=1)[0].strip()
    first = re.sub(r"^(?:内搭|搭配|穿着|穿|外搭)", "", first).strip()
    return first


def _remove_named_garment(value: str, garment: str) -> str:
    text = str(value or "")
    key = str(garment or "").strip()
    if not text or not key:
        return text.strip(" ，,；;。")
    text = re.sub(rf"(?:内搭|搭配|穿着|穿|外搭)?{re.escape(key)}", "", text)
    text = re.sub(r"[，,；;]{2,}", "，", text)
    text = re.sub(r"^[，,；; ]+|[，,；; ]+$", "", text)
    return text.strip(" ，,；;。")


def _canonical_character_asset_record(
    story_bible: dict[str, Any],
    pvb: dict[str, Any],
    ref: str,
    warnings: list[dict[str, Any]],
) -> dict[str, Any]:
    story_char = _find(story_bible.get("characters"), "character_id", ref) or {}
    pvb_char = _find(pvb.get("characters"), "character_id", ref)
    identity: dict[str, str] = {}
    for field in ("age_appearance", "face", "hair", "body", "skin"):
        raw = _visual_lock_or_pvb(story_char, pvb_char, field)
        clean = _asset_cn_value(raw, warnings, source_ref=f"characters[{ref}].{field}")
        if field == "body":
            # Character text cleanup may strip the leading “中” from the schema
            # enum “中等身高”; normalize only after prose cleanup so the canonical
            # registry remains the final authority.
            clean = _normalize_body_asset_value(clean)
        if clean:
            identity[field] = clean

    wardrobe: dict[str, str] = {}
    story_outer_raw = str((story_char.get("visual_lock") or {}).get("outerwear") or "").strip()
    story_outer_is_phase = bool(
        story_outer_raw
        and (
            _TEMPORAL_RE.search(story_outer_raw)
            or re.search(r"(?:首次|初始|起初|第一次).{0,20}(?:穿|为|外套|夹克|风衣|羽绒服)", story_outer_raw)
        )
    )
    for field in ("default", "shirt", "footwear", "accessory", "outerwear"):
        raw = _visual_lock_or_pvb(story_char, pvb_char, f"wardrobe.{field}")
        if field == "outerwear" and story_outer_raw and not story_outer_is_phase:
            raw = story_outer_raw
        clean = _asset_cn_value(
            raw, warnings,
            source_ref=f"characters[{ref}].wardrobe.{field}",
            strip_environment_context=False,
        )
        if clean:
            wardrobe[field] = clean
    phase_wardrobe = ""
    if story_outer_is_phase:
        phase_wardrobe = _asset_cn_value(
            story_outer_raw, warnings,
            source_ref=f"characters[{ref}].visual_lock.outerwear",
            strip_environment_context=False,
        )

    # A catch-all default upper garment already owns the stable shirt identity;
    # do not serialize a second shirt leaf that restates the same upper garment.
    default = wardrobe.get("default", "")
    upper_tokens = ("上衣", "衫", "T恤", "衬衫", "毛衣", "卫衣", "背心", "裙")
    if wardrobe.get("shirt") and default and any(token in default for token in upper_tokens):
        wardrobe.pop("shirt", None)

    # Dedicated wardrobe leaves are more authoritative/descriptive than the
    # catch-all default leaf. Remove the same garment from default rather than
    # serializing contradictory/duplicated clothing across sections.
    default = wardrobe.get("default", "")
    for field in ("outerwear", "shirt", "footwear", "accessory"):
        key = _wardrobe_key(wardrobe.get(field, ""))
        if key and key in default:
            default = _remove_named_garment(default, key)
    if default:
        wardrobe["default"] = default
    else:
        wardrobe.pop("default", None)

    return {
        "asset_registry_version": ASSET_REGISTRY_VERSION,
        "character_id": ref,
        "canonical_name": str(story_char.get("canonical_name") or ref),
        "identity": identity,
        "wardrobe": wardrobe,
        "phase_wardrobe": phase_wardrobe,
    }


def _canonical_scene_asset_record(
    story_bible: dict[str, Any], psb: dict[str, Any], scene_ref: str
) -> dict[str, Any]:
    scene = _find(story_bible.get("scenes"), "scene_id", scene_ref) or {}
    lock = scene.get("visual_lock") if isinstance(scene.get("visual_lock"), dict) else {}
    psb_scene = _find(psb.get("scenes"), "scene_id", scene_ref) or {}
    production = psb_scene.get("production_visual") if isinstance(psb_scene.get("production_visual"), dict) else {}

    def raw(name: str) -> str:
        hard = lock.get(name)
        if isinstance(hard, str) and hard.strip():
            return hard.strip()
        return _entry_value(production.get(name))

    stable: dict[str, str] = {}
    spatial_state: list[str] = []
    for field in ("space", "layout", "materials", "environment", "color"):
        source = str(raw(field) or "")
        if field in {"layout", "environment"}:
            stable_parts: list[str] = []
            for piece in re.split(r"[；;，,]", source):
                piece = _normalize_common_cn_terms(piece.strip())
                if not piece or _HUMAN_ACTIVITY_RE.search(piece):
                    continue
                is_state = bool(
                    _TRANSIENT_CHANGE_RE.search(piece)
                    or re.search(r"(?:现在|如今|目前).{0,20}(?:是|为|变成|改成)", piece)
                )
                if is_state:
                    spatial_state.append(piece.strip(" ，,；;。"))
                    continue
                cleaned = _clean_scene_asset_text(piece, field_name=field)
                if cleaned:
                    stable_parts.append(cleaned)
            value = "；".join(_dedupe_stable_clauses(stable_parts))
        else:
            value = _clean_scene_asset_text(source, field_name=field)
        if value:
            stable[field] = value
    state: dict[str, str] = {}
    # Lighting is stateful by definition. Preserve explicit time-bound light
    # words (夕阳/晨光/夜间灯光) here instead of stripping them as if they
    # were permanent scene identity.
    lighting = _normalize_common_cn_terms(str(raw("lighting") or "").strip())
    lighting = re.sub(r"[（(][^）)]*(?:原文未|未说明|未明确|推测|分析)[^）)]*[）)]", "", lighting)
    lighting = re.sub(r"[，,；;]{2,}", "；", lighting).strip(" ，,；;。")
    baseline_lighting: list[str] = []
    phase_lighting: list[str] = []
    for clause in [x.strip() for x in re.split(r"[；;]", lighting) if x.strip()]:
        if _TEMPORAL_RE.search(clause):
            phase_lighting.append(clause)
            generic = _strip_time_bound_modifier(clause, lighting=True).strip(" ，,；;。")
            if generic and "自然光" in generic:
                baseline_lighting.append(generic)
        else:
            baseline_lighting.append(clause)
    if baseline_lighting:
        state["lighting"] = "；".join(_dedupe_stable_clauses(baseline_lighting))
    if phase_lighting:
        state["lighting_states"] = _dedupe_stable_clauses(phase_lighting)
    # Transient spatial transitions are state, not permanent scene identity.
    if spatial_state:
        state["spatial_state"] = "；".join(_dedupe_stable_clauses(spatial_state))
    return {
        "asset_registry_version": ASSET_REGISTRY_VERSION,
        "scene_id": scene_ref,
        "canonical_name": str(scene.get("canonical_name") or scene.get("name") or scene_ref),
        "stable": stable,
        "state_baseline": state,
    }


def _asset_record_hash(record: dict[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()[:16]



def _compact_character_summary_for_shot(
    story_bible: dict[str, Any],
    pvb: dict[str, Any],
    refs: list[str],
    warnings: list[dict[str, Any]],
    shot: dict[str, Any] | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    """Compile visibility-aware, minimal sufficient character anchors.

    The canonical asset registry remains the source of truth. The renderer only
    selects the smallest subset that is useful at the current framing. Stable
    identity is never invented or taken from per-shot prose.
    """
    chunks: list[str] = []
    records: list[dict[str, Any]] = []
    shot_obj = shot or {}
    director = shot_obj.get("director") if isinstance(shot_obj.get("director"), dict) else {}
    focus = director.get("visual_focus") if isinstance(director.get("visual_focus"), dict) else {}
    body_regions_by_ref = focus.get("body_regions") if isinstance(focus.get("body_regions"), dict) else {}
    execution_design = director.get("execution_shot_design") if isinstance(director.get("execution_shot_design"), dict) else {}
    shot_size = str(execution_design.get("shot_size") or shot_obj.get("shot_size") or "")
    framing = director.get("execution_framing") if isinstance(director.get("execution_framing"), dict) else {}
    framing_type = str(framing.get("framing_type") or "")

    for ref in refs:
        record = _canonical_character_asset_record(story_bible, pvb, ref, warnings)
        records.append(record)
        ident = record.get("identity") or {}
        wardrobe = record.get("wardrobe") or {}
        focus_regions = {str(x) for x in (body_regions_by_ref.get(ref) or []) if isinstance(x, str)}
        values: list[str] = []

        body_clauses = _compact_canonical_asset_field(str(ident.get("body") or ""), max_clauses=8)
        hand_clauses = [x for x in body_clauses if any(token in x for token in ("手", "指", "掌"))]
        face_detail = bool(focus_regions & {"face", "eyes", "mouth", "head"})
        hand_detail = "hands" in focus_regions
        feet_detail = bool(focus_regions & {"feet", "lower_body"})
        local_detail = framing_type == "detail" or bool(focus_regions)

        if local_detail:
            # Focus regions are additive, not mutually exclusive. A close shot can
            # legitimately focus on both eyes and hands; choosing hands first used
            # to discard all face identity when no canonical hand detail existed.
            if face_detail:
                face_identity: list[str] = []
                face_identity.extend(_compact_canonical_asset_field(str(ident.get("hair") or ""), max_clauses=1))
                face_identity.extend(_compact_canonical_asset_field(str(ident.get("face") or ""), max_clauses=1))
                if not face_identity:
                    face_identity.extend(_compact_canonical_asset_field(str(ident.get("age_appearance") or ""), max_clauses=1))
                values.extend(face_identity)
            if hand_detail:
                values.extend(hand_clauses[:2])
            if feet_detail:
                values.extend(_compact_canonical_asset_field(str(wardrobe.get("footwear") or ""), max_clauses=1))
                values.extend([x for x in body_clauses if not any(t in x for t in ("手", "指", "掌"))][:1])
            if not (face_detail or hand_detail or feet_detail):
                values.extend(_compact_canonical_asset_field(str(ident.get("hair") or ""), max_clauses=1))
                values.extend(_compact_canonical_asset_field(str(ident.get("face") or ""), max_clauses=1))
            # Keep one clothing identity cue if the local crop still plausibly
            # includes wardrobe; this makes the shot independently consumable.
            values.extend(_compact_canonical_asset_field(str(wardrobe.get("outerwear") or wardrobe.get("shirt") or wardrobe.get("default") or ""), max_clauses=1))
        else:
            # Face-level identity is useful only when the framing can actually
            # render it. Wider shots prioritize silhouette / wardrobe instead.
            if shot_size in {"medium_close", "close", "extreme_close"}:
                face_identity = []
                face_identity.extend(_compact_canonical_asset_field(str(ident.get("hair") or ""), max_clauses=1))
                face_identity.extend(_compact_canonical_asset_field(str(ident.get("face") or ""), max_clauses=1))
                if not face_identity:
                    face_identity.extend(_compact_canonical_asset_field(str(ident.get("age_appearance") or ""), max_clauses=1))
                values.extend(face_identity)
            elif shot_size == "medium":
                values.extend(_compact_canonical_asset_field(str(ident.get("hair") or ""), max_clauses=1))
                values.extend([x for x in body_clauses if not any(t in x for t in ("手", "指", "掌"))][:1])
            else:
                values.extend([x for x in body_clauses if not any(t in x for t in ("手", "指", "掌"))][:1])
                values.extend(_compact_canonical_asset_field(str(ident.get("hair") or ""), max_clauses=1))

            outer = _compact_canonical_asset_field(str(wardrobe.get("outerwear") or ""), max_clauses=2)
            if outer:
                values.extend(outer)
            else:
                values.extend(_compact_canonical_asset_field(str(wardrobe.get("shirt") or wardrobe.get("default") or ""), max_clauses=2))
            if shot_size in {"wide", "extreme_wide"}:
                values.extend(_compact_canonical_asset_field(str(wardrobe.get("footwear") or ""), max_clauses=1))

        # Fallback only when the preferred visible subset has no usable asset.
        # The fallback must still come exclusively from the canonical character
        # registry, but it cannot be limited to age/default wardrobe: a detail
        # shot focused on hands may have no canonical hand/body field while the
        # same character still has perfectly valid face/hair/shirt identity.
        # Readiness requires every visible subject to remain independently
        # identifiable, so select the smallest available canonical subset rather
        # than silently emitting an empty continuity anchor.
        if not values:
            for field in ("hair", "face", "age_appearance", "body", "skin"):
                values.extend(_compact_canonical_asset_field(str(ident.get(field) or ""), max_clauses=1))
                if len(values) >= 2:
                    break
            if len(values) < 2:
                for field in ("outerwear", "default", "shirt", "footwear", "accessory"):
                    values.extend(_compact_canonical_asset_field(str(wardrobe.get(field) or ""), max_clauses=1))
                    if len(values) >= 2:
                        break

        values = _dedupe_stable_clauses(values)
        if values:
            chunks.append(f"{record['canonical_name']}：" + "，".join(values[:5]))
    return "；".join(chunks), records


def missing_visible_character_identity_refs(
    story_bible: dict[str, Any],
    pvb: dict[str, Any],
    shot: dict[str, Any],
) -> list[str]:
    """Return visible refs that cannot form a canonical identity anchor.

    This deliberately reuses the exact visibility-aware compaction path used by
    final shot compilation, so preflight and E023 cannot drift into two separate
    definitions of identity sufficiency.
    """
    missing: list[str] = []
    for ref in visible_character_refs(shot):
        anchor, _ = _compact_character_summary_for_shot(
            story_bible, pvb, [ref], [], shot=shot
        )
        if not str(anchor or "").strip():
            missing.append(ref)
    return missing


def _semantic_context_for_scene_selection(
    shot: dict[str, Any], semantics: dict[str, Any], story_bible: dict[str, Any]
) -> str:
    parts: list[str] = [str(shot.get("composition") or "")]
    director = shot.get("director") if isinstance(shot.get("director"), dict) else {}
    for item in director.get("performance_actions", []) or []:
        if isinstance(item, dict):
            parts.append(str(item.get("action") or ""))
    for item in semantics.get("visual_events", []) or []:
        if isinstance(item, dict):
            parts.append(str(item.get("action") or ""))
    for ref in shot.get("prop_refs", []) or []:
        prop = _find(story_bible.get("props"), "prop_id", str(ref)) or {}
        parts.append(str(prop.get("canonical_name") or prop.get("name") or ""))
    return " ".join(x for x in parts if x)


def _cjk_bigrams(value: str) -> set[str]:
    compact = re.sub(r"[^\u4e00-\u9fff0-9A-Za-z]", "", str(value or ""))
    return {compact[i:i + 2] for i in range(max(0, len(compact) - 1))}


def _scene_fragment_relevant(fragment: str, context: str) -> bool:
    fragment = str(fragment or "").strip()
    context = str(context or "").strip()
    if not fragment or not context:
        return False
    if fragment in context:
        return True
    fg = _cjk_bigrams(fragment)
    cg = _cjk_bigrams(context)
    shared = fg & cg
    if len(fragment) <= 4:
        return bool(shared)
    return len(shared) >= 2


def _clean_scene_fragments(raw: str, *, field_name: str) -> list[str]:
    if not raw:
        return []
    # Split transient clauses before cleaning so a stable location phrase is not
    # discarded merely because a neighboring clause says e.g. "灯亮着".
    pieces = re.split(r"[；;，,]", str(raw)) if field_name in {"layout", "materials", "environment"} else [str(raw)]
    out: list[str] = []
    for piece in pieces:
        cleaned = _clean_scene_asset_text(piece, field_name=field_name)
        if cleaned and cleaned not in out:
            out.append(cleaned)
    return out


def _compact_scene_summary_for_shot(
    story_bible: dict[str, Any],
    psb: dict[str, Any],
    shot: dict[str, Any],
    semantics: dict[str, Any],
) -> tuple[str, str]:
    """Select minimal stable scene facts relevant to the current shot.

    Scene assets are not copied wholesale. The broad physical space is retained;
    layout/material/environment clauses are included only when they overlap the
    current shot's visible context. Time-specific lighting is stripped so the
    Script/Shot time label remains authoritative.
    """
    scene_ref = str(shot.get("location_ref") or "")
    scene = _find(story_bible.get("scenes"), "scene_id", scene_ref) or {}
    lock = scene.get("visual_lock") if isinstance(scene.get("visual_lock"), dict) else {}
    psb_scene = _find(psb.get("scenes"), "scene_id", scene_ref) or {}
    production = psb_scene.get("production_visual") if isinstance(psb_scene.get("production_visual"), dict) else {}

    def raw_field(name: str) -> str:
        hard = lock.get(name)
        if isinstance(hard, str) and hard.strip():
            return hard.strip()
        return _entry_value(production.get(name))

    parts: list[str] = []
    space = _clean_scene_asset_text(raw_field("space"), field_name="space")
    if space:
        parts.append(space)

    context = _semantic_context_for_scene_selection(shot, semantics, story_bible)
    sublocation = ""
    scene_name = str(scene.get("canonical_name") or scene.get("name") or "")
    for field in ("layout", "materials", "environment"):
        for fragment in _clean_scene_fragments(raw_field(field), field_name=field):
            if _scene_fragment_relevant(fragment, context) and fragment not in parts:
                parts.append(fragment)
                if (
                    field == "environment"
                    and not sublocation
                    and fragment not in scene_name
                    and any(token in fragment for token in ("店", "门口", "街", "路", "走廊", "房", "厅", "站", "桥", "院", "楼", "车厢", "月台", "广场", "公园"))
                ):
                    sublocation = fragment
                if len(parts) >= 4:
                    break
        if len(parts) >= 4:
            break

    lighting = _clean_scene_asset_text(raw_field("lighting"), field_name="lighting")
    color = _clean_scene_asset_text(raw_field("color"), field_name="color")
    for value in (lighting, color):
        if value and value not in parts:
            parts.append(value)

    return "；".join(parts[:5]), sublocation



def _daypart_class(value: str) -> str:
    text = str(value or "")
    if any(token in text for token in ("深夜", "夜晚", "夜间", "月光", "夜色", "凌晨")):
        return "night"
    if any(token in text for token in ("傍晚", "黄昏", "夕阳", "夕照", "余晖", "暮光", "日落")):
        return "evening"
    if any(token in text for token in ("清晨", "早晨", "晨光", "日出", "上午")):
        return "morning"
    if any(token in text for token in ("中午", "正午")):
        return "noon"
    if "下午" in text:
        return "afternoon"
    return ""


def _state_lighting_compatible(time_label: str, lighting: str) -> bool:
    current = _daypart_class(time_label)
    baseline = _daypart_class(lighting)
    if not current or not baseline:
        return True
    return current == baseline


def _compact_scene_color_anchor(value: str) -> str:
    """Keep one deterministic综合色调 and drop plot-prop color accents."""
    text = str(value or "").strip(" ，,；;。")
    if not text:
        return ""
    # Remove only a complete leading time/light genitive; never leave residue
    # such as “的暖橙色调”.
    text = _strip_time_bound_modifier(text, lighting=False) or text
    text = re.sub(r"^的+", "", text).strip()
    text = re.sub(r"^整体以", "", text)
    primary = re.split(r"(?:为主|，点缀|,点缀|；点缀|;点缀)", text, maxsplit=1)[0]
    parts = [x.strip() for x in re.split(r"[、，,与和]", primary) if x.strip()]
    if not parts:
        return ""
    chosen = parts[:2]
    return "、".join(chosen) + ("为主" if len(chosen) >= 1 else "")


def _scene_continuity_anchor_v2f(
    story_bible: dict[str, Any],
    psb: dict[str, Any],
    shot: dict[str, Any],
    semantics: dict[str, Any],
    *,
    time_label: str = "",
) -> tuple[str, str, str, dict[str, Any]]:
    """Return effective stable anchor, state anchor and active spatial context.

    v2g preserves the root canonical scene as provenance, but when a Shot is
    explicitly inside a transformed/active sublocation (e.g. an old shop now being
    another business) the *rendered* scene identity/anchor must follow that active
    context instead of repeating landmarks from the root scene.
    """
    scene_ref = str(shot.get("location_ref") or "")
    record = _canonical_scene_asset_record(story_bible, psb, scene_ref)
    stable = record.get("stable") or {}
    state_baseline = record.get("state_baseline") or {}
    spatial_state = str(state_baseline.get("spatial_state") or "").strip()
    context = _semantic_context_for_scene_selection(shot, semantics, story_bible)
    scene_name = str(record.get("canonical_name") or "")

    layout_parts = _clean_scene_fragments(str(stable.get("layout") or ""), field_name="layout")
    environment_parts = _clean_scene_fragments(str(stable.get("environment") or ""), field_name="environment")
    space_parts = _clean_scene_fragments(str(stable.get("space") or ""), field_name="space")

    # Resolve the current spatial context before selecting the repeated anchor.
    sublocation = ""
    state_spatial_fragments = [x.strip() for x in re.split(r"[；;]", spatial_state) if x.strip()]
    for fragment in state_spatial_fragments:
        if _scene_fragment_relevant(fragment, context) and any(token in fragment for token in ("店", "门口", "街", "路", "房", "厅", "楼", "站", "院", "病房", "车厢")):
            sublocation = fragment
            break
    if not sublocation:
        for fragment in layout_parts + environment_parts:
            if (
                _scene_fragment_relevant(fragment, context)
                and fragment not in scene_name
                and any(token in fragment for token in ("店", "门口", "街", "路", "走廊", "房", "厅", "站", "桥", "院", "楼", "车厢", "月台", "广场", "公园", "抽屉", "柜", "床", "窗"))
            ):
                sublocation = fragment
                break

    replacement_context = bool(
        sublocation
        and re.search(r"(?:现在|如今|目前|现为|变成|改成|旧址)", sublocation)
        and any(token in sublocation for token in ("店", "房", "厅", "站", "楼", "院", "病房"))
    )

    stable_candidates: list[str] = []
    if replacement_context:
        # The active transformed place itself is the minimum standalone identity.
        stable_candidates.append(_natural_sublocation_label(sublocation))
        # Once the effective transformed sublocation is resolved, its stable
        # anchor must no longer depend on shot-specific blocking/action text.
        # Only canonical fragments that describe that same sublocation may join.
        anchor_context = _natural_sublocation_label(sublocation)
        relevant = [
            fragment for fragment in layout_parts + environment_parts
            if fragment != sublocation and _scene_fragment_relevant(fragment, anchor_context)
        ]
        stable_candidates.extend(relevant[:2])
    else:
        if space_parts:
            stable_candidates.append(space_parts[0])
        stable_candidates.extend(layout_parts[:2])
        if len(stable_candidates) < 3:
            stable_candidates.extend(environment_parts[: 3 - len(stable_candidates)])

    color = _compact_scene_color_anchor(str(stable.get("color") or ""))
    if color and (not replacement_context or _scene_fragment_relevant(color, _natural_sublocation_label(sublocation))):
        stable_candidates.append(color)
    stable_anchor = "；".join(_dedupe_stable_clauses(stable_candidates)[:4])

    state_candidates: list[str] = []
    if time_label:
        state_candidates.append(time_label)
    lighting = str(state_baseline.get("lighting") or "").strip()
    lighting_states = [str(x) for x in (state_baseline.get("lighting_states") or []) if str(x).strip()]
    if lighting and _state_lighting_compatible(time_label, lighting):
        state_candidates.append(lighting)
    matching_lighting = [x for x in lighting_states if _state_lighting_compatible(time_label, x)]
    if matching_lighting:
        # Prefer the phase-light clause that is actually relevant to this active
        # Shot context (e.g. indoor shop light over outdoor root-scene light).
        matching_lighting.sort(key=lambda x: (not _scene_fragment_relevant(x, context), len(x)))
        state_candidates.append(matching_lighting[0])
    elif not time_label and not lighting and lighting_states:
        state_candidates.append(lighting_states[0])
    if spatial_state and _scene_fragment_relevant(spatial_state, context):
        state_candidates.append(spatial_state)
    state_anchor = "；".join(_dedupe_stable_clauses(state_candidates)[:3])
    return stable_anchor, state_anchor, sublocation, record

def _text_constraint_v2d(semantics: dict[str, Any]) -> str:
    required = []
    for item in semantics.get("diegetic_text", []) or []:
        if not isinstance(item, dict) or item.get("required_visible") is not True:
            continue
        content = str(item.get("content") or "").strip()
        if content and content not in required:
            required.append(content)
    if required:
        return "仅允许剧情明确要求的画面内文字" + "、".join(f"“{x}”" for x in required) + "；禁止新增其他字幕、水印或乱码文字"
    return "无字幕、水印或无依据文字"


def _english_output_issue(*, detail: str, source_layer: str, source_ref: str) -> dict[str, Any]:
    if "Director" in source_layer:
        suggested = "回到导演执行，把 performance_actions.action 修复为简体中文；不得在最终提示词中保留英文 fallback。"
    elif "Storyboard" in source_layer or "ShotSpec" in source_layer:
        suggested = "回到基础分镜，把 composition / description 修复为简体中文后重新进入导演执行与编译。"
    else:
        suggested = "检查该来源字段，补齐中文表达后重新编译；消费层不会直接输出英文。"
    return {
        "code": "E007_NON_CHINESE_OUTPUT",
        "label": ERROR_LABELS["E007_NON_CHINESE_OUTPUT"],
        "detail": detail,
        "source_layer": source_layer,
        "source_layer_label": (
            "导演执行" if "Director" in source_layer else
            "基础分镜 / 镜头规格" if ("Storyboard" in source_layer or "ShotSpec" in source_layer) else
            "消费编译器"
        ),
        "source_ref": source_ref,
        "suggested_fix": suggested,
    }


def _non_chinese_source_errors(shot: dict[str, Any]) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    for field in ("composition", "description"):
        value = str(shot.get(field) or "")
        if _contains_latin(value):
            errors.append(_english_output_issue(
                detail=f"当前镜头 {field} 含英文文本，消费编译器不会直接输出英文。",
                source_layer="Storyboard Base / ShotSpec",
                source_ref=f"shots[{shot.get('shot_id')}].{field}",
            ))
    director = shot.get("director") or {}
    for index, action in enumerate(director.get("performance_actions", []) or []):
        if not isinstance(action, dict):
            continue
        value = str(action.get("action") or "")
        if _contains_latin(value):
            errors.append(_english_output_issue(
                detail="导演表演动作含英文文本，消费编译器不会与中文对白混合输出。",
                source_layer="Director",
                source_ref=f"shots[{shot.get('shot_id')}].director.performance_actions[{index}].action",
            ))
    focus = director.get("visual_focus") if isinstance(director, dict) else {}
    for index, environment_key in enumerate((focus or {}).get("environment_keys", []) or []):
        value = str(environment_key or "")
        if _contains_latin(value):
            errors.append(_english_output_issue(
                detail="导演环境焦点含英文文本；该字段会直接进入最终提示词，消费编译器已阻断输出。",
                source_layer="Director",
                source_ref=f"shots[{shot.get('shot_id')}].director.visual_focus.environment_keys[{index}]",
            ))
    return errors


def _blocked_result(common: dict[str, Any]) -> dict[str, Any]:
    errors = common.get("errors") or []
    primary = errors[0] if errors else {}
    return {
        **common,
        "compile_status": "blocked",
        "prompt_seedance": None,
        "prompt_segments": [],
        "consumption_view": {"compiler_version": COMPILER_VERSION, "blocked": True},
        "prompt_metrics": {"char_count": 0},
        "source_layer": primary.get("source_layer", ""),
        "source_layer_label": primary.get("source_layer_label", ""),
        "suggested_fix": primary.get("suggested_fix", ""),
    }


def compile_character_consumption_prompt(
    story_bible: dict[str, Any], pvb: dict[str, Any], style_guide: dict[str, Any], char_id: str
) -> dict[str, Any]:
    story_char = _find(story_bible.get("characters"), "character_id", char_id)
    if not story_char:
        raise ValueError(f"invalid character_id: {char_id}")
    pvb_char = _find(pvb.get("characters"), "character_id", char_id)
    if not pvb_char and story_char.get("role_type") not in {"main", "supporting"}:
        raise ValueError(f"{char_id} has no production PVB and does not require a character asset prompt")
    warnings: list[dict[str, Any]] = []
    record = _canonical_character_asset_record(story_bible, pvb, char_id, warnings)
    identity = record.get("identity") or {}
    wardrobe = record.get("wardrobe") or {}

    sections = [f"角色资产：{record.get('canonical_name') or char_id}"]
    identity_values = [str(identity.get(k) or "") for k in ("age_appearance", "face", "hair", "body", "skin") if identity.get(k)]
    if identity_values:
        sections.append("人物锁定：\n" + "；".join(identity_values) + "。")

    base_values: list[str] = []
    for field in ("shirt", "default", "footwear", "accessory"):
        value = str(wardrobe.get(field) or "").strip()
        if value:
            base_values.append(value)
    base_values = _dedupe_stable_clauses(base_values)
    if base_values:
        sections.append("基础服装：\n" + "；".join(base_values) + "。")
    outer = str(wardrobe.get("outerwear") or "").strip()
    if outer:
        sections.append("外层服装：\n" + outer.rstrip("。") + "。")
    phase_wardrobe = str(record.get("phase_wardrobe") or "").strip()
    if phase_wardrobe:
        sections.append("阶段服装：\n" + phase_wardrobe.rstrip("。") + "。")

    style = _style_summary_cn(style_guide)
    if style:
        sections.append("视觉基调：\n" + style + "。")
    sections.append("保持：\n脸型、发型、体型比例和年龄感稳定；保持当前锁定服装与真实皮肤、衣物材质；不新增角色身份、人物关系或剧情动作；避免网红脸、过度妆容和过度磨皮。")
    return {
        "character_id": char_id,
        "canonical_name": record.get("canonical_name") or char_id,
        "compiler_version": ASSET_COMPILER_VERSION,
        "asset_registry_version": ASSET_REGISTRY_VERSION,
        "asset_hash": _asset_record_hash(record),
        "canonical_asset": copy.deepcopy(record),
        "prompt_gpt_image": "\n\n".join(sections),
        "warnings": warnings,
    }


def compile_scene_consumption_prompt(
    story_bible: dict[str, Any], psb: dict[str, Any], style_guide: dict[str, Any], scene_id: str
) -> dict[str, Any]:
    scene = _find(story_bible.get("scenes"), "scene_id", scene_id)
    if not scene:
        raise ValueError(f"invalid scene_id: {scene_id}")
    record = _canonical_scene_asset_record(story_bible, psb, scene_id)
    stable = record.get("stable") or {}
    state = record.get("state_baseline") or {}
    warnings: list[dict[str, Any]] = []

    name = record.get("canonical_name") or scene_id
    sections = [f"场景资产：{name}"]
    used: list[str] = []

    def unique_group(values: list[str]) -> list[str]:
        candidates: list[str] = []
        for value in values:
            candidates.extend([x.strip() for x in re.split(r"[；;]", str(value or "")) if x.strip()])
        merged = _dedupe_stable_clauses(used + candidates)
        prior_keys = {_normalized_clause_key(y) for y in used}
        fresh = [x for x in merged if _normalized_clause_key(x) not in prior_keys]
        used.extend(fresh)
        return fresh

    spatial_parts = unique_group([str(stable.get("space") or ""), str(stable.get("layout") or "")])
    if spatial_parts:
        sections.append("空间结构：\n" + "；".join(spatial_parts).rstrip("。") + "。")
    fixed_parts = unique_group([str(stable.get("materials") or ""), str(stable.get("environment") or "")])
    if fixed_parts:
        sections.append("材质与固定环境：\n" + "；".join(fixed_parts).rstrip("。") + "。")
    color_parts = unique_group([str(stable.get("color") or "")])
    if color_parts:
        sections.append("基础配色：\n" + "；".join(color_parts).rstrip("。") + "。")
    lighting = str(state.get("lighting") or "").strip()
    lighting_states = [str(x) for x in (state.get("lighting_states") or []) if str(x).strip()]
    if lighting:
        sections.append("状态光线基线：\n" + lighting.rstrip("。") + "。当前镜头时间/天气变化由 Scene State 覆盖，不把该光线视为永久空间结构。")
    elif not lighting_states:
        warnings.append({"code": "W002_MISSING_LIGHTING", "label": WARNING_LABELS["W002_MISSING_LIGHTING"], "detail": "场景没有可消费的状态光照基线或时段光照状态。", "source_layer": "Story Bible / PSB", "source_ref": f"scenes[{scene_id}]"})
    if not stable.get("color"):
        warnings.append({"code": "W001_MISSING_COLOR", "label": WARNING_LABELS["W001_MISSING_COLOR"], "detail": "场景没有锁定的静态配色；消费编译器不自行补色。", "source_layer": "Story Bible / PSB", "source_ref": f"scenes[{scene_id}]"})
    style = _style_summary_cn(style_guide)
    if style:
        sections.append("视觉基调：\n" + style + "。")

    stable_text = "；".join(str(v) for v in stable.values() if v)
    text_bearing = any(token in stable_text for token in ("灯箱", "招牌", "店招", "菜单", "屏幕", "海报", "牌匾"))
    text_rule = "允许已锁定的灯箱、招牌、菜单板等文字载体结构存在，但原文未提供的具体文字必须模糊或不可辨识；" if text_bearing else ""
    sections.append("保持：\n不新增人物、剧情事件或剧情关键道具；" + text_rule + "不添加无依据的品牌、标志、店招文案或可阅读文字；保持已锁定空间结构和真实材质，避免商业广告式过度精修。")
    return {
        "scene_id": scene_id,
        "scene_name": name,
        "compiler_version": ASSET_COMPILER_VERSION,
        "asset_registry_version": ASSET_REGISTRY_VERSION,
        "asset_hash": _asset_record_hash(record),
        "canonical_asset": copy.deepcopy(record),
        "prompt_gpt_image": "\n\n".join(sections),
        "warnings": warnings,
    }


def _script_scene(script: dict[str, Any], scene_id: str) -> dict[str, Any]:
    return _find(script.get("scenes"), "scene_id", scene_id) or {}


def _time_label(shot: dict[str, Any], script: dict[str, Any]) -> str:
    scene = _script_scene(script, str(shot.get("scene_id") or ""))
    heading = str(scene.get("scene_heading") or "")
    # Scene headings are model-authored but frozen before compilation. Extract only
    # broad temporal labels; do not infer a time that the Script did not provide.
    daypart = r"(?:天快亮时|凌晨|深夜|夜里|夜晚|晚上|清晨|早晨|上午|中午|下午|傍晚|黄昏|白天)"
    patterns = [
        rf"第[一二三四五六七八九十百\d]+天\s*{daypart}",
        rf"(?:次日|翌日|第二天|当天|当日)\s*{daypart}",
        r"凌晨[一二三四五六七八九十百\d]+点(?:半)?",
        daypart,
    ]
    for pattern in patterns:
        hit = re.search(pattern, heading)
        if hit:
            return re.sub(r"\s+", "", hit.group(0)).replace("天快亮了", "天快亮时")
    return ""


def _story_scene(story_bible: dict[str, Any], scene_id: str) -> dict[str, Any]:
    return _find(story_bible.get("scenes"), "scene_id", scene_id) or {}


def _char_name(story_bible: dict[str, Any], cid: str) -> str:
    item = _find(story_bible.get("characters"), "character_id", cid)
    return str((item or {}).get("canonical_name") or cid)


def _prop_name(story_bible: dict[str, Any], pid: str) -> str:
    item = _find(story_bible.get("props"), "prop_id", pid)
    return str((item or {}).get("canonical_name") or (item or {}).get("name") or pid)


def _current_outerwear(story_char: dict[str, Any], time_label: str) -> str:
    raw = str((story_char.get("visual_lock") or {}).get("outerwear") or "")
    if not raw:
        return ""
    clauses = [x.strip() for x in re.split(r"[；;]", raw) if x.strip()]
    if time_label:
        for clause in clauses:
            if time_label in clause:
                tail = clause.split(time_label, 1)[1]
                tail = re.sub(r"^(?:换成|改穿|穿着|穿|为|：|:)+", "", tail).strip("：: ，,")
                if tail:
                    return tail
    for clause in clauses:
        if re.match(r"^(?:首次|初始|默认|起初|第一次)", clause):
            return re.sub(r"^(?:首次出现|首次|初始|默认|起初|第一次)(?:为|穿着|穿|：|:)?", "", clause).strip("：: ，,")
    if len(clauses) == 1 and not _TEMPORAL_RE.search(clauses[0]):
        return clauses[0]
    return ""


def _visible_state_value(key: str, value: Any, story_bible: dict[str, Any]) -> str:
    if value in (None, "", False):
        return ""
    if key in _STANDARD_STATE_TEXT_FIELDS:
        raw = str(value)
        return raw if _has_chinese(raw) and not _contains_latin(raw) else ""
    if key in {"prop_in_hand", "held_prop_refs"}:
        if value == "无":
            return ""
        values = value if isinstance(value, list) else [value]
        names = [_prop_name(story_bible, str(x)) for x in values]
        names = [x for x in names if x and not _contains_latin(x)]
        return "手持" + "、".join(names) if names else ""
    return ""


def _state_lines(shot: dict[str, Any], story_bible: dict[str, Any], script: dict[str, Any]) -> list[str]:
    time_label = _time_label(shot, script)
    state = shot.get("state_in") or {}
    lines: list[str] = []
    for cid in shot.get("character_refs", []) or []:
        cstate = ((state.get("characters") or {}).get(cid) or {})
        story_char = _find(story_bible.get("characters"), "character_id", str(cid)) or {}
        name = _char_name(story_bible, str(cid))
        position = _visible_state_value("position", cstate.get("position"), story_bible)
        posture = _visible_state_value("posture", cstate.get("posture"), story_bible)
        position = re.sub(r"^在", "", position).strip() if position else ""

        sentence = name
        has_meaningful_state = False
        if position and posture:
            sentence += f"在{position}{posture}"
            has_meaningful_state = True
        elif posture:
            sentence += posture
            has_meaningful_state = True
        elif position:
            sentence += f"在{position}"

        extras: list[str] = []
        for key in ("gaze_target", "facial_expression", "head_orientation", "reaction", "action", "action_state", "speaking", "prop_in_hand", "held_prop_refs"):
            if key not in cstate:
                continue
            value = _visible_state_value(key, cstate.get(key), story_bible)
            if not value:
                continue
            if key == "gaze_target" and not re.search(r"(?:看|望|注视|视线)", value):
                value = "看向" + value
            if value not in extras:
                extras.append(value)
                has_meaningful_state = True
        outer = _current_outerwear(story_char, time_label)
        if outer:
            extras.append("穿着" + outer)
            has_meaningful_state = True
        if not has_meaningful_state:
            continue
        if extras:
            sentence += "，" + "，".join(extras)
        lines.append(sentence)
    return lines


def _dialogue_line_text(line: str) -> str:
    return re.sub(r"^[“\"']|[”\"']$", "", str(line or "").strip())


_SPEECH_VERBS = ("询问", "回答", "回应", "告诉", "表示", "说明", "解释", "讲述", "提到", "说出", "问", "说")


def _norm_semantic_text(value: Any) -> str:
    return re.sub(r"[\s\u3000，。！？；：、“”‘’（）()\[\]{}<>《》,.!?;:'\"`~_-]+", "", str(value or ""))


def _strip_dialogue_semantic_restatement(cue: str, lines: list[str]) -> str:
    normalized_lines = [_norm_semantic_text(x) for x in lines if _norm_semantic_text(x)]
    if not normalized_lines:
        return cue
    for verb in _SPEECH_VERBS:
        pos = cue.find(verb)
        if pos < 0:
            continue
        tail = cue[pos + len(verb):].strip("，,；;：: 。")
        if not tail:
            continue
        tail_norm = _norm_semantic_text(tail)
        if not tail_norm:
            continue
        matched = False
        for line in normalized_lines:
            if tail_norm in line or line in tail_norm:
                matched = True
                break
            if min(len(tail_norm), len(line)) >= 2 and SequenceMatcher(None, tail_norm, line).ratio() >= 0.62:
                matched = True
                break
        if not matched:
            continue
        prefix = cue[:pos].strip("，,；;：: 。")
        if verb in {"问", "询问"}:
            minimal = "问"
        elif verb in {"回答", "回应"}:
            minimal = "回答"
        else:
            minimal = "说"
        return (prefix + minimal).strip("，,；;：: 。")
    return cue


def _clean_speaking_cue(action: str, lines: list[str]) -> str:
    cue = _strip_quoted_text(str(action or ""))
    cue = re.sub(r"说出(?:第[一二三四五六七八九十\d]+句)?(?:台词)?[：:]?.*$", "", cue)
    if "讲述" in cue:
        cue = cue.split("讲述", 1)[0]
    cue = re.sub(r"(?:随后继续)?说话$", "", cue)
    cue = re.sub(r"(?:随后继续)?说[^，。；;]*$", "", cue)
    for line in lines:
        clean_line = _dialogue_line_text(line)
        if clean_line:
            cue = cue.replace(clean_line, "")
    cue = cue.strip("，,；;：: 。")
    return _strip_dialogue_semantic_restatement(cue, lines)


def _speaker_line_block(lines: list[str]) -> str:
    cleaned = [_dialogue_line_text(x) for x in lines if _dialogue_line_text(x)]
    if not cleaned:
        return ""
    if len(cleaned) == 1:
        return f"“{cleaned[0]}”"
    first, rest = cleaned[0], cleaned[1:]
    text = f"“{first}”"
    for item in rest:
        text += f"，停顿一下，又说：“{item}”"
    return text


def _action_text(shot: dict[str, Any], story_bible: dict[str, Any], time_label: str = "", scene_name: str = "") -> str:
    director = shot.get("director") or {}
    actions = [x for x in director.get("performance_actions", []) or [] if isinstance(x, dict)]
    dialogue = [x for x in shot.get("dialogue", []) or [] if isinstance(x, dict) and (x.get("line") or x.get("text"))]
    desc = _strip_redundant_prefix(str(shot.get("description") or "").strip(), time_label, scene_name)
    if not dialogue:
        if not desc or _is_narrative_summary_text(desc) or _is_non_visual_action_text(desc):
            return ""
        return desc.rstrip("。") + "。"

    speaker_ids = [str(x.get("character_id") or "") for x in dialogue]
    parts: list[str] = []
    for cid in list(dict.fromkeys(speaker_ids)):
        lines = [str(x.get("line") or x.get("text") or "") for x in dialogue if str(x.get("character_id") or "") == cid]
        action = next((str(x.get("action") or "") for x in actions if str(x.get("character_ref") or "") == cid), "")
        name = _char_name(story_bible, cid)
        cue = _clean_speaking_cue(action, lines)
        quoted = _speaker_line_block(lines)
        if cue:
            if any(cue.endswith(token) for token in ("问", "问道", "回答", "回道", "提醒", "低声说", "轻声说", "开口")):
                parts.append(f"{name}{cue}：{quoted}")
            else:
                parts.append(f"{name}{cue}，说：{quoted}")
        else:
            parts.append(f"{name}说：{quoted}")

    for action in actions:
        cid = str(action.get("character_ref") or "")
        if cid in speaker_ids:
            continue
        text = _clean_speaking_cue(str(action.get("action") or ""), [])
        text = _strip_redundant_prefix(text, time_label, scene_name).strip().rstrip("。")
        if not text or _is_narrative_summary_text(text):
            continue
        state_texts = []
        cstate = (((shot.get("state_in") or {}).get("characters") or {}).get(cid) or {})
        state_texts.extend(str(v) for v in cstate.values() if v not in (None, "", False))
        inherited = any(text in v or v in text for v in state_texts if _has_chinese(v))
        prefix = "仍" if inherited else ""
        parts.append(f"{_char_name(story_bible, cid)}{prefix}{text}")
    if not parts:
        return ""
    text = "；".join(parts).rstrip("。")
    if re.search(r"[。！？!?]”$", text):
        return text
    return text + "。"


def _scene_light_text(shot: dict[str, Any], story_bible: dict[str, Any], script: dict[str, Any]) -> str:
    parts: list[str] = []
    environment = (shot.get("state_in") or {}).get("environment") or {}
    for value in environment.values():
        if not isinstance(value, str):
            continue
        clean = value.strip()
        if clean and _has_chinese(clean) and not _contains_latin(clean) and not _is_non_visual_action_text(clean):
            parts.append(clean)
    return "；".join(dict.fromkeys(parts))


def _segment(segment_id: str, kind: str, text: str, sources: list[dict[str, str]]) -> dict[str, Any]:
    return {"segment_id": segment_id, "type": kind, "text": text, "sources": sources}


def compile_shot_consumption_prompt_v1(
    shot: dict[str, Any], story_bible: dict[str, Any], script: dict[str, Any], pvb: dict[str, Any], psb: dict[str, Any], style_guide: dict[str, Any], *, aspect_ratio: str = "9:16"
) -> dict[str, Any]:
    sid = str(shot.get("shot_id") or "")
    errors, warnings = lint_shot(shot, story_bible, style_guide)
    errors.extend(_non_chinese_source_errors(shot))
    common = {
        "shot_id": sid,
        "scene_id": shot.get("scene_id"),
        "context_ref": shot.get("context_ref", ""),
        "beat_id": shot.get("beat_id"),
        "compiler_version": COMPILER_VERSION,
        "errors": errors,
        "warnings": warnings,
        "resolved_refs": {
            "scene": shot.get("location_ref"),
            "characters": list(shot.get("character_refs", []) or []),
            "props": list(shot.get("prop_refs", []) or []),
        },
    }
    if errors:
        return _blocked_result(common)

    scene = _story_scene(story_bible, str(shot.get("location_ref") or ""))
    scene_name = str(scene.get("canonical_name") or scene.get("name") or shot.get("location_ref") or "")
    time_label = _time_label(shot, script)
    segments: list[dict[str, Any]] = []

    header_parts = [f"{shot.get('duration', ''):g}秒" if isinstance(shot.get("duration"), (int, float)) else f"{shot.get('duration', '')}秒", f"{aspect_ratio}竖屏"]
    if time_label:
        header_parts.append(time_label)
    if scene_name:
        header_parts.append(scene_name)
    header = "，".join(header_parts) + "。"
    segments.append(_segment(f"{sid}.header", "header", header, [{"source": "shotspec", "source_ref": f"shots[{sid}].duration"}]))

    camera = "镜头：" + "，".join(filter(None, [SHOT_SIZE.get(str(shot.get("shot_size")), ""), CAMERA.get(str(shot.get("camera")), ""), MOVEMENT.get(str(shot.get("movement")), "")]))
    comp = str(shot.get("composition") or "").strip().rstrip("。")
    if comp:
        camera += "；构图：" + comp
    camera += "。"
    segments.append(_segment(f"{sid}.camera", "camera", camera, [{"source": "shotspec", "source_ref": f"shots[{sid}].camera"}]))

    states = _state_lines(shot, story_bible, script)
    if states:
        text = "开始状态：" + "；".join(states) + "。"
        segments.append(_segment(f"{sid}.state", "state", text, [{"source": "state_resolver", "source_ref": f"shots[{sid}].state_in"}]))

    action = _action_text(shot, story_bible, time_label, scene_name)
    if action:
        segments.append(_segment(f"{sid}.action", "action", "动作与互动：" + action, [{"source": "shotspec/director", "source_ref": f"shots[{sid}]"}]))

    light = _scene_light_text(shot, story_bible, script)
    if light:
        segments.append(_segment(f"{sid}.lighting", "scene_visual", "场景与光线：" + light.rstrip("。") + "。", [{"source": "story_bible", "source_ref": f"scenes[{shot.get('location_ref')}].visual_lock"}]))

    constraints = "约束：保持人物外观、当前服装和空间关系连续；允许自然眨眼、呼吸与轻微重心变化，但不新增改变剧情含义的动作；画面无字幕、水印或额外可阅读文字，不新增人物或对白。"
    segments.append(_segment(f"{sid}.constraints", "platform_constraint", constraints, [{"source": "platform_constraint", "source_ref": "seedance.consumption_v1"}]))

    prompt = "\n\n".join(x["text"] for x in segments if x.get("text"))
    if _contains_latin(prompt):
        errors.append(_english_output_issue(
            detail="最终提示词仍含英文字母，消费编译器已阻断输出，避免中英混杂进入视频模型。",
            source_layer="Consumption Compiler",
            source_ref=f"shots[{sid}].prompt_seedance",
        ))
        common["errors"] = errors
        common["warnings"] = warnings
        return _blocked_result(common)
    if len(prompt) > 450:
        warnings.append({
            "code": "W005_PROMPT_LENGTH_HIGH", "label": WARNING_LABELS["W005_PROMPT_LENGTH_HIGH"],
            "detail": f"最终提示词 {len(prompt)} 字，建议检查是否仍存在重复信息或上下文税。",
            "source_layer": "Consumption Compiler", "source_ref": f"shots[{sid}]",
        })
    status_warning_codes = {"W001_MISSING_COLOR", "W002_MISSING_LIGHTING", "W003_DURATION_RISK", "W004_STYLE_PSB_DRIFT", "W005_PROMPT_LENGTH_HIGH", "W006_VISUAL_FOCUS_CONFLICT"}
    status = "warning" if any(w.get("code") in status_warning_codes for w in warnings) else "ok"
    return {
        **common,
        "warnings": warnings,
        "compile_status": status,
        "prompt_seedance": prompt,
        "prompt_segments": segments,
        "consumption_view": {
            "compiler_version": COMPILER_VERSION,
            "selected": {
                "current_characters": list(shot.get("character_refs", []) or []),
                "current_props": list(shot.get("prop_refs", []) or []),
                "time_label": time_label,
                "visual_focus": (shot.get("director") or {}).get("visual_focus") or {},
            },
        },
        "prompt_metrics": {"char_count": len(prompt)},
    }


def compile_project_consumption_v1(
    project_id: str,
    story_bible: dict[str, Any],
    script: dict[str, Any],
    pvb: dict[str, Any],
    psb: dict[str, Any],
    style_guide: dict[str, Any],
    shot_specs: list[dict[str, Any]],
) -> dict[str, Any]:
    character_prompts: list[dict[str, Any]] = []
    scene_prompts: list[dict[str, Any]] = []
    shot_prompts: list[dict[str, Any]] = []
    compile_failures: list[dict[str, Any]] = []

    for char in story_bible.get("characters", []) or []:
        if char.get("role_type") not in {"main", "supporting"}:
            continue
        try:
            character_prompts.append(compile_character_consumption_prompt(story_bible, pvb, style_guide, str(char.get("character_id"))))
        except Exception as exc:
            compile_failures.append({"target_type": "character", "target_id": char.get("character_id"), "detail": str(exc)})
    for scene in story_bible.get("scenes", []) or []:
        try:
            scene_prompts.append(compile_scene_consumption_prompt(story_bible, psb, style_guide, str(scene.get("scene_id"))))
        except Exception as exc:
            compile_failures.append({"target_type": "scene", "target_id": scene.get("scene_id"), "detail": str(exc)})
    for shot in shot_specs:
        try:
            shot_prompts.append(compile_shot_consumption_prompt_v1(shot, story_bible, script, pvb, psb, style_guide))
        except Exception as exc:
            compile_failures.append({"target_type": "shot", "target_id": shot.get("shot_id"), "detail": str(exc)})
            shot_prompts.append({
                "shot_id": shot.get("shot_id"), "scene_id": shot.get("scene_id"), "beat_id": shot.get("beat_id"),
                "compiler_version": COMPILER_VERSION, "compile_status": "blocked", "prompt_seedance": None,
                "errors": [{"code": "E004_HARD_FACT_CONFLICT", "label": "编译异常", "detail": str(exc), "source_layer": "Consumption Compiler", "source_layer_label": "消费编译器", "source_ref": f"shots[{shot.get('shot_id')}]", "suggested_fix": "检查消费编译器异常详情；不要跳过该镜头，修复后重新编译。"}],
                "source_layer": "Consumption Compiler", "source_layer_label": "消费编译器", "suggested_fix": "检查消费编译器异常详情；不要跳过该镜头，修复后重新编译。",
                "warnings": [], "prompt_segments": [], "prompt_metrics": {"char_count": 0},
            })

    # Timeline is derived from frozen ShotSpec durations; compilation failures do not
    # change later Shot numbering/timing.
    # (elapsed_seconds above is only the current start, so recompute sequential starts
    # in the call loop by adding each duration at the bottom of each iteration.)
    blocked = sum(1 for x in shot_prompts if x.get("compile_status") == "blocked")
    warned = sum(1 for x in shot_prompts if x.get("compile_status") == "warning")
    asset_warnings: list[dict[str, Any]] = []
    for item in character_prompts:
        asset_warnings.extend(dict(w, target_type="character", target_id=item.get("character_id")) for w in item.get("warnings", []) or [])
    for item in scene_prompts:
        asset_warnings.extend(dict(w, target_type="scene", target_id=item.get("scene_id")) for w in item.get("warnings", []) or [])
    if blocked:
        compile_status = "partial_blocked"
    elif warned or asset_warnings:
        compile_status = "warning"
    else:
        compile_status = "ok"
    aggregated_warnings = asset_warnings + [dict(w, target_type="shot", target_id=x.get("shot_id"), shot_id=x.get("shot_id")) for x in shot_prompts for w in x.get("warnings", []) or []]
    return {
        "project_id": project_id,
        "mode": "production",
        "compiler_version": COMPILER_VERSION,
        "compile_manifest": {"asset_compiler": ASSET_COMPILER_VERSION, "shot_compiler": COMPILER_VERSION, "lint": LINT_VERSION},
        "compile_status": compile_status,
        "character_prompts": character_prompts,
        "scene_prompts": scene_prompts,
        "shot_prompts": shot_prompts,
        "warnings": aggregated_warnings,
        "compile_failures": compile_failures,
        "summary": {"shots": len(shot_prompts), "ok": sum(1 for x in shot_prompts if x.get("compile_status") == "ok"), "warning": warned, "blocked": blocked},
    }

# ---------------------------------------------------------------------------
# Consumption v2a candidate compiler
# Parallel A/B path only. v1 remains the app-facing compiler until v2b freeze.
# ---------------------------------------------------------------------------

CANDIDATE_COMPILER_VERSION = "consumption_v2a"


def _semantic_action_text_v2a(
    shot: dict[str, Any],
    semantics: dict[str, Any] | None,
    story_bible: dict[str, Any],
    time_label: str,
    scene_name: str,
) -> tuple[str, str, bool]:
    semantics = semantics if isinstance(semantics, dict) else {}
    semantic_dialogue = [x for x in semantics.get("dialogue", []) or [] if isinstance(x, dict) and x.get("line")]
    visual_events = [x for x in semantics.get("visual_events", []) or [] if isinstance(x, dict) and str(x.get("action") or "").strip()]
    choices = [x for x in semantics.get("production_choices", []) or [] if isinstance(x, dict) and str(x.get("choice") or "").strip()]

    # Dialogue shots already flow through Director. Its performance actions are
    # scoped to Production Semantics, so the existing dialogue formatter is safe here.
    if semantic_dialogue:
        temp = dict(shot)
        temp["dialogue"] = [
            {"character_id": x.get("character_id"), "line": x.get("line")}
            for x in semantic_dialogue
        ]
        text = _action_text(temp, story_bible, time_label, scene_name)
        if text:
            return text, "production_semantics", False

    semantic_parts: list[str] = []
    for item in visual_events:
        text = str(item.get("action") or "").strip().rstrip("。")
        if text and text not in semantic_parts:
            semantic_parts.append(text)
    # An approved production choice is an audited staging adaptation. It is allowed
    # only when Production Semantics has already validated no-story-change authority.
    for item in choices:
        text = str(item.get("choice") or "").strip().rstrip("。")
        if text and text not in semantic_parts:
            semantic_parts.append(text)
    if semantic_parts:
        return "；".join(semantic_parts).rstrip("。") + "。", "production_semantics", False

    fallback = _action_text(shot, story_bible, time_label, scene_name)
    return fallback, "legacy_fallback", True


def _appearance_overlay_text_v2a(semantics: dict[str, Any] | None, story_bible: dict[str, Any]) -> str:
    semantics = semantics if isinstance(semantics, dict) else {}
    parts: list[str] = []
    for item in semantics.get("appearance_overlays", []) or []:
        if not isinstance(item, dict):
            continue
        cid = str(item.get("character_ref") or "")
        if not cid:
            continue
        name = _char_name(story_bible, cid)
        overrides = item.get("overrides") or {}
        if not isinstance(overrides, dict):
            continue
        if isinstance(overrides.get("age_appearance"), str) and overrides["age_appearance"].strip():
            parts.append(f"{name}：{overrides['age_appearance'].strip()}")
        if isinstance(overrides.get("temporary_injury"), str) and overrides["temporary_injury"].strip():
            parts.append(f"{name}：{overrides['temporary_injury'].strip()}")
        if isinstance(overrides.get("temporary_clothing_change"), str) and overrides["temporary_clothing_change"].strip():
            parts.append(f"{name}：{overrides['temporary_clothing_change'].strip()}")
    return "；".join(dict.fromkeys(parts))


def _required_diegetic_texts_v2a(semantics: dict[str, Any] | None) -> list[str]:
    semantics = semantics if isinstance(semantics, dict) else {}
    out: list[str] = []
    for item in semantics.get("diegetic_text", []) or []:
        if not isinstance(item, dict) or item.get("required_visible") is not True:
            continue
        content = str(item.get("content") or "").strip()
        if content and content not in out:
            out.append(content)
    return out


def _constraint_text_v2a(semantics: dict[str, Any] | None) -> str:
    required = _required_diegetic_texts_v2a(semantics)
    if required:
        joined = "、".join(f"“{x}”" for x in required)
        text_rule = f"仅允许剧情明确要求的画面内文字{joined}；禁止新增其他字幕、水印、无依据标志或乱码文字"
    else:
        text_rule = "画面无字幕、水印或无依据可阅读文字"
    return (
        "约束：保持人物外观、当前服装和空间关系连续；允许自然眨眼、呼吸与轻微重心变化，"
        f"但不新增改变剧情含义的动作；{text_rule}；不新增人物或对白。"
    )


def _contains_unauthorized_latin_v2a(prompt: str, semantics: dict[str, Any] | None) -> bool:
    text = str(prompt or "")
    for allowed in _required_diegetic_texts_v2a(semantics):
        text = text.replace(allowed, "")
    return _contains_latin(text)


def _non_chinese_source_errors_v2a(
    shot: dict[str, Any], *, action_source: str, uses_director_actions: bool
) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    composition = str(shot.get("composition") or "")
    if _contains_latin(composition):
        errors.append(_english_output_issue(
            detail="当前镜头 composition 含英文文本，消费编译器不会直接输出英文。",
            source_layer="Storyboard Base / ShotSpec",
            source_ref=f"shots[{shot.get('shot_id')}].composition",
        ))
    if action_source == "legacy_fallback":
        description = str(shot.get("description") or "")
        if _contains_latin(description):
            errors.append(_english_output_issue(
                detail="当前镜头 description 含英文文本，且 v2a 仍需使用 v1 fallback，因此已阻断英文输出。",
                source_layer="Storyboard Base / ShotSpec",
                source_ref=f"shots[{shot.get('shot_id')}].description",
            ))
    if uses_director_actions:
        for index, action in enumerate((shot.get("director") or {}).get("performance_actions", []) or []):
            if isinstance(action, dict) and _contains_latin(str(action.get("action") or "")):
                errors.append(_english_output_issue(
                    detail="导演表演动作含英文文本，消费编译器不会与中文对白混合输出。",
                    source_layer="Director",
                    source_ref=f"shots[{shot.get('shot_id')}].director.performance_actions[{index}].action",
                ))
    return errors


def _blocked_result_v2a(common: dict[str, Any]) -> dict[str, Any]:
    out = _blocked_result(common)
    out["compiler_version"] = CANDIDATE_COMPILER_VERSION
    out.setdefault("consumption_view", {})["compiler_version"] = CANDIDATE_COMPILER_VERSION
    return out


def compile_shot_consumption_prompt_v2a(
    shot: dict[str, Any],
    production_semantics: dict[str, Any] | None,
    story_bible: dict[str, Any],
    script: dict[str, Any],
    pvb: dict[str, Any],
    psb: dict[str, Any],
    style_guide: dict[str, Any],
    *,
    aspect_ratio: str = "9:16",
) -> dict[str, Any]:
    """Parallel candidate compiler. Production v1 remains authoritative in Patch 07."""
    sid = str(shot.get("shot_id") or "")
    semantics = production_semantics if isinstance(production_semantics, dict) else {}
    scene = _story_scene(story_bible, str(shot.get("location_ref") or ""))
    scene_name = str(scene.get("canonical_name") or scene.get("name") or shot.get("location_ref") or "")
    time_label = _time_label(shot, script)
    action, action_source, fallback_used = _semantic_action_text_v2a(shot, semantics, story_bible, time_label, scene_name)
    uses_director_actions = bool(semantics.get("dialogue"))

    errors, warnings = lint_shot(shot, story_bible, style_guide)
    errors.extend(_non_chinese_source_errors_v2a(
        shot, action_source=action_source, uses_director_actions=uses_director_actions
    ))
    common = {
        "shot_id": sid,
        "scene_id": shot.get("scene_id"),
        "context_ref": shot.get("context_ref", ""),
        "beat_id": shot.get("beat_id"),
        "compiler_version": CANDIDATE_COMPILER_VERSION,
        "errors": errors,
        "warnings": warnings,
        "resolved_refs": {
            "scene": shot.get("location_ref"),
            "characters": list(shot.get("character_refs", []) or []),
            "props": list(shot.get("prop_refs", []) or []),
        },
    }
    if errors:
        blocked = _blocked_result_v2a(common)
        blocked["consumption_view"].update({
            "semantic_action_source": action_source,
            "semantic_path": action_source,
            "fallback_used": fallback_used,
            "audio_events": copy.deepcopy(semantics.get("audio_events") or []),
        })
        return blocked

    segments: list[dict[str, Any]] = []
    header_parts = [
        f"{shot.get('duration', ''):g}秒" if isinstance(shot.get("duration"), (int, float)) else f"{shot.get('duration', '')}秒",
        f"{aspect_ratio}竖屏",
    ]
    if time_label:
        header_parts.append(time_label)
    if scene_name:
        header_parts.append(scene_name)
    segments.append(_segment(
        f"{sid}.header", "header", "，".join(header_parts) + "。",
        [{"source": "shotspec", "source_ref": f"shots[{sid}].duration"}],
    ))

    camera = "镜头：" + "，".join(filter(None, [
        SHOT_SIZE.get(str(shot.get("shot_size")), ""),
        CAMERA.get(str(shot.get("camera")), ""),
        MOVEMENT.get(str(shot.get("movement")), ""),
    ]))
    comp = str(shot.get("composition") or "").strip().rstrip("。")
    if comp:
        camera += "；构图：" + comp
    camera += "。"
    segments.append(_segment(
        f"{sid}.camera", "camera", camera,
        [{"source": "shotspec", "source_ref": f"shots[{sid}].camera"}],
    ))

    states = _state_lines(shot, story_bible, script)
    if states:
        segments.append(_segment(
            f"{sid}.state", "state", "开始状态：" + "；".join(states) + "。",
            [{"source": "state_resolver", "source_ref": f"shots[{sid}].state_in"}],
        ))

    overlay = _appearance_overlay_text_v2a(semantics, story_bible)
    if overlay:
        segments.append(_segment(
            f"{sid}.appearance", "appearance_overlay", "人物阶段：" + overlay.rstrip("。") + "。",
            [{"source": "production_semantics", "source_ref": f"production_semantics[{sid}].appearance_overlays"}],
        ))

    if action:
        segments.append(_segment(
            f"{sid}.action", "action", "动作与互动：" + action,
            [{"source": "production_semantics" if action_source == "production_semantics" else "shotspec/director", "source_ref": f"shots[{sid}]"}],
        ))

    light = _scene_light_text(shot, story_bible, script)
    if light:
        segments.append(_segment(
            f"{sid}.lighting", "scene_visual", "场景与光线：" + light.rstrip("。") + "。",
            [{"source": "story_bible", "source_ref": f"scenes[{shot.get('location_ref')}].visual_lock"}],
        ))

    segments.append(_segment(
        f"{sid}.constraints", "platform_constraint", _constraint_text_v2a(semantics),
        [{"source": "platform_constraint", "source_ref": "seedance.consumption_v2a"}],
    ))

    prompt = "\n\n".join(x["text"] for x in segments if x.get("text"))
    if _contains_unauthorized_latin_v2a(prompt, semantics):
        errors.append(_english_output_issue(
            detail="最终提示词仍含未经剧情文字授权的英文字母，v2a candidate 已阻断输出。",
            source_layer="Consumption Compiler",
            source_ref=f"shots[{sid}].prompt_seedance",
        ))
        common["errors"] = errors
        common["warnings"] = warnings
        blocked = _blocked_result_v2a(common)
        blocked["consumption_view"].update({
            "semantic_action_source": action_source,
            "semantic_path": action_source,
            "fallback_used": fallback_used,
            "audio_events": copy.deepcopy(semantics.get("audio_events") or []),
        })
        return blocked

    if len(prompt) > 450:
        warnings.append({
            "code": "W005_PROMPT_LENGTH_HIGH", "label": WARNING_LABELS["W005_PROMPT_LENGTH_HIGH"],
            "detail": f"最终提示词 {len(prompt)} 字，建议检查是否仍存在重复信息或上下文税。",
            "source_layer": "Consumption Compiler", "source_ref": f"shots[{sid}]",
        })
    status_warning_codes = {
        "W001_MISSING_COLOR", "W002_MISSING_LIGHTING", "W003_DURATION_RISK",
        "W004_STYLE_PSB_DRIFT", "W005_PROMPT_LENGTH_HIGH", "W006_VISUAL_FOCUS_CONFLICT",
    }
    status = "warning" if any(w.get("code") in status_warning_codes for w in warnings) else "ok"
    return {
        **common,
        "warnings": warnings,
        "compile_status": status,
        "prompt_seedance": prompt,
        "prompt_segments": segments,
        "consumption_view": {
            "compiler_version": CANDIDATE_COMPILER_VERSION,
            "selected": {
                "current_characters": list(shot.get("character_refs", []) or []),
                "current_props": list(shot.get("prop_refs", []) or []),
                "time_label": time_label,
                "visual_focus": (shot.get("director") or {}).get("visual_focus") or {},
            },
            "semantic_action_source": action_source,
            "semantic_path": action_source,
            "fallback_used": fallback_used,
            "audio_events": copy.deepcopy(semantics.get("audio_events") or []),
        },
        "prompt_metrics": {"char_count": len(prompt)},
    }


def compile_project_consumption_v2a(
    project_id: str,
    story_bible: dict[str, Any],
    script: dict[str, Any],
    pvb: dict[str, Any],
    psb: dict[str, Any],
    style_guide: dict[str, Any],
    shot_specs: list[dict[str, Any]],
    production_semantics: dict[str, Any] | None,
) -> dict[str, Any]:
    """Patch 07 parallel A/B candidate.

    Shot prompts prefer Production Semantics while keeping an explicit per-shot
    legacy fallback. The Runtime must not make this app-facing until Patch 08.
    Asset prompts continue to use the stable v1 asset compiler.
    """
    semantics_by_shot = {
        str(item.get("shot_id")): item
        for item in ((production_semantics or {}).get("shots", []) or [])
        if isinstance(item, dict) and item.get("shot_id")
    }
    character_prompts: list[dict[str, Any]] = []
    scene_prompts: list[dict[str, Any]] = []
    shot_prompts: list[dict[str, Any]] = []
    compile_failures: list[dict[str, Any]] = []

    for char in story_bible.get("characters", []) or []:
        if char.get("role_type") not in {"main", "supporting"}:
            continue
        try:
            character_prompts.append(
                compile_character_consumption_prompt(story_bible, pvb, style_guide, str(char.get("character_id")))
            )
        except Exception as exc:
            compile_failures.append({"target_type": "character", "target_id": char.get("character_id"), "detail": str(exc)})

    for scene in story_bible.get("scenes", []) or []:
        try:
            scene_prompts.append(
                compile_scene_consumption_prompt(story_bible, psb, style_guide, str(scene.get("scene_id")))
            )
        except Exception as exc:
            compile_failures.append({"target_type": "scene", "target_id": scene.get("scene_id"), "detail": str(exc)})

    for shot in shot_specs:
        sid = str(shot.get("shot_id") or "")
        try:
            shot_prompts.append(
                compile_shot_consumption_prompt_v2a(
                    shot, semantics_by_shot.get(sid), story_bible, script, pvb, psb, style_guide
                )
            )
        except Exception as exc:
            compile_failures.append({"target_type": "shot", "target_id": sid, "detail": str(exc)})
            shot_prompts.append({
                "shot_id": sid,
                "scene_id": shot.get("scene_id"),
                "context_ref": shot.get("context_ref", ""),
                "beat_id": shot.get("beat_id"),
                "compiler_version": CANDIDATE_COMPILER_VERSION,
                "compile_status": "blocked",
                "prompt_seedance": None,
                "errors": [{
                    "code": "E004_HARD_FACT_CONFLICT",
                    "label": "编译异常",
                    "detail": str(exc),
                    "source_layer": "Consumption Compiler",
                    "source_layer_label": "消费编译器",
                    "source_ref": f"shots[{sid}]",
                    "suggested_fix": "检查 v2a 消费编译异常详情；不要跳过该镜头，修复后重新编译。",
                }],
                "warnings": [],
                "prompt_segments": [],
                "prompt_metrics": {"char_count": 0},
                "consumption_view": {
                    "compiler_version": CANDIDATE_COMPILER_VERSION,
                    "blocked": True,
                    "semantic_path": "compile_failure",
                    "fallback_used": False,
                    "audio_events": [],
                },
            })

    blocked = sum(1 for x in shot_prompts if x.get("compile_status") == "blocked")
    warned = sum(1 for x in shot_prompts if x.get("compile_status") == "warning")
    fallbacks = sum(1 for x in shot_prompts if (x.get("consumption_view") or {}).get("fallback_used") is True)
    covered = sum(1 for x in shot_prompts if (x.get("consumption_view") or {}).get("semantic_path") == "production_semantics")

    asset_warnings: list[dict[str, Any]] = []
    for item in character_prompts:
        asset_warnings.extend(
            dict(w, target_type="character", target_id=item.get("character_id"))
            for w in item.get("warnings", []) or []
        )
    for item in scene_prompts:
        asset_warnings.extend(
            dict(w, target_type="scene", target_id=item.get("scene_id"))
            for w in item.get("warnings", []) or []
        )

    if blocked:
        compile_status = "partial_blocked"
    elif warned or asset_warnings:
        compile_status = "warning"
    else:
        compile_status = "ok"

    aggregated_warnings = asset_warnings + [
        dict(w, target_type="shot", target_id=x.get("shot_id"), shot_id=x.get("shot_id"))
        for x in shot_prompts
        for w in x.get("warnings", []) or []
    ]
    total = len(shot_prompts)
    return {
        "project_id": project_id,
        "mode": "candidate_ab",
        "compiler_version": CANDIDATE_COMPILER_VERSION,
        "compile_manifest": {
            "asset_compiler": ASSET_COMPILER_VERSION,
            "shot_compiler": CANDIDATE_COMPILER_VERSION,
            "fallback_compiler": COMPILER_VERSION,
            "lint": LINT_VERSION,
        },
        "compile_status": compile_status,
        "character_prompts": character_prompts,
        "scene_prompts": scene_prompts,
        "shot_prompts": shot_prompts,
        "warnings": aggregated_warnings,
        "compile_failures": compile_failures,
        "summary": {
            "shots": total,
            "ok": sum(1 for x in shot_prompts if x.get("compile_status") == "ok"),
            "warning": warned,
            "blocked": blocked,
            "semantic_action_covered": covered,
            "fallback_used": fallbacks,
            "semantic_action_coverage": (covered / total) if total else 1.0,
        },
    }


# ---------------------------------------------------------------------------
# Consumption v2b semantic compiler (Patch 08)
# Production Semantics is authoritative; raw Storyboard description is never
# used as an action fallback.
# ---------------------------------------------------------------------------

V2D_COMPILER_VERSION = "consumption_v2d"
V2E_COMPILER_VERSION = "consumption_v2e"
V2F_COMPILER_VERSION = "consumption_v2f"
V2G_COMPILER_VERSION = "consumption_v2m"
V2C_COMPILER_VERSION = V2G_COMPILER_VERSION


def _semantic_action_text_v2b(
    shot: dict[str, Any],
    semantics: dict[str, Any] | None,
    story_bible: dict[str, Any],
    time_label: str,
    scene_name: str,
) -> tuple[str, str]:
    semantics = semantics if isinstance(semantics, dict) else {}
    dialogue = [x for x in semantics.get("dialogue", []) or [] if isinstance(x, dict) and x.get("line")]
    onscreen_dialogue = [x for x in dialogue if x.get("offscreen") is not True]
    visual_events = [
        x for x in semantics.get("visual_events", []) or []
        if isinstance(x, dict) and str(x.get("action") or "").strip()
    ]
    choices = [
        x for x in semantics.get("production_choices", []) or []
        if isinstance(x, dict) and str(x.get("choice") or "").strip()
    ]
    director_actions = [x for x in (shot.get("director") or {}).get("performance_actions", []) or [] if isinstance(x, dict)]

    parts: list[str] = []
    for item in visual_events:
        text = str(item.get("action") or "").strip().rstrip("。")
        if text and text not in parts:
            parts.append(text)
    for item in choices:
        text = str(item.get("choice") or "").strip().rstrip("。")
        if text and text not in parts:
            parts.append(text)

    speaker_ids = [str(x.get("character_id") or "") for x in onscreen_dialogue]
    for cid in list(dict.fromkeys(speaker_ids)):
        lines = [str(x.get("line") or "") for x in onscreen_dialogue if str(x.get("character_id") or "") == cid]
        action = next((str(x.get("action") or "") for x in director_actions if str(x.get("character_ref") or "") == cid), "")
        name = _char_name(story_bible, cid)
        cue = _clean_speaking_cue(action, lines)
        quoted = _speaker_line_block(lines)
        if cue:
            if any(cue.endswith(token) for token in ("问", "问道", "回答", "回道", "提醒", "低声说", "轻声说", "开口")):
                line_text = f"{name}{cue}：{quoted}"
            else:
                line_text = f"{name}{cue}，说：{quoted}"
        else:
            line_text = f"{name}说：{quoted}"
        if line_text not in parts:
            parts.append(line_text)

    # Director may add visible performance detail, but never new events. Preserve
    # only non-duplicative cues; raw Storyboard description is never consulted here.
    for item in director_actions:
        cid = str(item.get("character_ref") or "")
        if cid in speaker_ids:
            continue
        raw = _clean_speaking_cue(str(item.get("action") or ""), [])
        raw = _strip_redundant_prefix(raw, time_label, scene_name).strip().rstrip("。")
        if not raw or _is_narrative_summary_text(raw) or _is_non_visual_action_text(raw):
            continue
        cue = f"{_char_name(story_bible, cid)}{raw}" if cid else raw
        cue_norm = _norm_semantic_text(cue)
        duplicate = False
        for existing in parts:
            existing_norm = _norm_semantic_text(existing)
            if not cue_norm or not existing_norm:
                continue
            if cue_norm in existing_norm or existing_norm in cue_norm:
                duplicate = True
                break
            if min(len(cue_norm), len(existing_norm)) >= 4 and SequenceMatcher(None, cue_norm, existing_norm).ratio() >= 0.68:
                duplicate = True
                break
        if not duplicate and cue not in parts:
            parts.append(cue)

    if not parts:
        return "", "production_semantics"
    return "；".join(parts).rstrip("。") + "。", "production_semantics"


def _production_semantics_block_error_v2b(shot: dict[str, Any], semantics: dict[str, Any]) -> dict[str, Any]:
    status = str(semantics.get("renderability_status") or "missing")
    issues = semantics.get("renderability_issues") or []
    details = [str(x.get("detail") or "").strip() for x in issues if isinstance(x, dict) and str(x.get("detail") or "").strip()]
    detail = "；".join(details) or f"Production Semantics renderability_status={status}"
    return {
        "code": "E008_SEMANTIC_NOT_RENDERABLE",
        "label": "生产语义未收敛",
        "detail": detail,
        "source_layer": "Production Semantics",
        "source_layer_label": "生产语义层",
        "source_ref": f"production_semantics[{shot.get('shot_id')}].renderability_status",
        "suggested_fix": "回到 Production Semantics 解决未确定动作机制或冲突；不得使用 Storyboard description 兜底进入最终视频提示词。",
    }


def _blocked_result_v2b(common: dict[str, Any], *, semantic_path: str, semantics: dict[str, Any]) -> dict[str, Any]:
    out = _blocked_result(common)
    out["compiler_version"] = V2C_COMPILER_VERSION
    out["consumption_view"] = {
        "compiler_version": V2C_COMPILER_VERSION,
        "blocked": True,
        "semantic_path": semantic_path,
        "fallback_used": False,
        "audio_events": copy.deepcopy(semantics.get("audio_events") or []),
        "dialogue": copy.deepcopy(semantics.get("dialogue") or []),
        "renderability_status": str(semantics.get("renderability_status") or ""),
    }
    return out



_TIME_GROUP_TOKENS = {
    "dawn": ("凌晨", "清晨", "早晨", "天亮"),
    "morning": ("上午",),
    "noon": ("中午", "正午"),
    "afternoon": ("下午",),
    "evening": ("傍晚", "黄昏"),
    "night": ("晚上", "夜晚", "夜里", "深夜", "午夜"),
}
_HARD_TIME_CONFLICTS = {
    "dawn": {"noon", "afternoon", "night"},
    "morning": {"night"},
    "noon": {"dawn", "night"},
    "afternoon": {"dawn", "night"},
    "evening": {"noon", "dawn"},
    "night": {"morning", "noon", "afternoon", "dawn"},
}


def _time_group(value: str) -> str:
    text = str(value or "")
    for group, tokens in _TIME_GROUP_TOKENS.items():
        if any(token in text for token in tokens):
            return group
    return ""


def _authoritative_scene_time(shot: dict[str, Any], fallback_time: str = "") -> str:
    direct = str(shot.get("authoritative_scene_time") or "").strip()
    if direct:
        return direct
    if str(fallback_time or "").strip():
        return str(fallback_time).strip()
    state_in = shot.get("state_in") if isinstance(shot.get("state_in"), dict) else {}
    env = state_in.get("environment") if isinstance(state_in.get("environment"), dict) else {}
    for key in ("time_of_day", "daypart", "time"):
        value = str(env.get(key) or "").strip()
        if value:
            return value
    return ""


def _time_inconsistency_warning(
    shot: dict[str, Any], manifest: dict[str, Any], *, fallback_time: str = ""
) -> dict[str, Any] | None:
    authority = _authoritative_scene_time(shot, fallback_time)
    authority_group = _time_group(authority)
    if not authority_group:
        return None
    director = shot.get("director") if isinstance(shot.get("director"), dict) else {}
    fields = {
        "scene": str(manifest.get("scene") or ""),
        "scene_state": str(manifest.get("scene_state_anchor") or ""),
        "spatial_blocking": str(manifest.get("spatial_blocking") or ""),
        "performance_action": str(manifest.get("performance_text") or ""),
        "visual_focus": json.dumps(director.get("visual_focus") or {}, ensure_ascii=False),
        "environment_audio": str(manifest.get("environment_sfx") or ""),
    }
    conflicts: list[str] = []
    for field, text in fields.items():
        groups = {_time_group(token) for token in re.findall(_TEMPORAL_EXPR, text)}
        groups.discard("")
        for group in groups:
            if group in _HARD_TIME_CONFLICTS.get(authority_group, set()):
                conflicts.append(f"{field}={text}")
                break
    if not conflicts:
        return None
    return {
        "code": "W008_TIME_INCONSISTENCY",
        "label": WARNING_LABELS["W008_TIME_INCONSISTENCY"],
        "detail": f"权威场景时间为“{authority}”，但当前镜头存在确定性冲突时间表达：" + "；".join(conflicts[:3]),
        "source_layer": "Consumption Compiler",
        "source_ref": f"shots[{shot.get('shot_id')}]",
        "authoritative_scene_time": authority,
    }


def _natural_sublocation_label(value: str) -> str:
    text = str(value or "").strip(" ，,；;。")
    if not text:
        return ""
    text = re.sub(r"(?:现在|如今|目前)是", "现为", text)
    text = re.sub(r"(?:现在|如今|目前)变成", "现为", text)
    text = re.sub(r"改成", "现为", text)
    return text


def _prompt_complexity_threshold(shot: dict[str, Any], visible_count: int, manifest: dict[str, Any]) -> tuple[str, int]:
    director = shot.get("director") if isinstance(shot.get("director"), dict) else {}
    actions = [x for x in director.get("performance_actions", []) or [] if isinstance(x, dict) and str(x.get("action") or "").strip()]
    voice_chars = len(str(manifest.get("dialogue") or "")) + len(str(manifest.get("narration") or ""))
    density = str(manifest.get("performance_density") or "low")
    signals = int(manifest.get("performance_execution_signal_count") or 0)

    if visible_count >= 3 or len(actions) >= 3:
        return "multi_action_heavy", 600
    if density == "high":
        if visible_count >= 2 and (signals >= 5 or voice_chars > 80):
            return "multi_action_heavy", 600
        return "dense", 520
    if visible_count >= 2 and (len(actions) >= 2 or voice_chars > 80):
        return "dense", 520
    if density == "medium":
        if visible_count >= 2 and (signals >= 3 or voice_chars > 40):
            return "dense", 520
        return "normal", 400
    if visible_count <= 1 and len(actions) <= 1 and voice_chars <= 40:
        return "simple", 320
    return "normal", 400


def _ambiguous_subject_warning(shot: dict[str, Any], visible_refs: list[str], story_bible: dict[str, Any]) -> dict[str, Any] | None:
    if len(visible_refs) < 2:
        return None
    director = shot.get("director") if isinstance(shot.get("director"), dict) else {}
    visible_set = set(visible_refs)
    for index, item in enumerate(director.get("performance_actions", []) or []):
        if not isinstance(item, dict):
            continue
        text = str(item.get("action") or "").strip()
        pronoun = next((p for p in ("他们", "她们", "他", "她", "它") if text.startswith(p)), "")
        if not pronoun:
            continue
        ref = str(item.get("character_ref") or "")
        # A valid singular character_ref is a deterministic subject binding, so
        # no warning is needed. Plural pronouns cannot be represented by one ref.
        if pronoun not in {"他们", "她们"} and ref in visible_set:
            continue
        names = [_char_name(story_bible, ref_id) for ref_id in visible_refs]
        if any(name and name in text for name in names):
            continue
        return {
            "code": "W010_ACTION_AMBIGUOUS_SUBJECT",
            "label": WARNING_LABELS["W010_ACTION_AMBIGUOUS_SUBJECT"],
            "detail": f"performance_actions[{index}] 以“{pronoun}”作为动作主体，当前镜头存在多个可见角色且无法用确定性规则唯一绑定。",
            "source_layer": "Director",
            "source_ref": f"shots[{shot.get('shot_id')}].director.performance_actions[{index}].action",
        }
    return None


def compile_shot_consumption_prompt_v2d(
    shot: dict[str, Any],
    production_semantics: dict[str, Any] | None,
    story_bible: dict[str, Any],
    script: dict[str, Any],
    pvb: dict[str, Any],
    psb: dict[str, Any],
    style_guide: dict[str, Any],
    *,
    aspect_ratio: str = "9:16",
    timeline_start_seconds: float = 0.0,
    shot_index: int | None = None,
) -> dict[str, Any]:
    sid = str(shot.get("shot_id") or "")
    semantics = production_semantics if isinstance(production_semantics, dict) else {}
    renderability = str(semantics.get("renderability_status") or "")

    errors, warnings = lint_shot(shot, story_bible, style_guide)
    # Language form is not a story-fact gate. Authorized proper nouns may remain.
    common = {
        "shot_id": sid,
        "scene_id": shot.get("scene_id"),
        "context_ref": shot.get("context_ref", ""),
        "beat_id": shot.get("beat_id"),
        "compiler_version": V2C_COMPILER_VERSION,
        "errors": errors,
        "warnings": warnings,
        "resolved_refs": {
            "scene": shot.get("location_ref"),
            "characters": list(shot.get("character_refs", []) or []),
            "props": list(shot.get("prop_refs", []) or []),
        },
    }

    if renderability != "renderable":
        errors.append(_production_semantics_block_error_v2b(shot, semantics))
        common["errors"] = errors
        return _blocked_result_v2b(common, semantic_path="production_semantics_unresolved", semantics=semantics)
    if errors:
        return _blocked_result_v2b(common, semantic_path="production_semantics", semantics=semantics)

    scene = _story_scene(story_bible, str(shot.get("location_ref") or ""))
    scene_name = str(scene.get("canonical_name") or scene.get("name") or shot.get("location_ref") or "")
    time_label = _time_label(shot, script)
    action, semantic_path = _semantic_action_text_v2b(shot, semantics, story_bible, time_label, scene_name)

    # Stage 8.5: deterministic Shot Consumption Manifest. It consumes only the
    # minimal sufficient stable visual anchors plus the current Shot delta. Raw
    # PSB/PVB/Style text is never copied wholesale into every video prompt.
    visible_refs = visible_character_refs(shot)
    character_visual, character_asset_records = _compact_character_summary_for_shot(
        story_bible, pvb, visible_refs, warnings, shot=shot
    )
    scene_visual, scene_state_visual, current_sublocation, scene_asset_record = _scene_continuity_anchor_v2f(
        story_bible, psb, shot, semantics, time_label=time_label
    )
    style_visual = _style_summary_cn(style_guide)
    scene_display_name = scene_name
    if current_sublocation:
        natural_sub = _natural_sublocation_label(current_sublocation)
        if re.search(r"(?:现为|旧址|变成|改成)", natural_sub) and any(token in natural_sub for token in ("店", "房", "厅", "站", "楼", "院", "病房")):
            # Active transformed sublocation becomes the effective Shot scene; do
            # not prefix an unrelated root-space identity such as a repair stall.
            scene_display_name = natural_sub
        else:
            scene_display_name = f"{scene_name}（{natural_sub}）"
    manifest = build_shot_consumption_manifest(
        shot, semantics, story_bible, script, pvb, psb, style_guide,
        aspect_ratio=aspect_ratio,
        timeline_start_seconds=timeline_start_seconds,
        shot_index=shot_index,
        shot_size_label=SHOT_SIZE.get(str(shot.get("shot_size")), str(shot.get("shot_size") or "")),
        camera_label=CAMERA.get(str(shot.get("camera")), str(shot.get("camera") or "")),
        movement_label=MOVEMENT.get(str(shot.get("movement")), str(shot.get("movement") or "")),
        time_label=time_label,
        scene_name=scene_display_name,
        character_assets_override=character_visual,
        scene_assets_override=scene_visual,
        scene_state_override=scene_state_visual,
        global_style_override=style_visual,
        include_dramatic_intent=False,
        character_anchor_label="",
        scene_anchor_label="",
        text_constraint_override=_text_constraint_v2d(semantics),
        shot_spatial_context=current_sublocation,
    )
    common["resolved_refs"]["asset_registry_version"] = ASSET_REGISTRY_VERSION
    common["resolved_refs"]["continuity_anchor_version"] = CONTINUITY_ANCHOR_VERSION
    common["resolved_refs"]["character_asset_hashes"] = {
        str(record.get("character_id")): _asset_record_hash(record) for record in character_asset_records
    }
    common["resolved_refs"]["scene_asset_hash"] = _asset_record_hash(scene_asset_record)
    common["resolved_refs"]["character_anchor_hash"] = _stable_text_hash(character_visual)
    common["resolved_refs"]["scene_anchor_hash"] = _stable_text_hash(scene_visual)
    common["resolved_refs"]["scene_state_hash"] = _stable_text_hash(scene_state_visual)
    consumption_input = {
        "compiler_version": V2C_COMPILER_VERSION,
        "asset_registry_version": ASSET_REGISTRY_VERSION,
        "continuity_anchor_version": CONTINUITY_ANCHOR_VERSION,
        "scene_ref": common["resolved_refs"].get("scene"),
        "character_refs": common["resolved_refs"].get("characters"),
        "visible_character_refs": visible_refs,
        "prop_refs": common["resolved_refs"].get("props"),
        "character_asset_hashes": common["resolved_refs"].get("character_asset_hashes"),
        "scene_asset_hash": common["resolved_refs"].get("scene_asset_hash"),
        "character_anchor_hash": common["resolved_refs"].get("character_anchor_hash"),
        "scene_anchor_hash": common["resolved_refs"].get("scene_anchor_hash"),
        "scene_state_hash": common["resolved_refs"].get("scene_state_hash"),
        "shot_spatial_context": current_sublocation,
        "shot_size": shot.get("shot_size"),
        "camera": shot.get("camera"),
        "movement": shot.get("movement"),
        "shot_purpose": (shot.get("director") or {}).get("shot_purpose"),
        "visual_target": (shot.get("director") or {}).get("visual_target") or {},
        "execution_framing": (shot.get("director") or {}).get("execution_framing") or {},
        "frozen_text_unit_refs": copy.deepcopy(shot.get("frozen_text_unit_refs") or {}),
        "dialogue": copy.deepcopy(shot.get("dialogue") or []),
        "narration": copy.deepcopy(shot.get("narration") or []),
    }
    common["resolved_refs"]["consumption_input_hash"] = hashlib.sha256(
        json.dumps(consumption_input, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    manifest.setdefault("provenance", {})["asset_registry_version"] = ASSET_REGISTRY_VERSION
    manifest.setdefault("provenance", {})["continuity_anchor_version"] = CONTINUITY_ANCHOR_VERSION
    manifest.setdefault("provenance", {})["character_asset_hashes"] = copy.deepcopy(common["resolved_refs"].get("character_asset_hashes") or {})
    manifest.setdefault("provenance", {})["scene_asset_hash"] = common["resolved_refs"].get("scene_asset_hash")
    manifest["asset_registry_version"] = ASSET_REGISTRY_VERSION
    manifest["continuity_anchor_version"] = CONTINUITY_ANCHOR_VERSION
    prompt = render_shot_prompt(manifest)
    segments = [
        _segment(f"{sid}.storyboard_template", "storyboard_prompt", prompt, [
            {"source": "shot_consumption_manifest", "source_ref": f"shots[{sid}]"}
        ])
    ]

    # Global style remains in every independently consumable Shot, but it is not
    # continuity state. W009 measures only identity/scene/state continuity payload.
    continuity_chars = len(character_visual) + len(scene_visual) + len(scene_state_visual)
    shot_delta_chars = (
        len(str(manifest.get("spatial_blocking") or ""))
        + len(str(manifest.get("performance_text") or ""))
        + len(str(manifest.get("camera") or ""))
    )
    dialogue_chars = len(str(manifest.get("dialogue") or "")) + len(str(manifest.get("narration") or ""))
    audio_chars = sum(len(str(manifest.get(k) or "")) for k in ("action_sfx", "environment_sfx", "atmosphere_sfx"))

    time_warning = _time_inconsistency_warning(shot, manifest, fallback_time=time_label)
    if time_warning:
        warnings.append(time_warning)
    ambiguous_warning = _ambiguous_subject_warning(shot, visible_refs, story_bible)
    if ambiguous_warning:
        warnings.append(ambiguous_warning)

    continuity_limit = min(240, max(120, 105 + len(visible_refs) * 35))
    if continuity_chars > continuity_limit:
        warnings.append({
            "code": "W009_CONTINUITY_BUDGET_HIGH",
            "label": WARNING_LABELS["W009_CONTINUITY_BUDGET_HIGH"],
            "detail": f"连续性信息 {continuity_chars} 字，超过当前 {len(visible_refs)} 个可见角色对应预算 {continuity_limit} 字。",
            "source_layer": "Consumption Compiler",
            "source_ref": f"shots[{sid}]",
            "budget": {"continuity_chars": continuity_chars, "limit": continuity_limit, "visible_character_count": len(visible_refs)},
        })

    director_obj = shot.get("director") if isinstance(shot.get("director"), dict) else {}
    purpose = str(director_obj.get("shot_purpose") or "")
    exec_items = [x for x in director_obj.get("performance_execution", []) or [] if isinstance(x, dict)]
    action_count = len([x for x in director_obj.get("performance_actions", []) or [] if isinstance(x, dict)])
    if purpose in {"action", "emotional_peak", "reveal"} or action_count >= 2:
        performance_density = "high"
    elif purpose in {"speaker", "reaction"} or len(visible_refs) >= 2 or exec_items:
        performance_density = "medium"
    else:
        performance_density = "low"
    performance_chars = len(str(manifest.get("performance_text") or "")) + len(str(manifest.get("gaze") or ""))
    manifest["performance_density"] = performance_density
    performance_limit = {"low": 90, "medium": 160, "high": 260}[performance_density]
    if performance_chars > performance_limit:
        warnings.append({
            "code": "W015_PERFORMANCE_BUDGET_HIGH",
            "label": WARNING_LABELS.get("W015_PERFORMANCE_BUDGET_HIGH", "导演表演信息预算偏高"),
            "detail": f"导演表演信息 {performance_chars} 字，超过 {performance_density} 密度预算 {performance_limit} 字；请压缩重复表演解释，不删除当前镜头必要动作。",
            "source_layer": "Consumption Compiler",
            "source_ref": f"shots[{sid}]",
            "budget": {"performance_chars": performance_chars, "limit": performance_limit, "density": performance_density},
        })

    complexity, length_threshold = _prompt_complexity_threshold(shot, len(visible_refs), manifest)
    if len(prompt) > length_threshold:
        warnings.append({
            "code": "W005_PROMPT_LENGTH_HIGH",
            "label": WARNING_LABELS["W005_PROMPT_LENGTH_HIGH"],
            "detail": f"最终提示词 {len(prompt)} 字，超过 {complexity} 镜头预算 {length_threshold} 字；总长度仅作告警，重复信息由 W009 独立判断。",
            "source_layer": "Consumption Compiler",
            "source_ref": f"shots[{sid}]",
            "budget": {
                "complexity": complexity,
                "threshold": length_threshold,
                "continuity_chars": continuity_chars,
                "shot_delta_chars": shot_delta_chars,
                "dialogue_chars": dialogue_chars,
                "audio_chars": audio_chars,
                "total_chars": len(prompt),
            },
        })
    status_warning_codes = {
        "W001_MISSING_COLOR", "W002_MISSING_LIGHTING", "W003_DURATION_RISK",
        "W004_STYLE_PSB_DRIFT", "W005_PROMPT_LENGTH_HIGH", "W006_VISUAL_FOCUS_CONFLICT",
        "W008_TIME_INCONSISTENCY", "W009_CONTINUITY_BUDGET_HIGH", "W010_ACTION_AMBIGUOUS_SUBJECT",
        "W012_PERFORMANCE_TOO_ABSTRACT", "W013_ACTION_TRANSITION_MISSING",
        "W014_PERFORMANCE_DENSITY_MISMATCH", "W015_PERFORMANCE_BUDGET_HIGH",
    }
    compile_status = "warning" if any(w.get("code") in status_warning_codes for w in warnings) else "ok"
    return {
        **common,
        "warnings": warnings,
        "compile_status": compile_status,
        "prompt_seedance": prompt,
        "prompt_segments": segments,
        "shot_consumption_manifest": manifest,
        "consumption_view": {
            "compiler_version": V2C_COMPILER_VERSION,
            "semantic_path": semantic_path,
            "fallback_used": False,
            "audio_events": copy.deepcopy(semantics.get("audio_events") or []),
            "dialogue": copy.deepcopy(semantics.get("dialogue") or []),
            "renderability_status": renderability,
            "selected": {
                "current_characters": list(shot.get("character_refs", []) or []),
                "visible_characters": list(visible_refs),
                "current_props": list(shot.get("prop_refs", []) or []),
                "time_label": time_label,
                "visual_focus": (shot.get("director") or {}).get("visual_focus") or {},
                "shot_purpose": (shot.get("director") or {}).get("shot_purpose") or "",
                "execution_framing": (shot.get("director") or {}).get("execution_framing") or {},
                "shot_spatial_context": current_sublocation,
                "asset_registry_version": ASSET_REGISTRY_VERSION,
                "continuity_anchor_version": CONTINUITY_ANCHOR_VERSION,
                "character_asset_hashes": copy.deepcopy(common["resolved_refs"].get("character_asset_hashes") or {}),
                "scene_asset_hash": common["resolved_refs"].get("scene_asset_hash"),
                "character_anchor_hash": common["resolved_refs"].get("character_anchor_hash"),
                "scene_anchor_hash": common["resolved_refs"].get("scene_anchor_hash"),
                "scene_state_hash": common["resolved_refs"].get("scene_state_hash"),
            },
        },
        "prompt_metrics": {
            "char_count": len(prompt),
            "continuity_chars": continuity_chars,
            "shot_delta_chars": shot_delta_chars,
            "dialogue_chars": dialogue_chars,
            "audio_chars": audio_chars,
            "performance_chars": performance_chars,
            "performance_density": performance_density,
        },
    }


def compile_project_consumption_v2d(
    project_id: str,
    story_bible: dict[str, Any],
    script: dict[str, Any],
    pvb: dict[str, Any],
    psb: dict[str, Any],
    style_guide: dict[str, Any],
    shot_specs: list[dict[str, Any]],
    production_semantics: dict[str, Any] | None,
) -> dict[str, Any]:
    semantics_by_shot = {
        str(item.get("shot_id")): item
        for item in ((production_semantics or {}).get("shots", []) or [])
        if isinstance(item, dict) and item.get("shot_id")
    }
    character_prompts: list[dict[str, Any]] = []
    scene_prompts: list[dict[str, Any]] = []
    shot_prompts: list[dict[str, Any]] = []
    compile_failures: list[dict[str, Any]] = []

    pvb_ids = {str(x.get("character_id") or "") for x in pvb.get("characters", []) or [] if isinstance(x, dict)}
    for char in story_bible.get("characters", []) or []:
        if str(char.get("character_id") or "") not in pvb_ids:
            continue
        try:
            character_prompts.append(compile_character_consumption_prompt(
                story_bible, pvb, style_guide, str(char.get("character_id"))
            ))
        except Exception as exc:
            compile_failures.append({"target_type": "character", "target_id": char.get("character_id"), "detail": str(exc)})
    for scene in story_bible.get("scenes", []) or []:
        try:
            scene_prompts.append(compile_scene_consumption_prompt(
                story_bible, psb, style_guide, str(scene.get("scene_id"))
            ))
        except Exception as exc:
            compile_failures.append({"target_type": "scene", "target_id": scene.get("scene_id"), "detail": str(exc)})
    elapsed_seconds = 0.0
    for shot_index, shot in enumerate(shot_specs, 1):
        sid = str(shot.get("shot_id") or "")
        shot_start_seconds = elapsed_seconds
        try:
            elapsed_seconds += float(shot.get("duration") or 0.0)
        except (TypeError, ValueError):
            pass
        try:
            shot_prompts.append(compile_shot_consumption_prompt_v2d(
                shot, semantics_by_shot.get(sid), story_bible, script, pvb, psb, style_guide,
                timeline_start_seconds=shot_start_seconds, shot_index=shot_index,
            ))
        except Exception as exc:
            compile_failures.append({"target_type": "shot", "target_id": sid, "detail": str(exc)})
            shot_prompts.append({
                "shot_id": sid,
                "scene_id": shot.get("scene_id"),
                "context_ref": shot.get("context_ref", ""),
                "beat_id": shot.get("beat_id"),
                "compiler_version": V2C_COMPILER_VERSION,
                "compile_status": "blocked",
                "prompt_seedance": None,
                "errors": [{
                    "code": "E004_HARD_FACT_CONFLICT",
                    "label": "编译异常",
                    "detail": str(exc),
                    "source_layer": "Consumption Compiler",
                    "source_layer_label": "消费编译器",
                    "source_ref": f"shots[{sid}]",
                    "suggested_fix": "检查 consumption_v2m 编译异常详情；修复后重新编译。",
                }],
                "warnings": [],
                "prompt_segments": [],
                "prompt_metrics": {"char_count": 0},
                "consumption_view": {
                    "compiler_version": V2C_COMPILER_VERSION,
                    "blocked": True,
                    "semantic_path": "compile_failure",
                    "fallback_used": False,
                    "audio_events": [],
                    "dialogue": [],
                },
            })

    blocked = sum(1 for x in shot_prompts if x.get("compile_status") == "blocked")
    warned = sum(1 for x in shot_prompts if x.get("compile_status") == "warning")
    asset_warnings: list[dict[str, Any]] = []
    for item in character_prompts:
        asset_warnings.extend(dict(w, target_type="character", target_id=item.get("character_id")) for w in item.get("warnings", []) or [])
    for item in scene_prompts:
        asset_warnings.extend(dict(w, target_type="scene", target_id=item.get("scene_id")) for w in item.get("warnings", []) or [])
    compile_status = "partial_blocked" if blocked else ("warning" if warned or asset_warnings else "ok")
    aggregated_warnings = asset_warnings + [
        dict(w, target_type="shot", target_id=x.get("shot_id"), shot_id=x.get("shot_id"))
        for x in shot_prompts for w in x.get("warnings", []) or []
    ]
    semantic_covered = sum(1 for x in shot_prompts if (x.get("consumption_view") or {}).get("semantic_path") == "production_semantics")
    return {
        "project_id": project_id,
        "mode": "production",
        "compiler_version": V2C_COMPILER_VERSION,
        "compile_manifest": {
            "asset_compiler": ASSET_COMPILER_VERSION,
            "asset_registry": ASSET_REGISTRY_VERSION,
            "continuity_anchor": CONTINUITY_ANCHOR_VERSION,
            "shot_compiler": V2C_COMPILER_VERSION,
            "ab_reference_compiler": COMPILER_VERSION,
            "lint": LINT_VERSION,
        },
        "compile_status": compile_status,
        "character_prompts": character_prompts,
        "scene_prompts": scene_prompts,
        "shot_prompts": shot_prompts,
        "warnings": aggregated_warnings,
        "compile_failures": compile_failures,
        "summary": {
            "shots": len(shot_prompts),
            "ok": sum(1 for x in shot_prompts if x.get("compile_status") == "ok"),
            "warning": warned,
            "blocked": blocked,
            "semantic_action_covered": semantic_covered,
            "fallback_used": 0,
        },
    }


# Backward-compatible Python aliases for integrations that imported the v2b/v2c symbols.
# The runtime contract and emitted compiler_version are v2i.
compile_shot_consumption_prompt_v2c = compile_shot_consumption_prompt_v2d
compile_project_consumption_v2c = compile_project_consumption_v2d
compile_shot_consumption_prompt_v2b = compile_shot_consumption_prompt_v2d
compile_project_consumption_v2b = compile_project_consumption_v2d
