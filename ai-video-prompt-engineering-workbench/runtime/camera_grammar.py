from __future__ import annotations

import re
from typing import Any

# Camera/framing owns only composition and spatial organization. The grammar is
# deliberately positive: a clause must carry a composition signal, rather than
# merely avoiding a growing blacklist of acting verbs. This prevents false
# positives such as “走廊尽头保留负空间” while still rejecting “人物皱眉”.
_COMPOSITION_SIGNAL_RE = re.compile(
    r"(?:"
    r"画面(?:左|右|中央|中心|上方|下方|前侧|后侧)|"
    r"偏左|偏右|居中|中心构图|对称构图|三分(?:法|构图)?|"
    r"前景|中景|后景|背景|过肩|肩部前景|"
    r"负空间|留白|景深|浅景深|深景深|纵深|层次|"
    r"主体(?:位置|占比|偏左|偏右|居中)|人物占比|环境占比|"
    r"占据画面|占据主体|作为画面主体|主导画面|位于画面|置于画面|(?:保留|留出|预留).+(?:空间|位置)|"
    r"作为前景|作为背景|形成纵深|形成层次|连接.+形成纵深|"
    r"遮挡|虚化|清晰区|焦平面|框架构图|框景|边框|自然边框|引导线|空间关系|空间感|空间层次|"
    r"(?:视线|视觉|注意力)(?:自然)?(?:引向|引导至|集中在|集中到|落在|聚焦于|聚焦在).+|"
    r"(?:视觉焦点|画面焦点|视觉重心|画面重心)(?:落在|集中在|位于|聚焦于|聚焦在)?.+|"
    r"单人(?:构图|近景|中景|特写)?|双人(?:构图|关系|构图关系|中景|近景)?|构图关系|"
    r"环境(?:构图|关系|主体)|整体环境(?:以.+为主体|主体)|作为整体环境主体|局部(?:构图|细节)|"
    r"胸部以上|腰部以上|肩部以上|面部占画面|上半身占画面|"
    r"近距离构图|贴近人物|贴脸|右前侧|左前侧|侧前(?:方)?|位于画面另一侧"
    r")"
)

# High-confidence ownership violations only. Avoid single-character verbs such
# as “走/接” that can occur inside legitimate nouns like 走廊 or verbs such as
# 连接 in a spatial-composition clause.
_FORBIDDEN_OWNERSHIP_RE = re.compile(
    r"(?:"
    r"[“‘\"]{1}[^”’\"]{1,80}[”’\"]|"
    r"(?:开口|问道|询问|回答|说道|喊道|低声说|高声说)|"
    r"(?:愤怒|暴怒|伤心|悲伤|失望|绝望|心死|嫉妒|控制欲|害怕|恐惧|心理|内心|压迫感|破碎感)|"
    r"(?:夕阳|夕照|余晖|晨光|暮光|月光|自然光|灯光|光线|阴影|照在|照亮)|"
    r"(?:抬头|低头|伸手|挥手|转身|走向|跑向|掐住|抓住|递给|拿起|放下|停下|"
    r"皱眉|抿嘴|咬牙|呼吸加重|呼吸急促|肩膀前送|肩膀绷紧|身体前倾|手指收紧|目光(?:锁住|落向|移向|看向))"
    r")"
)

_SPLIT_RE = re.compile(r"[，,；;。]+")


def canonicalize_framing_note(value: Any) -> str:
    """Normalize common real-world framing prose into camera-only grammar.

    This is a deterministic ownership cleanup, not a creative rewrite. It removes
    action-bearing or psychological wording while preserving the same composition
    intent. Concrete entities remain unchanged so authority validation still applies.
    """
    text = str(value or "").strip()
    if not text:
        return ""
    text = re.sub(r"两人同框", "双人构图", text)
    text = re.sub(r"([^，,；;。]{1,24}?)从另一侧经过", r"\1位于画面另一侧", text)
    text = re.sub(r"([^，,；;。]{1,24}?)位于另一侧", r"\1位于画面另一侧", text)
    text = re.sub(r"形成(?:明显)?疏离(?:感)?的构图关系", "形成双人构图关系", text)
    text = re.sub(r"形成疏离构图关系", "形成双人构图关系", text)
    text = re.sub(r"([^，,；;。]{1,24}?)作为整体环境主体", r"整体环境以\1为主体", text)
    # Normalize visual-weight / occupancy phrasing into stable camera grammar.
    text = re.sub(
        r"([^，,；;。]{1,24}?)(?:铺满|填满|占满)(?:整个)?画面(?:主体)?",
        r"\1占据画面主体",
        text,
    )
    text = re.sub(
        r"([^，,；;。]{1,24}?)(?:占据主导|作为主导|成为主导|主导画面)",
        r"\1作为画面主体",
        text,
    )
    return text.strip()


