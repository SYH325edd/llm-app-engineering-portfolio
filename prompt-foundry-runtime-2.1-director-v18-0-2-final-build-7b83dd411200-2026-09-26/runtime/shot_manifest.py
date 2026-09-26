from __future__ import annotations

import hashlib
import re
from typing import Any

from .performance_logic_guard import logic_item_renderable, renderable_logic_fields
from .director_execution_authority import filter_performance_execution_item, filter_dialogue_delivery_item
from .camera_grammar import framing_note_violations, framing_note_authority_violations
from .shot_visibility import visible_character_refs


UNKNOWN_STYLE_VALUES = {"", "unknown", "未知", "未限定", "不限定", "not_applicable", "n/a"}
_DIALOGUE_CONTINUATION_ENDINGS = ("，", ",", "、", "：", ":")


def _find(items: Any, key: str, value: str) -> dict[str, Any] | None:
    if not isinstance(items, list):
        return None
    return next((x for x in items if isinstance(x, dict) and str(x.get(key)) == str(value)), None)


def _leaf_value(entry: Any) -> str:
    if not isinstance(entry, dict):
        return ""
    if entry.get("status") not in {"locked", "confirmed", "candidate"}:
        return ""
    return str(entry.get("value") or "").strip()


def _char_name(story: dict[str, Any], ref: str) -> str:
    item = _find(story.get("characters"), "character_id", ref) or {}
    return str(item.get("canonical_name") or ref)


def _prop_name(story: dict[str, Any], ref: str) -> str:
    item = _find(story.get("props"), "prop_id", ref) or {}
    return str(item.get("canonical_name") or item.get("name") or ref)


def _allowed_entity_terms_for_shot(shot: dict[str, Any], story: dict[str, Any]) -> list[str]:
    """Return the same current-Shot entity vocabulary used by Director validation.

    Character aliases are part of the already-authorized entity identity.  Older
    compiler code kept only the canonical character name, so a gaze such as
    "看向师傅" could pass Director validation and then be silently dropped by
    the compiler.  Keep aliases here so Director, Compiler and Readiness share
    one entity-authority boundary.
    """
    terms: list[str] = []
    for ref in shot.get("character_refs", []) or []:
        if not isinstance(ref, str) or not ref:
            continue
        item = _find(story.get("characters"), "character_id", ref) or {}
        for value in [item.get("canonical_name"), item.get("name"), *(item.get("aliases") or [])]:
            text = str(value or "").strip()
            if text and text not in terms:
                terms.append(text)
    for ref in shot.get("prop_refs", []) or []:
        if not isinstance(ref, str) or not ref:
            continue
        item = _find(story.get("props"), "prop_id", ref) or {}
        for value in [item.get("canonical_name"), item.get("name"), *(item.get("aliases") or [])]:
            text = str(value or "").strip()
            if text and text not in terms:
                terms.append(text)
    return terms


def _story_or_pvb_value(story_char: dict[str, Any], pvb_char: dict[str, Any] | None, field: str) -> str:
    lock = story_char.get("visual_lock") if isinstance(story_char.get("visual_lock"), dict) else {}
    if field in lock and isinstance(lock.get(field), str) and lock.get(field, "").strip():
        return str(lock[field]).strip()
    if not pvb_char:
        return ""
    if field in {"default", "outerwear", "shirt", "footwear", "accessory"}:
        return _leaf_value((pvb_char.get("wardrobe") or {}).get(field))
    return _leaf_value((pvb_char.get("visual_identity") or {}).get(field))


def character_asset_summary(story: dict[str, Any], pvb: dict[str, Any], refs: list[str]) -> str:
    chunks: list[str] = []
    for ref in refs:
        story_char = _find(story.get("characters"), "character_id", ref) or {}
        pvb_char = _find(pvb.get("characters"), "character_id", ref)
        values=[]
        for field in ("age_appearance", "face", "hair", "body", "default", "outerwear"):
            value = _story_or_pvb_value(story_char, pvb_char, field)
            if value and value not in values:
                values.append(value)
        if values:
            chunks.append(f"{_char_name(story, ref)}：" + "，".join(values[:5]))
    return "；".join(chunks)


def scene_asset_summary(story: dict[str, Any], psb: dict[str, Any], scene_ref: str) -> str:
    scene = _find(story.get("scenes"), "scene_id", scene_ref) or {}
    lock = scene.get("visual_lock") if isinstance(scene.get("visual_lock"), dict) else {}
    psb_scene = _find(psb.get("scenes"), "scene_id", scene_ref) or {}
    production = psb_scene.get("production_visual") if isinstance(psb_scene.get("production_visual"), dict) else {}
    parts=[]
    for field in ("space", "layout", "materials", "environment", "lighting", "color"):
        hard = lock.get(field)
        value = str(hard).strip() if isinstance(hard, str) and hard.strip() else _leaf_value(production.get(field))
        if value and value not in parts:
            parts.append(value)
    return "；".join(parts[:6])


def style_summary(style_guide: dict[str, Any]) -> str:
    values=[]
    for field in ("era", "region", "genre", "tone", "visual_reference"):
        value = _leaf_value(style_guide.get(field))
        if value and value.casefold() not in UNKNOWN_STYLE_VALUES and value not in values:
            values.append(value)
    return "；".join(values[:4])


def _format_state_value(key: str, value: Any, story: dict[str, Any]) -> str:
    if value in (None, "", False):
        return ""
    if key == "held_by":
        return _char_name(story, str(value))
    if isinstance(value, (str, int, float)):
        return str(value)
    if isinstance(value, list):
        return "、".join(str(x) for x in value if x not in (None, ""))
    return ""


def spatial_blocking(shot: dict[str, Any], story: dict[str, Any]) -> str:
    state = shot.get("state_in") if isinstance(shot.get("state_in"), dict) else {}
    char_state = state.get("characters") if isinstance(state.get("characters"), dict) else {}
    parts=[]
    for ref in shot.get("character_refs", []) or []:
        fields = char_state.get(ref) if isinstance(char_state.get(ref), dict) else {}
        details=[]
        for key in ("position", "posture", "orientation", "head_orientation"):
            text = _format_state_value(key, fields.get(key), story)
            if text and text not in details:
                details.append(text)
        if details:
            parts.append(f"{_char_name(story, str(ref))}" + "，".join(details))
    if parts:
        return "；".join(parts)
    composition = str(shot.get("composition") or "").strip().rstrip("。")
    return composition or "按当前镜头构图保持人物既定空间关系"


