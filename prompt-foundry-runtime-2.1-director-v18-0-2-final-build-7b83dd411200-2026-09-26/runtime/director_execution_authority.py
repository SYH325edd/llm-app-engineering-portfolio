from __future__ import annotations

import re
from typing import Any


def _norm(value: Any) -> str:
    return re.sub(r"\s+", "", str(value or "").strip()).casefold()


def _blob(values: list[str]) -> str:
    return " ".join(_norm(x) for x in values if _norm(x))


# Objective actions change story state. Local acting modulation does not.
_OBJECTIVE_ACTION_TERMS = (
    "抬起", "拿起", "放下", "递给", "抓住", "掐住", "勒住", "推倒", "推开", "推下", "拉开", "打开", "关上",
    "冲向", "冲出", "冲进", "跑向", "跑出", "逃跑", "逃离", "离开", "走向", "走出", "进入", "闯入", "追赶",
    "抢走", "夺走", "偷走", "拿走", "带走", "扔掉", "摔碎", "破坏", "点燃", "烧掉", "开枪", "刺伤", "砍伤",
    "亲吻", "拥抱", "殴打", "扇", "报警", "联系", "跟踪", "跪下", "倒下", "死亡", "杀死", "杀掉", "绑架",
)
_HIGH_RISK_FACT_TERMS = (
    "手枪", "枪", "刀", "持刀", "血迹", "鲜血", "流血", "刀伤", "枪伤", "伤口", "尸体", "爆炸", "着火", "燃烧",
    "陌生人", "警察", "警方", "医生", "救护车", "炸弹",
)
_SAFE_MODULATION_TERMS = (
    "目光", "视线", "眼神", "眉", "嘴角", "下颌", "呼吸", "肩", "身体", "重心", "姿态", "手指", "手腕", "手臂",
    "绷紧", "收紧", "放松", "颤抖", "停顿", "顿住", "僵住", "前压", "后仰", "前倾", "低垂", "抬眼", "垂眼",
    "加重", "减轻", "加快", "放缓", "缓慢", "短暂", "轻微", "明显", "悬停", "握拳", "松开拳头", "节奏",
)
_FIELD_SIGNAL = {
    "expression": re.compile(r"(?:眉|眼|眼神|眼眶|嘴|嘴角|下颌|牙关|表情|神情|鼻翼|面部)"),
    "gaze": re.compile(r"(?:目光|视线|看向|盯|锁定|落向|移向|凝视|抬眼|垂眼|望向)"),
    "breathing": re.compile(r"(?:呼吸|吸气|呼气|气息|胸口起伏)"),
    "body": re.compile(r"(?:身体|重心|肩|肩膀|头|下颌|颈|躯干|胸口|背部|姿态|前倾|后仰|前压)"),
    "hands": re.compile(r"(?:手|手指|手掌|手腕|手臂|拳)"),
    "micro_reaction": re.compile(r"(?:一颤|微颤|停顿|顿住|僵住|呼吸|目光|视线|眼|眉|嘴|肩|手|重心)"),
}
_CAUSAL_EVENT_RE = re.compile(r"(?:因为|因|由于|听见|看到|发现|得知|突然出现|闯入|爆炸|着火|中枪|被刺|被砍)")


def _direct_authority(value: str, authorities: list[str]) -> bool:
    needle = _norm(value)
    if not needle:
        return False
    return any(needle in _norm(a) or _norm(a) in needle for a in authorities if _norm(a))


_CLAUSE_SPLIT_RE = re.compile(r"[，,；;。！？!?]+")
_LOCAL_ARTICULATION_TERMS = {"抬起", "放下"}
_LOCAL_ARTICULATION_PARTS = {
    "expression": ("眉", "眼", "眼皮", "眼睛", "嘴", "嘴角", "嘴唇", "下颌", "牙关", "鼻翼", "面部", "表情", "神情"),
    "gaze": ("眼", "眼睛", "目光", "视线", "头", "下颌"),
    "body": ("头", "下颌", "肩", "肩膀", "手", "手臂", "身体", "躯干"),
    "hands": ("手", "手指", "手掌", "手腕", "手臂", "拳", "拳头"),
    "micro_reaction": ("眉", "眼", "嘴", "嘴角", "下颌", "肩", "肩膀", "手", "手指", "头"),
}


