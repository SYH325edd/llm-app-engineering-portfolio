from __future__ import annotations

import re
from typing import Any

# Director may interpret performance, but it may not mint story facts. The
# policy is field-specific: emotion fields are conservative interpretation;
# trigger/goal must be directly present in current authority; tendency may be a
# performance-only acting tendency but may not introduce a plot action.
_PROTECTED_CLAIM_GROUPS: tuple[tuple[str, ...], ...] = (
    ("童年", "小时候", "从小", "childhood"),
    ("曾经", "过去", "多年前", "早年", "当年", "九几年", "十年前", "二十年前", "in the past", "years ago"),
    ("背叛", "出轨", "betray", "cheat"),
    ("前任", "前夫", "前妻", "ex-husband", "ex-wife", "ex partner"),
    ("结婚", "婚姻", "婚戒", "夫妻", "丈夫", "妻子", "老公", "老婆", "marriage", "wedding ring", "husband", "wife"),
    ("离婚", "分手", "divorce", "breakup"),
    ("坐牢", "入狱", "监狱", "prison", "jail"),
    ("身世", "亲生", "收养", "adopted", "biological parent"),
    ("秘密", "隐瞒多年", "secret"),
    ("复仇", "报复", "惩罚", "revenge", "retaliate", "punish"),
)

_LOGIC_FIELDS = ("base_emotion", "emotion_delta", "trigger", "behavior_goal", "behavior_tendency")

_EMOTION_GROUPS: tuple[tuple[str, ...], ...] = (
    ("愤怒", "暴怒", "怒火", "怒意", "恼怒", "生气", "发怒", "angry", "rage", "furious"),
    ("伤心", "悲伤", "难过", "心碎", "sad", "sorrow"),
    ("失望", "心死", "绝望", "disappointed", "hopeless"),
    ("害怕", "恐惧", "惊慌", "紧张", "fear", "afraid", "panic", "tense"),
    ("克制", "冷静", "平静", "压住", "忍住", "restrained", "calm"),
    ("轻蔑", "讥讽", "冷嘲", "contempt", "mock"),
    ("不耐烦", "烦躁", "impatient", "irritated"),
    ("控制欲", "掌控", "控制", "control"),
    ("嫉妒", "吃醋", "jealous"),
    ("震惊", "惊讶", "错愕", "surprised", "shocked"),
    ("好奇", "curious"),
    ("愧疚", "自责", "guilty", "guilt"),
)

# Safe tendency language describes acting modulation, not a new story event.
_PERFORMANCE_TENDENCY_SIGNAL_RE = re.compile(
    r"(?:视线|目光|前压|重心|肩|呼吸|动作|停顿|身体|手部|手势|姿态|距离|"
    r"僵住|收紧|放松|减慢|加快|放缓|压低|抬高|减少|保持|回避|避开|节奏|语速|"
    r"下颌|眉|嘴角|眼神|克制|沉默|前倾)"
)
_PLOT_ACTION_RE = re.compile(
    r"(?:杀死|杀掉|杀害|抢走|夺走|逃跑|逃离|离开现场|攻击|殴打|扇耳光|掐住|勒住|"
    r"推倒|联系(?:某人|警方|医生|家人)|报警|追赶|带走|绑架|威胁|逼迫|要求.+道歉|"
    r"亲吻|拥抱|开枪|刺伤|砍伤|偷走|拿走|破坏|摔碎|扔掉|救走|保护.+离开|寻找|闯入|冲进)"
)


def _norm(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip()).casefold()


def _compact(value: Any) -> str:
    return re.sub(r"[\s，,。；;：:！!？?、\"'“”‘’（）()\[\]]+", "", _norm(value))


def _authority_blob(authorities: list[str]) -> str:
    return " ".join(_norm(x) for x in authorities if _norm(x))