def _dialogue_text_with_trace(semantics: dict[str, Any], shot: dict[str, Any], story: dict[str, Any]) -> tuple[str, list[dict[str, Any]]]:
    items = semantics.get("dialogue") if isinstance(semantics.get("dialogue"), list) else shot.get("dialogue")
    frozen_refs = [
        str(x) for x in ((shot.get("frozen_text_unit_refs") or {}).get("dialogue") or [])
        if isinstance(x, str) and x
    ]
    director = shot.get("director") if isinstance(shot.get("director"), dict) else {}
    delivery_by_unit = {
        str(item.get("frozen_text_unit_id")): (index, item)
        for index, item in enumerate(director.get("dialogue_delivery") or [])
        if isinstance(item, dict) and str(item.get("frozen_text_unit_id") or "")
    }
    grouped: list[dict[str, Any]] = []
    for dialogue_index, item in enumerate(items or []):
        if not isinstance(item, dict):
            continue
        ref=str(item.get("character_id") or "")
        line=str(item.get("line") or item.get("text") or "").strip()
        if not line:
            continue
        offscreen = item.get("offscreen") is True
        delivery_mode = str(item.get("delivery_mode") or "direct")
        has_embedded_quotes = bool(item.get("embedded_quotes"))
        unit_id = frozen_refs[dialogue_index] if dialogue_index < len(frozen_refs) else ""
        delivery_record = delivery_by_unit.get(unit_id) if unit_id else None
        director_delivery_index = delivery_record[0] if delivery_record else None
        director_delivery = delivery_record[1] if delivery_record else None
        clean_line = line.strip("“”\"")
        if grouped:
            previous = grouped[-1]
            previous_text = str(previous.get("line") or "").rstrip()
            while previous_text and previous_text[-1] in "”’」』\"'":
                previous_text = previous_text[:-1].rstrip()
            if (
                previous.get("character_id") == ref
                and previous.get("offscreen") is offscreen
                and previous.get("delivery_mode") == delivery_mode
                and previous.get("director_delivery") == director_delivery
                and previous_text.endswith(_DIALOGUE_CONTINUATION_ENDINGS)
            ):
                previous["line"] = str(previous.get("line") or "") + clean_line
                previous["has_embedded_quotes"] = bool(previous.get("has_embedded_quotes")) or has_embedded_quotes
                continue
        grouped.append({
            "character_id": ref,
            "offscreen": offscreen,
            "delivery_mode": delivery_mode,
            "has_embedded_quotes": has_embedded_quotes,
            "line": clean_line,
            "director_delivery": director_delivery,
            "director_delivery_index": director_delivery_index,
        })
    lines=[]
    rendered_trace: list[dict[str, Any]] = []
    for item in grouped:
        ref = str(item.get("character_id") or "")
        delivery_mode = str(item.get("delivery_mode") or "direct")
        offscreen = item.get("offscreen") is True
        if delivery_mode == "voiceover":
            label = "画外旁白"
        elif delivery_mode == "quoted":
            label = "画外转述" if offscreen else "画内转述"
        else:
            label = "画外" if offscreen else "画内"
            if item.get("has_embedded_quotes"):
                label += "，含转述原话"
        raw_d = item.get("director_delivery") if isinstance(item.get("director_delivery"), dict) else {}
        d = filter_dialogue_delivery_item(
            raw_d,
            frozen_line=str(item.get("line") or ""),
            allowed_entity_terms=_allowed_entity_terms_for_shot(shot, story),
        )
        cues: list[str] = []
        for field in ("emotion", "volume", "pace", "pause", "delivery"):
            value = str(d.get(field) or "").strip()
            if value and value not in cues:
                cues.append(value)
                rendered_trace.append({
                    "source": "dialogue_delivery",
                    "index": item.get("director_delivery_index"),
                    "field": field,
                    "value": value,
                })
        if cues:
            label += "；" + "、".join(cues)
        lines.append(f"{_char_name(story, ref)}（{label}）：“{item.get('line') or ''}”")
    return "；".join(lines) or "无", rendered_trace


def _dialogue_text(semantics: dict[str, Any], shot: dict[str, Any], story: dict[str, Any]) -> str:
    """Backward-compatible dialogue rendering helper.

    Render provenance is an internal compiler concern; existing callers that only
    need prompt text keep the historical string return type.
    """
    text, _trace = _dialogue_text_with_trace(semantics, shot, story)
    return text


_NON_AUDIBLE_AUDIO_RE = re.compile(
    r"(?:气味|味道|香味|香气|臭味|臭气|[\u4e00-\u9fff]{1,6}味(?=(?:混|散|弥|飘|在|，|,|；|;|。|$))|药水味|灰尘(?:弥漫|散开|漂浮)?|颜色|色调|光线|明暗|视觉|温度)"
)


def _audible_clause(value: str) -> str:
    """Remove only high-confidence non-audible clauses from audio text."""
    text = str(value or "").strip()
    if not text:
        return ""
    parts = [x.strip() for x in re.split(r"[，,；;。]", text) if x.strip()]
    kept = [part for part in parts if not _NON_AUDIBLE_AUDIO_RE.search(part)]
    return "，".join(kept)

def _audio_groups(semantics: dict[str, Any]) -> tuple[str, str, str]:
    action=[]; environment=[]; atmosphere=[]
    env_tokens=("风", "雨", "雷", "城市", "街", "走廊", "空调", "钟", "鸟", "车流", "人声", "底噪", "监护", "机器", "海浪", "虫鸣")
    for item in semantics.get("audio_events", []) or []:
        if not isinstance(item, dict):
            continue
        text=_audible_clause(str(item.get("content") or ""))
        if not text:
            continue
        role = item.get("audio_role")
        if role == "action":
            action.append(text)
        elif role == "environment":
            environment.append(text)
        elif role == "atmosphere":
            atmosphere.append(text)
        elif item.get("audio_type") == "non_diegetic":
            atmosphere.append(text)
        elif any(token in text for token in env_tokens):
            environment.append(text)
        else:
            action.append(text)
    return "、".join(dict.fromkeys(action)) or "无", "、".join(dict.fromkeys(environment)) or "无", "、".join(dict.fromkeys(atmosphere)) or "无"