def framing_note_violations(value: Any) -> list[str]:
    """Return only high-confidence camera ownership violations.

    ``framing_note`` is natural-language camera prose, so lexical coverage can
    never be complete. Hard validation therefore protects only deterministic
    ownership boundaries: dialogue/performance/psychology/lighting leakage.
    Merely unfamiliar camera wording is handled separately as a soft quality
    signal and must not pause a run.
    """
    text = str(value or "").strip()
    if not text:
        return []
    violations: list[str] = []
    if _FORBIDDEN_OWNERSHIP_RE.search(text):
        violations.append("non_camera_semantics")
    return violations


def framing_note_unrecognized_clauses(value: Any) -> list[str]:
    """Return camera clauses not recognized by the current positive grammar.

    These are diagnostic only. Natural camera language is an open set, so a
    clause that lacks one of today's composition signals is not evidence that it
    belongs to another semantic owner. Hard ownership/authority checks remain
    separate and continue to block actual leakage or invented entities/facts.
    """
    text = str(value or "").strip()
    if not text:
        return []
    clauses = [x.strip() for x in _SPLIT_RE.split(text) if x.strip()]
    return [f"unrecognized_camera_clause:{clause}" for clause in clauses if not _COMPOSITION_SIGNAL_RE.search(clause)]


def framing_note_is_camera_grammar(value: Any) -> bool:
    return not framing_note_violations(value)