def logic_evidence_grounded(item: dict[str, Any], authorities: list[str]) -> bool:
    evidence = item.get("evidence_source") if isinstance(item.get("evidence_source"), list) else []
    authority_values = [_norm(x) for x in authorities if _norm(x)]
    if not evidence or not authority_values:
        return False
    for entry in evidence:
        if not isinstance(entry, dict):
            continue
        quote = _norm(entry.get("quote"))
        if quote and any(quote in authority for authority in authority_values):
            return True
    return False


def _contains_protected_claim(value: str, authorities: list[str]) -> list[str]:
    claims = _norm(value)
    if not claims:
        return []
    authority_blob = _authority_blob(authorities)
    unsupported: list[str] = []
    for group in _PROTECTED_CLAIM_GROUPS:
        claim_hits = [term for term in group if _norm(term) and _norm(term) in claims]
        if not claim_hits:
            continue
        if not any(_norm(term) and _norm(term) in authority_blob for term in group):
            unsupported.extend(claim_hits)
    return list(dict.fromkeys(unsupported))


def _directly_in_authority(value: str, authorities: list[str]) -> bool:
    needle = _compact(value)
    if not needle:
        return False
    return any(needle in _compact(authority) for authority in authorities if _compact(authority))


def _emotion_supported(value: str, authorities: list[str]) -> bool:
    text = _norm(value)
    if not text or _contains_protected_claim(text, authorities):
        return False
    authority_blob = _authority_blob(authorities)
    matched_group = False
    for group in _EMOTION_GROUPS:
        if any(_norm(term) in text for term in group):
            matched_group = True
            if not any(_norm(term) in authority_blob for term in group):
                return False
    if matched_group:
        return True
    # Unknown affect labels are not freely inferable; require direct authority.
    return _directly_in_authority(value, authorities)


def _tendency_supported(value: str, authorities: list[str]) -> bool:
    text = str(value or "").strip()
    if not text or _contains_protected_claim(text, authorities):
        return False
    if _PLOT_ACTION_RE.search(text):
        return False
    # Explicit source wording is always acceptable; otherwise only pure acting
    # modulation language may be interpreted by Director.
    return _directly_in_authority(text, authorities) or bool(_PERFORMANCE_TENDENCY_SIGNAL_RE.search(text))


def renderable_logic_fields(item: dict[str, Any], authorities: list[str]) -> dict[str, str]:
    """Return only fields that are allowed to cross into baseline/final Prompt."""
    if not logic_evidence_grounded(item, authorities):
        return {}
    out: dict[str, str] = {}
    base = str(item.get("base_emotion") or "").strip()
    if base and _emotion_supported(base, authorities):
        out["base_emotion"] = base
    delta = str(item.get("emotion_delta") or "").strip()
    if delta and _emotion_supported(delta, authorities):
        out["emotion_delta"] = delta
    trigger = str(item.get("trigger") or "").strip()
    if trigger and not _contains_protected_claim(trigger, authorities) and _directly_in_authority(trigger, authorities):
        out["trigger"] = trigger
    goal = str(item.get("behavior_goal") or "").strip()
    if goal and not _contains_protected_claim(goal, authorities) and _directly_in_authority(goal, authorities):
        out["behavior_goal"] = goal
    tendency = str(item.get("behavior_tendency") or "").strip()
    if tendency and _tendency_supported(tendency, authorities):
        out["behavior_tendency"] = tendency
    return out


def unsupported_logic_fields(item: dict[str, Any], authorities: list[str]) -> list[str]:
    if not logic_evidence_grounded(item, authorities):
        return [field for field in _LOGIC_FIELDS if str(item.get(field) or "").strip()]
    allowed = renderable_logic_fields(item, authorities)
    return [field for field in _LOGIC_FIELDS if str(item.get(field) or "").strip() and field not in allowed]


def unsupported_story_claim_terms(item: dict[str, Any], authorities: list[str]) -> list[str]:
    claims = " ".join(str(item.get(field) or "") for field in _LOGIC_FIELDS)
    return _contains_protected_claim(claims, authorities)


def logic_item_renderable(item: dict[str, Any], authorities: list[str]) -> bool:
    return bool(renderable_logic_fields(item, authorities))