def _is_local_articulation_clause(field: str, clause: str, term: str) -> bool:
    """Return True when an ambiguous motion verb is only local body acting.

    Chinese acting language commonly uses ``抬起/放下`` for eyebrows, gaze,
    chin, shoulders or hands. Treating those phrases as plot-state mutations is
    a category error. The exemption is deliberately narrow: it applies only to
    typed performance channels, only to the two ambiguous articulation verbs,
    and only when the same clause names a body/performance part owned by that
    channel. Object interactions such as ``拿起枪`` or ``放下箱子`` remain hard.
    """
    if term not in _LOCAL_ARTICULATION_TERMS:
        return False
    parts = _LOCAL_ARTICULATION_PARTS.get(field) or ()
    if not parts:
        return False

    # Keep the exemption local to the verb occurrence. A body word elsewhere in
    # the same long clause must not authorize an object action such as
    # ``肩膀放松后放下箱子``. Four Chinese characters cover ordinary acting
    # constructions (``嘴角微微抬起`` / ``手又慢慢放下``) without turning the
    # whole clause into a blanket exception.
    start = 0
    while True:
        index = clause.find(term, start)
        if index < 0:
            break
        window = clause[max(0, index - 4): min(len(clause), index + len(term) + 4)]
        if not any(part in window for part in parts):
            return False
        start = index + len(term)
    return True


def _objective_terms(field: str, value: str) -> list[str]:
    text = str(value or "")
    clauses = [clause for clause in _CLAUSE_SPLIT_RE.split(text) if clause]
    out: list[str] = []
    for term in _OBJECTIVE_ACTION_TERMS:
        term_clauses = [clause for clause in clauses if term in clause]
        if not term_clauses:
            continue
        if all(_is_local_articulation_clause(field, clause, term) for clause in term_clauses):
            continue
        out.append(term)
    return out


def _high_risk_terms(value: str, allowed_entity_terms: list[str]) -> list[str]:
    text = str(value or "")
    allowed_blob = _blob(allowed_entity_terms)
    out: list[str] = []
    for term in _HIGH_RISK_FACT_TERMS:
        if term in text and _norm(term) not in allowed_blob:
            out.append(term)
    return out


def _objective_terms_authorized(field: str, value: str, authorities: list[str]) -> bool:
    terms = _objective_terms(field, value)
    if not terms:
        return True
    authority_blob = _blob(authorities)
    return all(_norm(term) in authority_blob for term in terms)


def performance_execution_field_violations(
    field: str,
    value: Any,
    authorities: list[str],
    *,
    allowed_entity_terms: list[str] | None = None,
) -> list[str]:
    text = str(value or "").strip()
    if not text:
        return []
    allowed_entity_terms = allowed_entity_terms or []
    problems: list[str] = []

    risky = _high_risk_terms(text, allowed_entity_terms)
    if risky and not _direct_authority(text, authorities):
        problems.append("unauthorized_story_fact:" + ",".join(risky))

    # Typed acting fields are already semantically scoped by the field name.
    # Do not require the value to repeat a channel keyword such as “表情/呼吸/手”;
    # concise modulation like “平静而专注”“平稳”“自然搭在膝盖上” is valid.
    # What remains hard-gated is objective story change, external causal events,
    # and high-risk facts that are not present in current Shot authority.
    if field in {"expression", "gaze", "breathing", "body", "micro_reaction"}:
        if _CAUSAL_EVENT_RE.search(text) and not _direct_authority(text, authorities):
            problems.append("unauthorized_external_trigger")
        if not _objective_terms_authorized(field, text, authorities):
            problems.append("unauthorized_objective_action")
        return list(dict.fromkeys(problems))

    # hands may freely describe local hand modulation/pose; object-changing hand actions
    # (拿起/抓住/扔掉/抢走...) still require current Shot action authority.
    if field == "hands":
        if _CAUSAL_EVENT_RE.search(text) and not _direct_authority(text, authorities):
            problems.append("unauthorized_external_trigger")
        if not _objective_terms_authorized(field, text, authorities):
            problems.append("unauthorized_objective_action")
        return list(dict.fromkeys(problems))

    # movement / transition / end state can change objective story state. Keep only
    # pure acting modulation unless objective action words are present in authority.
    if field in {"movement", "action_transition", "end_state"}:
        if not _objective_terms_authorized(field, text, authorities):
            problems.append("unauthorized_objective_action")
        if risky and not _direct_authority(text, authorities):
            problems.append("unauthorized_story_fact:" + ",".join(risky))
        if not _objective_terms(field, text):
            # If it is not objective, require recognizable acting modulation or an exact authority phrase.
            if not any(term in text for term in _SAFE_MODULATION_TERMS) and not _direct_authority(text, authorities):
                problems.append("outside_performance_modulation_grammar")
        return list(dict.fromkeys(problems))

    return list(dict.fromkeys(problems))