def _dialogue_lines(semantics: dict[str, Any], shot: dict[str, Any]) -> list[str]:
    items = semantics.get("dialogue") if isinstance(semantics.get("dialogue"), list) else shot.get("dialogue")
    out: list[str] = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        line = str(item.get("line") or item.get("text") or "").strip().strip('“”"')
        if line and line not in out:
            out.append(line)
    return out


def _norm_dialogue_span(value: str) -> str:
    return re.sub(r"[\\s，,。！？!?；;：:'‘’“”\"-]", "", str(value or ""))


_SPEECH_VERB_PATTERN = r"(?:说出|说道|低声说|轻声说|说|回答|回应|问道|询问|追问|反问|问|开口发问|开口追问|开口询问|开口)"


def _strip_unquoted_dialogue_literal(text: str, line: str) -> str:
    """Remove frozen dialogue without corrupting unrelated short words.

    Long lines are specific enough for literal replacement. Very short Chinese
    utterances such as “好/对/行” are removed only when they are the whole
    fragment or are attached to an explicit speech construction.
    """
    raw_line = str(line or "").strip().strip('“”"\'')
    line_norm = _norm_dialogue_span(raw_line)
    if not raw_line or not line_norm:
        return text
    if len(line_norm) >= 4:
        return text.replace(raw_line, "")
    if _norm_dialogue_span(text) == line_norm:
        return ""
    escaped = re.escape(raw_line)
    return re.sub(
        rf"({_SPEECH_VERB_PATTERN}\s*[：:]?\s*){escaped}(?=$|[。！？!?；;,，])",
        r"\1",
        text,
    )


def _strip_dialogue_from_action(action: str, dialogue_lines: list[str]) -> str:
    """Keep visible speaking cues while ensuring literal dialogue is rendered only once."""
    text = str(action or "").strip()
    line_norms = {_norm_dialogue_span(line) for line in dialogue_lines if _norm_dialogue_span(line)}
    # Remove quoted spans whose normalized content is an exact current dialogue
    # unit, even when the Director wraps it in “说出/回答/问道 …”.
    def repl(match: re.Match[str]) -> str:
        inner = match.group(1)
        return "" if _norm_dialogue_span(inner) in line_norms else match.group(0)
    text = re.sub(r'[“"‘]([^”"’]+)[”"’]', repl, text)
    for line in dialogue_lines:
        text = _strip_unquoted_dialogue_literal(text, line)
    text = re.sub(
        rf'(?:并|同时|随后)?(?:低声|轻声|平静地|冷冷地|缓慢地|直接|语气平稳地)?{_SPEECH_VERB_PATTERN}\s*[：:]?\s*[。；;，,]*$',
        '',
        text,
    )
    text = re.sub(r'[，,；;：:]\s*[。；;，,]+', '，', text)
    return text.strip('，,；;：:。 ')


def _strip_dialogue_from_performance_fragment(value: str, dialogue_lines: list[str]) -> str:
    """Remove frozen dialogue from Director-owned visual/performance prose.

    Director logic/execution may legitimately cite the current FrozenText as
    evidence, but the visual channel must never serialize that literal line a
    second time. This is a representation-only cleanup: exact dialogue stays
    untouched in the dialogue track and no replacement story content is
    invented here.
    """
    text = str(value or "").strip()
    if not text or not dialogue_lines:
        return text
    cleaned = _strip_dialogue_from_action(text, dialogue_lines)
    # Removing a quoted line from causal prose can leave a dangling speech verb
    # (e.g. “听见对方说‘…’” -> “听见对方说”). Such residue is not executable
    # visual information, so drop the whole fragment instead of emitting broken
    # internal-language text into the final prompt.
    dangling = re.search(
        r"(?:听见|听到|对方|人物|他|她|其)?(?:说|说道|回答|回应|询问|问道|问|开口|说出)$",
        cleaned,
    )
    if dangling:
        return ""
    line_norms = {_norm_dialogue_span(line) for line in dialogue_lines if _norm_dialogue_span(line)}
    cleaned_norm = _norm_dialogue_span(cleaned)
    if cleaned_norm and any(
        line_norm and (cleaned_norm == line_norm or (len(line_norm) >= 4 and line_norm in cleaned_norm))
        for line_norm in line_norms
    ):
        return ""
    return cleaned

def _age_bucket(value: str) -> str:
    text = str(value or "")
    m = re.search(r"(\d{1,3})\s*岁", text)
    if m:
        age = int(m.group(1))
        if age <= 12:
            return "child"
        if age <= 17:
            return "teen"
        if age <= 29:
            return "young"
        if age <= 49:
            return "adult"
        if age <= 64:
            return "mature"
        return "old"
    groups = (
        ("child", ("儿童", "孩童", "幼年", "童年", "小孩")),
        ("teen", ("少年", "少女", "青少年")),
        ("young", ("青年", "年轻", "二十岁", "二十多岁")),
        ("mature", ("中年", "五十岁", "六十岁")),
        ("old", ("老年", "年迈", "老人", "老头", "老太", "七十岁", "八十岁", "九十岁")),
    )
    for bucket, tokens in groups:
        if any(token in text for token in tokens):
            return bucket
    return ""