def framing_note_authority_violations(
    value: Any,
    *,
    authority_texts: list[str] | None = None,
    allowed_entity_terms: list[str] | None = None,
) -> list[str]:
    """Validate free framing slots against current Shot/Scene authority.

    Camera grammar says *how* to compose. Any concrete person/prop/place/state
    named inside that grammar must already exist in authority. Generic camera
    nouns (人物/主体/对方) and body-part foreground references stay legal.
    """
    text = str(value or "").strip()
    if not text:
        return []
    authority_texts = authority_texts or []
    allowed_entity_terms = [str(x).strip() for x in (allowed_entity_terms or []) if str(x).strip()]
    authority_blob = re.sub(r"\s+", "", " ".join(authority_texts)).casefold()
    entity_blob = " ".join(x.casefold() for x in allowed_entity_terms)
    problems: list[str] = []

    # High-confidence story facts/events are only legal when already present in authority.
    for term in ("尸体", "血迹", "持刀", "开枪", "燃烧", "着火", "流血", "枪伤", "刀伤", "爆炸", "跪下", "正在哭", "闯入"):
        if term in text and term.casefold() not in authority_blob:
            problems.append("unauthorized_framing_fact:" + term)

    candidates: list[str] = []
    clause_patterns = (
        r"([^，,；;。]{1,24}?)(?:作为前景|作为背景|作为画面主体|位于画面(?:左下角|右下角|左上角|右上角|左|右|中央|中心|上方|下方)|占据画面|占据主体)",
        r"(?:背景中|背景里|前景中|前景里)(?:是|有)?([^，,；;。]{1,24})",
        r"画面(?:左下角|右下角|左上角|右上角|左|右|中央|中心|上方|下方)(?:是|有)([^，,；;。]{1,24})",
        r"([^，,；;。]{1,18}?)尽头保留负空间",
        r"([^，,；;。]{1,24}?)位于画面另一侧",
        r"(?:视线|视觉|注意力)(?:自然)?(?:引向|引导至|集中在|集中到|落在|聚焦于|聚焦在)([^，,；;。]{1,24})",
        r"(?:视觉焦点|画面焦点|视觉重心|画面重心)(?:落在|集中在|位于|聚焦于|聚焦在)?([^，,；;。]{1,24})",
        r"整体环境以([^，,；;。]{1,24}?)为主体",
    )
    for pattern in clause_patterns:
        candidates.extend(m.group(1).strip() for m in re.finditer(pattern, text) if m.group(1).strip())
    for m in re.finditer(r"背景连接([^，,；;。]{1,16})与([^，,；;。]{1,16})形成纵深", text):
        candidates.extend([m.group(1).strip(), m.group(2).strip()])

    generic = {"人物", "主体", "对方", "当前人物", "环境", "右侧", "左侧", "中央", "中心"}
    body_suffix = re.compile(r"(?:的)?(?:左|右)?(?:肩|肩部|头部|上半身|身体|手臂|手部)$")
    body_composition = re.compile(
        r"^(?:人物)?(?:上半身|下半身|身体|面部|头部|肩部|手部|手臂)(?:与(?:上半身|下半身|身体|面部|头部|肩部|手部|手臂)(?:动作)?)?(?:动作)?$"
    )

    # Generic background population is a camera category, not a new named character.
    # It is allowed only when current Shot/Scene authority already establishes people
    # of that category or a compatible ambient crowd. This keeps “行人/路人/人群”
    # usable in environment composition without allowing a framing note to invent
    # a new concrete person such as “持刀男人”.
    generic_population_groups = {
        "行人": ("行人", "路人", "人群", "人来人往", "住户", "居民", "人们"),
        "路人": ("行人", "路人", "人群", "人来人往", "住户", "居民", "人们"),
        "人群": ("行人", "路人", "人群", "人来人往", "住户", "居民", "人们"),
        "住户": ("住户", "居民", "人群", "人来人往"),
        "居民": ("住户", "居民", "人群", "人来人往"),
        "顾客": ("顾客", "客人", "人群"),
        "学生": ("学生", "同学", "人群"),
        "工作人员": ("工作人员", "店员", "员工", "人群"),
    }

    def generic_scene_inventory_authorized(candidate: str) -> bool:
        """Allow collective scene-inventory labels only when their spatial scope exists.

        Examples: ``摊上物件`` may stand for already-authorized objects on a repair
        stall, while an unrelated ``桌上物件`` must not appear unless a table is in
        current authority. This keeps camera prose natural without turning generic
        collective nouns into a backdoor for new props.
        """
        core = candidate.strip()
        m = re.fullmatch(
            r"(.{1,12}?)(?:上|内|里|中|中的)?(?:物件|物品|陈设|摆设|摆件|工具|器具|设备)",
            core,
        )
        if not m:
            return False
        scope = m.group(1).strip()
        if not scope:
            return False
        scope_variants = {scope}
        # Common spatial suffixes are grammatical rather than entity identity.
        scope_variants.add(re.sub(r"(?:旁|边|前|后|侧)$", "", scope).strip())
        scope_variants.discard("")
        return any(x.casefold() in authority_blob for x in scope_variants)

    def generic_population_authorized(candidate: str) -> bool:
        core = re.sub(r"^(?:远处|近处|背景中的?|前景中的?|几名|几个|一名|一些)", "", candidate).strip()
        core = re.sub(r"(?:们|群体)$", "", core).strip()
        cues = generic_population_groups.get(core)
        if not cues:
            return False
        # Exact category authority is sufficient. Cross-category generalization
        # (e.g. current “住户走过” rendered as generic “行人”) additionally
        # requires an explicit ambient movement/crowd cue so a static named
        # resident cannot silently become a crowd.
        if core.casefold() in authority_blob:
            return True
        matched = any(x.casefold() in authority_blob for x in cues)
        if not matched:
            return False
        if core in {"行人", "路人", "人群"}:
            return any(x in authority_blob for x in ("人来人往", "走过", "路过", "经过", "来往", "进出", "走动"))
        return True

    for raw in candidates:
        candidate = re.sub(r"^(?:桌上|门外|画面内|镜头内)", "", raw).strip()
        if not candidate or candidate in generic:
            continue
        if body_composition.fullmatch(candidate):
            continue
        if generic_population_authorized(candidate):
            continue
        if generic_scene_inventory_authorized(candidate):
            continue
        candidate_core = re.sub(r"(?:本身|内部|方向|位置|区域|一侧|附近)$", "", candidate).strip()
        if candidate.casefold() in authority_blob or (candidate_core and candidate_core.casefold() in authority_blob):
            continue
        matched_entity = False
        for term in allowed_entity_terms:
            if not term or term not in candidate:
                continue
            residual = candidate.replace(term, "").strip()
            if not residual or body_suffix.fullmatch(residual):
                matched_entity = True
                break
        if matched_entity:
            continue
        # Entity terms alone are allowed; arbitrary descriptive/event residue is not.
        if candidate.casefold() in entity_blob:
            continue
        problems.append("unauthorized_framing_entity:" + candidate)
    return list(dict.fromkeys(problems))