def performance_execution_hard_violations(
    field: str,
    value: Any,
    authorities: list[str],
    *,
    allowed_entity_terms: list[str] | None = None,
) -> list[str]:
    """Return only violations that prove objective story/authority leakage.

    Director acting language is open-ended. ``outside_performance_modulation_grammar``
    means the phrase is not recognized by today's positive modulation vocabulary;
    it is not evidence that the model changed the story.
    """
    violations = performance_execution_field_violations(
        field, value, authorities, allowed_entity_terms=allowed_entity_terms
    )
    return [v for v in violations if v != "outside_performance_modulation_grammar"]


def performance_execution_unrecognized(
    field: str,
    value: Any,
    authorities: list[str],
    *,
    allowed_entity_terms: list[str] | None = None,
) -> bool:
    violations = performance_execution_field_violations(
        field, value, authorities, allowed_entity_terms=allowed_entity_terms
    )
    return bool(violations) and not performance_execution_hard_violations(
        field, value, authorities, allowed_entity_terms=allowed_entity_terms
    )


def filter_performance_execution_item(
    item: dict[str, Any], authorities: list[str], *, allowed_entity_terms: list[str] | None = None
) -> dict[str, Any]:
    out = {"character_ref": str(item.get("character_ref") or "")}
    for field in ("expression", "gaze", "breathing", "body", "hands", "movement", "micro_reaction", "action_transition", "end_state"):
        value = str(item.get(field) or "").strip()
        if value and not performance_execution_hard_violations(
            field, value, authorities, allowed_entity_terms=allowed_entity_terms
        ):
            out[field] = value
    return out


_EMOTION_RE = re.compile(
    r"^(?:(?:轻微|明显|强烈|压住|克制的|持续的|略带|带着一点|有些)?"
    r"(?:愤怒|暴怒|怒意|压怒|伤心|悲伤|失望|绝望|心死|害怕|恐惧|紧张|克制|平静|冷淡|轻蔑|讥讽|不耐烦|烦躁|嫉妒|震惊|惊讶|好奇|疑惑|不解|试探|迟疑|犹豫|关切|警惕|戒备|坚定|温和|愧疚|自责))"
    r"(?:[、，, /]+(?:(?:轻微|明显|强烈|压住|克制的|持续的|略带|带着一点|有些)?"
    r"(?:愤怒|暴怒|怒意|压怒|伤心|悲伤|失望|绝望|心死|害怕|恐惧|紧张|克制|平静|冷淡|轻蔑|讥讽|不耐烦|烦躁|嫉妒|震惊|惊讶|好奇|疑惑|不解|试探|迟疑|犹豫|关切|警惕|戒备|坚定|温和|愧疚|自责)))*$"
)
_VOLUME_RE = re.compile(
    r"^(?:很轻|轻|很低|低|偏低|中低|正常|中等|中高|偏高|高|很高|"
    r"压低声音|压着声音|提高音量|放低音量|音量逐渐(?:升高|降低)|声音逐渐(?:变大|变小))$"
)
_PACE_RE = re.compile(
    r"^(?:很慢|缓慢|偏慢|正常|平稳|稍快|偏快|很快|逐渐加快|逐渐放慢|"
    r"前半(?:较慢|平稳|压低)，?后半(?:加重|加快|放慢)|后半(?:加重|加快|放慢)|短促|一字一顿)$"
)
_PAUSE_RE = re.compile(
    r"^(?:(?:开口前|句中|句尾|说话前|回答前|发问前|某词后|关键词后|称呼后)?"
    r"(?:短暂|轻微|明显|片刻|一下)?停顿|不停顿|略作停顿|停一下)$"
)