def _appearance_overlay_text(semantics: dict[str, Any], story: dict[str, Any]) -> str:
    parts: list[str] = []
    for item in semantics.get("appearance_overlays", []) or []:
        if not isinstance(item, dict):
            continue
        ref = str(item.get("character_ref") or "")
        overrides = item.get("overrides") if isinstance(item.get("overrides"), dict) else {}
        values: list[str] = []
        for key in ("age_appearance", "temporary_injury", "temporary_clothing_change"):
            value = overrides.get(key)
            if not isinstance(value, str) or not value.strip():
                continue
            clean = _strip_scene_light_context(value)
            if not clean:
                continue
            if key == "age_appearance":
                # Age overlay owns age phase only; face/light prose belongs to the
                # canonical identity or scene state. Keep only the first age clause.
                clean = re.split(r"[，,；;。]", clean, maxsplit=1)[0].strip()
                char = next((x for x in story.get("characters", []) or [] if isinstance(x, dict) and str(x.get("character_id") or "") == ref), {})
                baseline = str(((char.get("visual_lock") or {}).get("age_appearance") if isinstance(char, dict) else "") or "")
                if clean and baseline and (_age_bucket(clean) and _age_bucket(clean) == _age_bucket(baseline)):
                    continue
            if clean:
                values.append(clean)
        if ref and values:
            parts.append(f"{_char_name(story, ref)}：" + "，".join(values))
    return "；".join(dict.fromkeys(parts))


def _required_diegetic_texts(semantics: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for item in semantics.get("diegetic_text", []) or []:
        if not isinstance(item, dict) or item.get("required_visible") is not True:
            continue
        content = str(item.get("content") or "").strip()
        if content and content not in out:
            out.append(content)
    return out

_UNIQUE_PERFORMANCE_LEXEME_COMPLETIONS = (
    # These are lexical completions, not story edits. They are intentionally
    # narrow: only dangling morphemes with one safe completion in the
    # performance-cue vocabulary are normalized. Ambiguous fragments remain
    # untouched and are still owned by Production Readiness.
    (re.compile(r"(?<=开口)询(?=$|[，,。；;：:])"), "询问"),
    (re.compile(r"(?<=开口)追(?=$|[，,。；;：:])"), "追问"),
    (re.compile(r"(?<=语气带着)询(?=$|[，,。；;：:])"), "询问"),
    (re.compile(r"(?<=语气带着)追(?=$|[，,。；;：:])"), "追问"),
)


def _normalize_performance_lexemes(value: str) -> str:
    """Deterministically complete only uniquely recoverable cue lexemes.

    This runs on Director/Production-Semantics performance text before final
    prompt serialization so existing paused compile units can recover without
    regenerating creative upstream stages. It must never invent an action.
    """
    text = str(value or "")
    for pattern, replacement in _UNIQUE_PERFORMANCE_LEXEME_COMPLETIONS:
        text = pattern.sub(replacement, text)
    return text


def _clean_prompt_fragment(value: str) -> str:
    """Representation-only cleanup for generated Chinese prompt fragments."""
    text = str(value or "").strip()
    text = re.sub(r"([；;，,。])\1+", r"\1", text)
    text = re.sub(r"。+[；;]", "。", text)
    text = re.sub(r"[；;]+。", "。", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip(" ，,；;。")


_SCENE_LIGHT_CONTEXT = r"(?:夕阳|夕照|余晖|晨光|暮光|月光|夜色|正午阳光|深夜灯光|夜晚灯光)"

def _strip_scene_light_context(value: str) -> str:
    """Keep action/identity text free of scene-light authority."""
    text = str(value or "").strip()
    if not text:
        return ""
    parts = re.split(r"([，,；;。])", text)
    rebuilt: list[str] = []
    pending_sep = ""
    for part in parts:
        if not part:
            continue
        if part in {"，", ",", "；", ";", "。"}:
            pending_sep = part
            continue
        clause = part.strip()
        if re.match(rf"^{_SCENE_LIGHT_CONTEXT}(?:照|映|洒|落|打|投)", clause):
            continue
        clause = re.sub(rf"在{_SCENE_LIGHT_CONTEXT}(?:里|下|中)?", "", clause)
        clause = re.sub(rf"{_SCENE_LIGHT_CONTEXT}(?:里|下|中)", "", clause)
        clause = re.sub(rf"^{_SCENE_LIGHT_CONTEXT}(?:的)?", "", clause)
        clause = clause.strip(" ，,；;。")
        if not clause:
            continue
        if rebuilt and pending_sep:
            rebuilt.append(pending_sep)
        rebuilt.append(clause)
        pending_sep = ""
    return _clean_prompt_fragment("".join(rebuilt))


def _normalize_owned_action_subject(
    action: str, *, owner_name: str, current_names: list[str]
) -> str:
    """Normalize only deterministic explicit subject forms; never resolve aliases."""
    cleaned = _strip_scene_light_context(_clean_prompt_fragment(action))
    if not cleaned:
        return ""
    explicit_other = next((n for n in current_names if n and n != owner_name and cleaned.startswith(n)), "")
    if explicit_other:
        return cleaned
    if owner_name and cleaned.startswith(owner_name):
        cleaned = cleaned[len(owner_name):].lstrip("：:，, ")
    pronoun = next((x for x in ("他们", "她们", "他", "她", "它", "其") if cleaned.startswith(x)), "")
    if pronoun and owner_name:
        cleaned = cleaned[len(pronoun):].lstrip("，,：: ")
    return (f"{owner_name}{cleaned}" if owner_name and cleaned else cleaned)


_VISIBLE_ACTION_VERB_RE = re.compile(
    r"(?:推|走|收拾|整理|拉开|合上|抬头|低头|看向|望向|翻看|翻过|递|接过|起身|坐下|坐在|站起|站在|转身|伸手|停下|停住|拿起|放下|敲|压|修鞋|上胶|摸出|掏出|点头|摇头|前倾|后退|靠近|离开|进入|经过|回头|扶住|继续向前|滑动|按住)"
)


def _storyboard_explicit_action(shot: dict[str, Any], story: dict[str, Any]) -> str:
    """Use explicit blocking motion only after semantic/director action is absent."""
    blocking = _strip_scene_light_context(spatial_blocking(shot, story))
    if not blocking or not _VISIBLE_ACTION_VERB_RE.search(blocking):
        return ""
    clauses = [x.strip() for x in re.split(r"[，,；;]", blocking) if x.strip()]
    selected = [x for x in clauses if _VISIBLE_ACTION_VERB_RE.search(x)]
    if not selected:
        return ""
    text = "，".join(selected[:3])
    refs = [str(x) for x in shot.get("character_refs", []) or [] if isinstance(x, str)]
    if refs and not any(_char_name(story, ref) in text for ref in refs):
        text = f"{_char_name(story, refs[0])}{text}"
    return _clean_prompt_fragment(text)



def _performance_logic_authorities_for_render(shot: dict[str, Any], semantics: dict[str, Any], script: dict[str, Any]) -> list[str]:
    values: list[str] = []
    def add(value: Any) -> None:
        if isinstance(value, str) and value.strip() and value.strip() not in values:
            values.append(value.strip())
    for item in shot.get("source_evidence") or []:
        if isinstance(item, dict):
            add(item.get("quote"))
    for item in shot.get("dialogue") or []:
        if isinstance(item, dict):
            add(item.get("line") or item.get("text"))
    raw_narration = shot.get("narration")
    if isinstance(raw_narration, str):
        add(raw_narration)
    elif isinstance(raw_narration, list):
        for value in raw_narration:
            add(value)
    for group in ("visual_events", "production_choices"):
        for item in semantics.get(group) or []:
            if isinstance(item, dict):
                for ev in item.get("source_evidence") or []:
                    if isinstance(ev, dict):
                        add(ev.get("quote"))
    scene_id = str(shot.get("scene_id") or "")
    beat_id = str(shot.get("beat_id") or "")
    for scene in script.get("scenes", []) or []:
        if not isinstance(scene, dict) or str(scene.get("scene_id") or "") != scene_id:
            continue
        for beat in scene.get("beats", []) or []:
            if not isinstance(beat, dict) or str(beat.get("beat_id") or "") != beat_id:
                continue
            add(beat.get("description"))
            narration = beat.get("narration")
            if isinstance(narration, str):
                add(narration)
            elif isinstance(narration, list):
                for value in narration:
                    add(value)
            for item in beat.get("dialogue") or []:
                if isinstance(item, dict):
                    add(item.get("line") or item.get("text"))
    return values


def _performance_execution_authorities_for_render(
    shot: dict[str, Any], semantics: dict[str, Any], script: dict[str, Any]
) -> list[str]:
    """Mirror Director-stage execution authority at compile time.

    ``performance_logic`` is intentionally evidence/context grounded. Execution
    modulation may additionally reference the already-validated Production
    Semantics action/choice surface and frozen Base Shot spatial description.
    Keeping this authority identical to Director admission prevents a legal field
    from passing Stage 7 and then being silently dropped or rejected at Stage 9.
    """
    values = list(_performance_logic_authorities_for_render(shot, semantics, script))

    def add(value: Any) -> None:
        if isinstance(value, str) and value.strip() and value.strip() not in values:
            values.append(value.strip())

    for group in ("visual_events", "production_choices"):
        for item in semantics.get(group) or []:
            if not isinstance(item, dict):
                continue
            for key in ("action", "choice", "description"):
                add(item.get(key))
    for key in ("description", "spatial_blocking", "composition"):
        add(shot.get(key))
    return values


def _logic_grounded_for_render(item: dict[str, Any], authorities: list[str]) -> bool:
    return logic_item_renderable(item, authorities)


def _renderable_logic_fields_for_render(item: dict[str, Any], authorities: list[str]) -> dict[str, str]:
    return renderable_logic_fields(item, authorities)


def _v17_gaze_text(shot: dict[str, Any], story: dict[str, Any], semantics: dict[str, Any] | None = None, script: dict[str, Any] | None = None) -> tuple[str, list[dict[str, Any]]]:
    director = shot.get("director") if isinstance(shot.get("director"), dict) else {}
    if not visible_character_refs(shot, director=director, legacy_fallback=True):
        return "无", []
    overall_by_ref: dict[str, str] = {}
    during_line_by_ref: dict[str, list[str]] = {}
    order: list[str] = []
    rendered_trace: list[dict[str, Any]] = []

    def ensure_ref(ref: str) -> None:
        if ref and ref not in order:
            order.append(ref)

    execution_authorities = _performance_execution_authorities_for_render(shot, semantics or {}, script or {})
    allowed_entities = _allowed_entity_terms_for_shot(shot, story)
    for execution_index, raw_item in enumerate(director.get("performance_execution") or []):
        if not isinstance(raw_item, dict):
            continue
        item = filter_performance_execution_item(raw_item, execution_authorities, allowed_entity_terms=allowed_entities)
        ref = str(item.get("character_ref") or "")
        gaze = _clean_prompt_fragment(str(item.get("gaze") or ""))
        if ref and gaze:
            ensure_ref(ref)
            overall_by_ref.setdefault(ref, gaze)
            rendered_trace.append({
                "source": "performance_execution",
                "index": execution_index,
                "field": "gaze",
                "value": gaze,
            })

    for delivery_index, raw_item in enumerate(director.get("dialogue_delivery") or []):
        if not isinstance(raw_item, dict):
            continue
        item = filter_dialogue_delivery_item(raw_item, allowed_entity_terms=allowed_entities)
        ref = str(item.get("speaker_ref") or "")
        gaze = _clean_prompt_fragment(str(item.get("gaze_during_line") or ""))
        if ref and gaze:
            ensure_ref(ref)
            values = during_line_by_ref.setdefault(ref, [])
            if gaze not in values:
                values.append(gaze)
            rendered_trace.append({
                "source": "dialogue_delivery",
                "index": delivery_index,
                "field": "gaze_during_line",
                "value": gaze,
            })

    rendered: list[str] = []
    for ref in order:
        name = _char_name(story, ref)
        overall = overall_by_ref.get(ref, "")
        line_values = during_line_by_ref.get(ref, [])
        clauses: list[str] = []
        if overall:
            clauses.append(overall)
        for gaze in line_values:
            if gaze == overall:
                continue
            clauses.append("说台词时" + gaze)
        if not clauses:
            continue
        text = "；".join(clauses)
        if name and not text.startswith(name):
            text = name + text
        rendered.append(text)
    return "；".join(rendered[:3]) or "按当前人物关系保持自然视线", rendered_trace


def _v17_performance_text(
    shot: dict[str, Any], semantics: dict[str, Any], story: dict[str, Any], script: dict[str, Any]
) -> tuple[str, int, list[dict[str, Any]]]:
    director = shot.get("director") if isinstance(shot.get("director"), dict) else {}
    logic = [x for x in director.get("performance_logic", []) or [] if isinstance(x, dict)]
    execution = [x for x in director.get("performance_execution", []) or [] if isinstance(x, dict)]
    if not logic and not execution:
        return "", 0, []
    dialogue_lines = _dialogue_lines(semantics, shot)
    logic_authorities = _performance_logic_authorities_for_render(shot, semantics, script)
    execution_authorities = _performance_execution_authorities_for_render(shot, semantics, script)
    parts: list[str] = []
    signal_count = 0
    rendered_trace: list[dict[str, Any]] = []
    for item in logic:
        renderable = _renderable_logic_fields_for_render(item, logic_authorities)
        if not renderable:
            continue
        ref = str(item.get("character_ref") or "")
        name = _char_name(story, ref) if ref else ""
        trigger = _clean_prompt_fragment(_strip_dialogue_from_performance_fragment(str(renderable.get("trigger") or ""), dialogue_lines))
        base = _clean_prompt_fragment(_strip_dialogue_from_performance_fragment(str(renderable.get("base_emotion") or ""), dialogue_lines))
        delta = _clean_prompt_fragment(_strip_dialogue_from_performance_fragment(str(renderable.get("emotion_delta") or ""), dialogue_lines))
        goal = _clean_prompt_fragment(_strip_dialogue_from_performance_fragment(str(renderable.get("behavior_goal") or ""), dialogue_lines))
        tendency = _clean_prompt_fragment(_strip_dialogue_from_performance_fragment(str(renderable.get("behavior_tendency") or ""), dialogue_lines))
        clauses: list[str] = []
        if trigger:
            clauses.append(f"因{trigger}")
        if base:
            clauses.append(f"底层状态保持{base}")
        if delta:
            clauses.append(f"本镜{delta}")
        if goal:
            clauses.append(f"行为目标是{goal}")
        elif tendency:
            clauses.append(f"行为趋向{tendency}")
        if clauses:
            parts.append((name if name else "人物") + "".join("，" + x if i else x for i, x in enumerate(clauses)))
    allowed_entities = _allowed_entity_terms_for_shot(shot, story)
    for execution_index, raw_item in enumerate(execution):
        item = filter_performance_execution_item(raw_item, execution_authorities, allowed_entity_terms=allowed_entities)
        ref = str(item.get("character_ref") or "")
        name = _char_name(story, ref) if ref else ""
        fields = []
        # gaze has its own final field and is not duplicated here.
        for field in ("expression", "breathing", "body", "hands", "movement", "micro_reaction", "action_transition", "end_state"):
            value = _clean_prompt_fragment(_strip_dialogue_from_performance_fragment(str(item.get(field) or ""), dialogue_lines))
            if value and value not in fields:
                fields.append(value)
                signal_count += 1
                rendered_trace.append({
                    "source": "performance_execution",
                    "index": execution_index,
                    "field": field,
                    "value": value,
                })
        if fields:
            text = "，".join(fields)
            if name and not text.startswith(name):
                text = name + text
            parts.append(text)
    return "。".join(dict.fromkeys(parts)).strip("。"), signal_count, rendered_trace


def _merge_performance_clauses(*values: str) -> str:
    """Merge rendered performance fragments with exact clause-level de-duplication.

    Objective actions may legitimately appear both in validated ``performance_actions``
    and in a Director execution field when the latter is authorized by the same current-
    shot evidence.  Those are two representations of one story action, not two actions.
    De-duplicate only exact normalized clauses; do not paraphrase, reorder or collapse
    distinct acting details.
    """
    clauses: list[str] = []
    seen: set[str] = set()
    for value in values:
        for raw in re.split(r"[。；;]+", str(value or "")):
            clause = raw.strip().strip("，,")
            if not clause:
                continue
            key = re.sub(r"[\s，,。；;：:]", "", clause)
            if key and key not in seen:
                clauses.append(clause)
                seen.add(key)
    return "。".join(clauses).rstrip("。")


def _performance_text_with_source(
    shot: dict[str, Any],
    semantics: dict[str, Any],
    story: dict[str, Any],
    *,
    include_dramatic_intent: bool = True,
) -> tuple[str, str]:
    director = shot.get("director") if isinstance(shot.get("director"), dict) else {}
    dialogue_lines = _dialogue_lines(semantics, shot)
    current_names = [
        _char_name(story, str(cid))
        for cid in shot.get("character_refs", []) or []
        if isinstance(cid, str) and cid
    ]
    actions=[]
    for item in director.get("performance_actions", []) or []:
        if not isinstance(item, dict):
            continue
        ref=str(item.get("character_ref") or "")
        action=_strip_dialogue_from_action(str(item.get("action") or ""), dialogue_lines).rstrip("。")
        action=_normalize_performance_lexemes(action)
        name = _char_name(story, ref) if ref else ""
        action = _normalize_owned_action_subject(action, owner_name=name, current_names=current_names)
        if action:
            actions.append(action)
    source = "director" if actions else ""
    if not actions:
        for item in semantics.get("visual_events", []) or []:
            if not isinstance(item, dict):
                continue
            action=_strip_dialogue_from_action(str(item.get("action") or ""), dialogue_lines).rstrip("。")
            action=_normalize_performance_lexemes(action)
            refs=[str(x) for x in item.get("character_refs", []) or [] if isinstance(x, str) and x]
            owner_name = _char_name(story, refs[0]) if len(refs) == 1 else ""
            action = _normalize_owned_action_subject(action, owner_name=owner_name, current_names=current_names)
            if action:
                actions.append(action)
        if actions:
            source = "production_semantics"
    intent=str(director.get("dramatic_intent") or "").strip().rstrip("。")
    text="；".join(dict.fromkeys(actions))
    if include_dramatic_intent and intent:
        text = (f"表演意图：{intent}。" + (text + "。" if text else ""))
    if text:
        return text, source or "director"
    blocking_action = _storyboard_explicit_action(shot, story)
    if blocking_action:
        # Storyboard fallback is still a non-dialogue visual channel. A Base Shot
        # action/composition may legitimately quote the same FrozenText for
        # context, but the literal utterance must remain owned by the dialogue
        # track. Apply the same deterministic stripping used for Director and
        # Production-Semantics action paths before serializing the fallback.
        blocking_action = _strip_dialogue_from_action(blocking_action, dialogue_lines)
        blocking_action = _clean_prompt_fragment(_strip_scene_light_context(blocking_action))
        if blocking_action:
            return blocking_action + "。", "storyboard_explicit_action"
    return "", "none"


def _performance_text(
    shot: dict[str, Any],
    semantics: dict[str, Any],
    story: dict[str, Any],
    *,
    include_dramatic_intent: bool = True,
) -> str:
    return _performance_text_with_source(
        shot, semantics, story, include_dramatic_intent=include_dramatic_intent
    )[0]


def _narration_text(shot: dict[str, Any], semantics: dict[str, Any]) -> str:
    raw = shot.get("narration")
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    if isinstance(raw, list):
        values=[str(x) for x in raw if isinstance(x, str) and x]
        if values:
            # Storyboard narration is frozen Script text. Segment boundaries are
            # allocation metadata, not an instruction to inject new punctuation.
            return "".join(values).strip()
    # Future-compatible: allow an explicit non-dialogue voiceover field without
    # treating generic non-diegetic SFX as narration.
    raw = semantics.get("narration")
    return str(raw).strip() if isinstance(raw, str) and raw.strip() else "无"


def _clock(seconds: float) -> str:
    seconds=max(0.0,float(seconds))
    mins=int(seconds//60)
    secs=seconds-mins*60
    if abs(secs-round(secs)) < 1e-9:
        return f"{mins}:{int(round(secs)):02d}"
    return f"{mins}:{secs:04.1f}"


def _director_framing_camera_prefix(shot: dict[str, Any], story: dict[str, Any]) -> str:
    director = shot.get("director") if isinstance(shot.get("director"), dict) else {}
    framing = director.get("execution_framing") if isinstance(director.get("execution_framing"), dict) else {}
    framing_type = str(framing.get("framing_type") or "")
    foreground = [str(x) for x in framing.get("foreground_character_refs", []) or [] if isinstance(x, str) and x]
    target = director.get("visual_target") if isinstance(director.get("visual_target"), dict) else {}
    target_chars = [str(x) for x in target.get("character_refs", []) or [] if isinstance(x, str) and x]
    if framing_type == "over_shoulder" and foreground:
        foreground_name = _char_name(story, foreground[0])
        target_name = _char_name(story, target_chars[0]) if target_chars else "主体"
        return f"越过{foreground_name}肩后拍摄{target_name}"
    if framing_type == "two_shot":
        return "双人关系构图"
    if framing_type == "reaction":
        return "反应镜头"
    if framing_type == "detail":
        return "局部细节构图"
    if framing_type == "environment":
        return "环境建立构图"
    return ""


def build_shot_consumption_manifest(
    shot: dict[str, Any],
    semantics: dict[str, Any],
    story: dict[str, Any],
    script: dict[str, Any],
    pvb: dict[str, Any],
    psb: dict[str, Any],
    style_guide: dict[str, Any],
    *,
    aspect_ratio: str = "9:16",
    timeline_start_seconds: float = 0.0,
    shot_index: int | None = None,
    shot_size_label: str = "",
    camera_label: str = "",
    movement_label: str = "",
    time_label: str = "",
    scene_name: str = "",
    character_assets_override: str | None = None,
    scene_assets_override: str | None = None,
    scene_state_override: str | None = None,
    global_style_override: str | None = None,
    include_dramatic_intent: bool = True,
    character_anchor_label: str = "人物视觉锁定",
    scene_anchor_label: str = "场景生产视觉",
    text_constraint_override: str | None = None,
    shot_spatial_context: str = "",
) -> dict[str, Any]:
    duration=float(shot.get("duration") or 0.0)
    end=timeline_start_seconds+duration
    action_sfx, environment_sfx, atmosphere_sfx = _audio_groups(semantics)
    character_refs=[str(x) for x in shot.get("character_refs", []) or [] if isinstance(x,str)]
    character_assets = (
        character_assets_override
        if character_assets_override is not None
        else character_asset_summary(story, pvb, character_refs)
    )
    scene_assets = (
        scene_assets_override
        if scene_assets_override is not None
        else scene_asset_summary(story, psb, str(shot.get("location_ref") or ""))
    )
    global_style = global_style_override if global_style_override is not None else style_summary(style_guide)
    performance, performance_source = _performance_text_with_source(
        shot, semantics, story, include_dramatic_intent=include_dramatic_intent
    )
    v17_performance, v17_signal_count, performance_execution_trace = _v17_performance_text(shot, semantics, story, script)
    if v17_performance:
        # Preserve objective action authority while letting Director acting execution
        # lead the paragraph.  Merge at clause granularity so the same authorized
        # story action cannot be rendered twice merely because it exists in both the
        # objective-action and execution representations.
        performance = _merge_performance_clauses(v17_performance, performance)
        if performance:
            performance += "。"
        performance_source = "director_v17"
    gaze_text, gaze_trace = _v17_gaze_text(shot, story, semantics, script)
    dialogue_text, dialogue_delivery_trace = _dialogue_text_with_trace(semantics, shot, story)
    overlay=_appearance_overlay_text(semantics, story)
    diegetic_texts=_required_diegetic_texts(semantics)
    visual_parts=[]
    if character_assets:
        visual_parts.append((character_anchor_label + "：" if character_anchor_label else "") + character_assets)
    if overlay:
        visual_parts.append(overlay)
    if performance:
        visual_parts.append(performance.rstrip("。"))
    if diegetic_texts:
        visual_parts.append("画面内文字：" + "、".join(f"“{x}”" for x in diegetic_texts))
    if scene_assets:
        visual_parts.append((scene_anchor_label + "：" if scene_anchor_label else "") + scene_assets)
    if scene_state_override:
        visual_parts.append("场景状态：" + scene_state_override)
    if global_style:
        visual_parts.append("整体视觉基调："+global_style)
    if text_constraint_override is not None:
        visual_parts.append(text_constraint_override)
    elif diegetic_texts:
        visual_parts.append("仅允许剧情明确要求的画面内文字" + "、".join(f"“{x}”" for x in diegetic_texts) + "；禁止新增其他字幕、水印、无依据标志或乱码文字")
    else:
        visual_parts.append("画面无字幕、水印或无依据可阅读文字")
    blocking = _strip_scene_light_context(spatial_blocking(shot, story))
    composition=str(shot.get("composition") or "").strip().rstrip("。")
    framing_prefix = _director_framing_camera_prefix(shot, story)
    camera_parts=[x for x in (framing_prefix, camera_label, movement_label) if x]
    camera_text="，".join(camera_parts)
    director_obj = shot.get("director") if isinstance(shot.get("director"), dict) else {}
    camera_execution = director_obj.get("camera_execution") if isinstance(director_obj.get("camera_execution"), dict) else {}
    framing_note = _clean_prompt_fragment(str(camera_execution.get("framing_note") or ""))
    camera_authorities = _performance_execution_authorities_for_render(shot, semantics, script)
    for extra in (blocking, scene_assets, scene_state_override or "", scene_name, shot_spatial_context):
        text = str(extra or "").strip()
        if text and text not in camera_authorities:
            camera_authorities.append(text)
    camera_allowed_entities = _allowed_entity_terms_for_shot(shot, story)
    if framing_note and (
        framing_note_violations(framing_note)
        or framing_note_authority_violations(
            framing_note, authority_texts=camera_authorities, allowed_entity_terms=camera_allowed_entities
        )
    ):
        framing_note = ""
    def _norm_layout_text(value: str) -> str:
        return re.sub(r"[\s，,。；;：:]", "", str(value or ""))
    if framing_note:
        camera_text += ("；" if camera_text else "") + "构图：" + framing_note
    elif not camera_execution and composition and _norm_layout_text(composition) != _norm_layout_text(blocking):
        # Legacy-only fallback. v17 never lets Storyboard composition leak action,
        # lighting or dialogue back into the camera field.
        camera_text += ("；" if camera_text else "") + "构图：" + composition
    scene_parts=[x for x in (scene_name,time_label) if x]
    manifest = {
        "shot_id": str(shot.get("shot_id") or ""),
        "shot_index": shot_index,
        "duration_seconds": duration,
        "timeline": f"{_clock(timeline_start_seconds)}–{_clock(end)}｜{duration:g}s",
        "aspect_ratio": aspect_ratio,
        "scene": " ".join(scene_parts) or str(shot.get("location_ref") or ""),
        "shot_spatial_context": shot_spatial_context,
        "spatial_blocking": blocking,
        "shot_size": shot_size_label or str(shot.get("shot_size") or ""),
        "camera": camera_text or "按冻结镜头规格执行",
        "gaze": gaze_text,
        "visual_content": "。".join(_clean_prompt_fragment(x) for x in visual_parts if x).rstrip("。") + "。",
        "performance_source": performance_source,
        "performance_text": performance,
        "performance_execution_signal_count": v17_signal_count,
        "character_continuity_anchor": character_assets,
        "scene_continuity_anchor": scene_assets,
        "global_style_anchor": global_style,
        "scene_state_anchor": scene_state_override or "",
        "narration": _narration_text(shot,semantics),
        "dialogue": dialogue_text,
        "action_sfx": action_sfx,
        "environment_sfx": environment_sfx,
        "atmosphere_sfx": atmosphere_sfx,
        "music": "无",
        "provenance": {
            "source": ["ShotSpec", "Production Semantics", "Director", "PVB", "PSB", "Style Guide"],
            "character_refs": character_refs,
            "prop_refs": [str(x) for x in shot.get("prop_refs", []) or [] if isinstance(x,str)],
            "scene_ref": str(shot.get("location_ref") or ""),
            "shot_spatial_context": shot_spatial_context,
            "performance_source": performance_source,
            "scene_state_anchor": scene_state_override or "",
            "camera_framing_authority": camera_authorities,
            "camera_allowed_entity_terms": camera_allowed_entities,
            "performance_execution_authority": _performance_execution_authorities_for_render(shot, semantics, script),
            "rendered_modifier_trace_version": "modifier_trace.v1",
            "rendered_modifier_trace": performance_execution_trace + gaze_trace + dialogue_delivery_trace,
            "frozen_text_unit_refs": {
                "dialogue": [
                    str(x) for x in ((shot.get("frozen_text_unit_refs") or {}).get("dialogue") or [])
                    if isinstance(x, str) and x
                ],
                "narration": [
                    str(x) for x in ((shot.get("frozen_text_unit_refs") or {}).get("narration") or [])
                    if isinstance(x, str) and x
                ],
            },
        },
    }
    # Compiler-owned surface fingerprints let Production Readiness distinguish
    # a real post-compile manifest mutation from a raw optional Director field
    # that was correctly filtered before rendering. Do not infer provenance by
    # searching aggregate strings: identical wording can legally come from a
    # different channel.
    manifest["provenance"]["rendered_surface_fingerprint_version"] = "surface_hash.v1"
    manifest["provenance"]["rendered_surface_fingerprints"] = {
        field: hashlib.sha256(str(manifest.get(field) or "").encode("utf-8")).hexdigest()
        for field in ("gaze", "performance_text", "dialogue")
    }
    return manifest


def render_shot_prompt(manifest: dict[str, Any]) -> str:
    idx=manifest.get("shot_index")
    number=f"{int(idx):02d}" if isinstance(idx,int) else str(manifest.get("shot_id") or "")
    return "\n".join([
        f"镜号：{number}",
        f"时长：{manifest.get('timeline')}",
        f"场景：{manifest.get('scene')}",
        f"人物空间站位：{manifest.get('spatial_blocking')}",
        f"景别：{manifest.get('shot_size')}",
        f"摄法：{manifest.get('camera')}",
        f"人物视线：{manifest.get('gaze') or '无'}",
        f"画面内容：{manifest.get('visual_content')}",
        f"旁白：{manifest.get('narration')}",
        f"台词：{manifest.get('dialogue')}",
        f"动作音效：{manifest.get('action_sfx')}",
        f"环境音效：{manifest.get('environment_sfx')}",
        f"氛围音效：{manifest.get('atmosphere_sfx')}",
        "配乐：无",
    ])