# Dialogue delivery is a typed channel, so natural wording is allowed as long as
# every clause remains about voice/wording/manner. We deliberately validate the
# semantic category rather than enumerate one exact sentence shape; story events
# are rejected separately below.
_DELIVERY_CHANNEL_TERMS = (
    "咬字", "吐字", "语气", "声音", "声线", "尾音", "气声", "口吻", "语调", "发声", "措辞", "说话",
)
_DELIVERY_STYLE_TERMS = (
    "清晰", "清楚", "偏重", "加重", "放轻", "压低", "低沉", "沙哑", "轻颤", "颤抖", "平稳", "自然",
    "克制", "冷淡", "冷硬", "平静", "平淡", "讥讽", "轻蔑", "急促", "缓慢", "短促", "简短", "直接",
    "干脆", "坚定", "迟疑", "犹豫", "试探", "询问", "追问", "好奇", "疑惑", "不解", "关切", "警惕",
    "戒备", "温和", "柔和", "生硬", "含糊", "哽咽", "哭腔", "颤音", "怒火", "压怒", "不耐烦", "烦躁",
    "上扬", "下沉", "收住", "拖长", "略重", "略轻", "偏轻", "偏沉", "有力", "无力", "低声", "轻声",
)
_DELIVERY_CONNECTOR_TERMS = (
    "带着", "带有", "略带", "有些", "一点", "一点点", "轻微", "明显", "保持", "显得", "更", "略微", "稍微",
    "没有", "不带", "压着", "地", "的", "意味", "感觉", "感", "方式", "一点儿", "并且", "同时", "而且",
    "说", "开口", "回答", "询问", "发问", "和", "与", "但", "而", "一丝", "几分",
)
_DELIVERY_SPLIT_RE = re.compile(r"[、，,/；;]+")
_GAZE_SIGNAL_RE = re.compile(r"(?:目光|视线|眼神|看向|盯住|盯着|锁定|凝视|望向|抬眼|垂眼|扫向|移向|落向|停在|停留在|落在|看着)")
_DELIVERY_EVENT_RE = re.compile(
    r"(?:因为|由于|童年|过去|曾经|复仇|报复|杀人|杀死|杀掉|逃跑|逃离|枪声|爆炸|着火|持刀|闯入|报警|"
    r"背叛|出轨|惩罚|中枪|被刺|被砍|流血|尸体|警察|救护车|抢走|夺走|推下|开枪|烧掉|绑架|死亡)"
)


def _strip_delivery_vocabulary(clause: str) -> str:
    residual = re.sub(r"\s+", "", clause)
    # Longest first prevents a shorter token from leaving fragments.
    vocabulary = sorted(
        set(_DELIVERY_CHANNEL_TERMS + _DELIVERY_STYLE_TERMS + _DELIVERY_CONNECTOR_TERMS),
        key=len,
        reverse=True,
    )
    for token in vocabulary:
        residual = residual.replace(token, "")
    residual = re.sub(r"[（）()：:。！!？?\-—]", "", residual)
    return residual.strip()


def _delivery_clause_is_controlled(clause: str) -> bool:
    value = str(clause or "").strip()
    if not value:
        return True
    # A clause must contain either a voice/delivery channel or a recognized
    # manner descriptor. This accepts natural combinations such as
    # “语气平淡自然”“略带好奇和试探”“咬字清楚、尾音收住”.
    if not any(token in value for token in (_DELIVERY_CHANNEL_TERMS + _DELIVERY_STYLE_TERMS)):
        return False
    return _strip_delivery_vocabulary(value) == ""


def _gaze_target_authorized(text: str, allowed_entity_terms: list[str]) -> bool:
    value = re.sub(r"\s+", "", str(text or "").strip())
    if not value or not _GAZE_SIGNAL_RE.search(value):
        return False

    # Remove gaze mechanics and timing modifiers first. What remains is the
    # target phrase. Pure eye-direction instructions can therefore end here.
    residual = _GAZE_SIGNAL_RE.sub("", value)
    for token in (
        "先", "随后", "然后", "短暂", "始终", "重新", "缓慢", "自然", "轻轻", "略微", "微微", "持续", "片刻",
        "地", "着", "了", "再", "逐渐",
    ):
        residual = residual.replace(token, "")

    # Generic current-shot targets and pure spatial directions are safe because
    # they do not create a new story entity.
    for token in (
        "对方", "当前对象", "当前人物", "说话对象", "眼前的人", "对面的人", "对面", "眼前", "镜头外", "前方", "下方",
        "上方", "左侧", "右侧", "画面左侧", "画面右侧", "身侧", "脚下",
    ):
        residual = residual.replace(token, "")

    # Current canonical names, aliases and current props are allowed. Their
    # local body/possessive suffixes are camera/performance modulation, not new
    # entities (e.g. “当前角色脸上”“当前对象手上”).
    for term in sorted({str(x).strip() for x in allowed_entity_terms if str(x).strip()}, key=len, reverse=True):
        residual = residual.replace(term, "")
    local_suffixes = (
        "手中的", "所在方向", "所在位置", "所在处", "画面方向", "脸上", "面部", "眼睛", "眼部", "手上", "手中", "手部",
        "肩部", "身体", "身上", "方向", "位置", "一侧", "附近", "的", "脸", "手", "肩", "前", "后", "上",
    )
    for token in sorted(local_suffixes, key=len, reverse=True):
        residual = residual.replace(token, "")
    residual = re.sub(r"[，,。；;：:（）()\-—]", "", residual)
    return residual == ""


def dialogue_delivery_field_violations(
    field: str,
    value: Any,
    *,
    frozen_line: str = "",
    allowed_entity_terms: list[str] | None = None,
) -> list[str]:
    text = str(value or "").strip()
    if not text:
        return []
    allowed_entity_terms = allowed_entity_terms or []
    if _DELIVERY_EVENT_RE.search(text):
        return ["delivery_contains_story_event"]

    if field == "emotion":
        return [] if _EMOTION_RE.fullmatch(text) else ["outside_delivery_grammar"]
    if field == "volume":
        return [] if _VOLUME_RE.fullmatch(text) else ["outside_delivery_grammar"]
    if field == "pace":
        return [] if _PACE_RE.fullmatch(text) else ["outside_delivery_grammar"]
    if field == "pause":
        return [] if _PAUSE_RE.fullmatch(text) else ["outside_delivery_grammar"]
    if field == "delivery":
        clauses = [x.strip() for x in _DELIVERY_SPLIT_RE.split(text) if x.strip()]
        return [] if clauses and all(_delivery_clause_is_controlled(x) for x in clauses) else ["outside_delivery_grammar"]
    if field == "gaze_during_line":
        if not _GAZE_SIGNAL_RE.search(text):
            return ["outside_delivery_grammar"]
        return [] if _gaze_target_authorized(text, allowed_entity_terms) else ["unauthorized_gaze_target"]
    return []



def dialogue_delivery_hard_violations(
    field: str,
    value: Any,
    *,
    frozen_line: str = "",
    allowed_entity_terms: list[str] | None = None,
) -> list[str]:
    """Return only violations that prove story/authority leakage.

    Natural delivery wording is open-ended. An unrecognized-but-non-leaking
    phrase is a quality signal, not a hard contract failure.
    """
    violations = dialogue_delivery_field_violations(
        field, value, frozen_line=frozen_line, allowed_entity_terms=allowed_entity_terms
    )
    return [v for v in violations if v != "outside_delivery_grammar"]


def dialogue_delivery_unrecognized(
    field: str,
    value: Any,
    *,
    frozen_line: str = "",
    allowed_entity_terms: list[str] | None = None,
) -> bool:
    violations = dialogue_delivery_field_violations(
        field, value, frozen_line=frozen_line, allowed_entity_terms=allowed_entity_terms
    )
    return bool(violations) and not dialogue_delivery_hard_violations(
        field, value, frozen_line=frozen_line, allowed_entity_terms=allowed_entity_terms
    )

def filter_dialogue_delivery_item(
    item: dict[str, Any], *, frozen_line: str = "", allowed_entity_terms: list[str] | None = None
) -> dict[str, Any]:
    out = {
        "frozen_text_unit_id": str(item.get("frozen_text_unit_id") or ""),
        "speaker_ref": str(item.get("speaker_ref") or ""),
    }
    for field in ("emotion", "volume", "pace", "pause", "delivery", "gaze_during_line"):
        value = str(item.get(field) or "").strip()
        if value and not dialogue_delivery_hard_violations(
            field, value, frozen_line=frozen_line, allowed_entity_terms=allowed_entity_terms
        ):
            out[field] = value
    return out
