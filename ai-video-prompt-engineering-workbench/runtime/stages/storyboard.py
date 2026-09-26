from __future__ import annotations

import copy
import re
from difflib import SequenceMatcher
from typing import Any

from runtime.value_normalization import coerce_unambiguous_bool, coerce_unambiguous_enum, coerce_unambiguous_number
from runtime.text_authority import normalize_authority_text, reanchor_quote_to_authorities, text_is_anchored
from runtime.source_index import build_source_index, refs_to_span
from runtime.authority_contract import authority_manifest

from prompt_foundry_v1_3.asset_compilers import CAMERA_MAP, MOVEMENT_MAP, SHOT_SIZE_MAP

CONTRACT_VERSION = "storyboard_scene.v16"

SOFT_QUALITY_ERROR_TYPES = frozenset({
    "storyboard_non_atomic_time_window",
    "storyboard_non_visual_description",
    # Lexical overlap cannot prove semantic faithfulness of a shot-level visual
    # transformation. Exact source-evidence membership remains a hard gate.
    "storyboard_description_not_supported_by_evidence",
    "storyboard_description_evidence_binding_gap",
})


def _contains_latin_text(value: Any) -> bool:
    return isinstance(value, str) and bool(re.search(r"[A-Za-z]", value))

SYSTEM_PROMPT = """你是 Prompt Foundry Runtime 2.x 的 Stage 4：Storyboard Base Planner。当前只处理一个 FROZEN-03 Script Scene。
你的任务是把 Script Beat 拆成基础镜头，不生成 Director、不生成最终 Prompt、不生成生产设计。

权责边界：
1. 模型负责：每个 Shot 属于哪个 beat_id、character_refs/prop_refs、shot_size/camera/movement/composition/duration/description、dialogue_unit_refs/narration_unit_refs 分配、continuity 与 source_evidence。模型不再抄写对白/旁白正文。
2. 程序负责：父 Scene 的 scene_id/context_ref/location_ref、每个 Shot 的 shot_id 与 shot.scene_id，以及每个 Scene 首镜 continuity.continuous_with_previous。不要输出 scene_id/context_ref/location_ref/shot_id；即使输出也会被程序覆盖。
3. shot_id 在 Scene Unit 内由程序临时按顺序生成，合并全部 Scene 后由程序统一重编号为全项目 SH001...。
4. 当前 Scene 首镜的 continuity.continuous_with_previous 由程序强制等于 Scene Plan.continuous_with_previous；Scene 内后续镜头仍由你判断。

Beat / 对白规则：
- 每个 Scene Plan Beat 至少一个 Shot；Shot 不能跨 Beat 合并。
- beat_id 必须来自 required_beat_ids。
- Shot 必须保持 required_beat_ids 的原始顺序展开；同一 Beat 可拆多个连续 Shot，但不得回跳或重排 Beat。
- 程序会在 frozen_text_units 中把 Script 文本冻结成不可拆分单元。模型只能把 unit_id 分配到 Shot，不得重写正文。
- dialogue_unit_refs：只能引用当前 Beat 的 dialogue 语义单元；程序先按完整强句界（。！？；，且引号必须闭合）切分，同一个 unit 不得拆开、重复、遗漏或换 speaker。
- utterance_group_id 只保留同一次原始发言的 speaker / 原话 / 顺序权威，不再要求整个 utterance_group 必须待在同一个 Shot。允许同一发言的多个完整语义 unit 分配到连续 Shot；不得在 unit 内部切镜。
- narration_unit_refs：只能引用当前 Beat 的 narration 冻结单元；旁白只在完整语义边界切分（。！？；，且引号必须闭合），逗号不是切分边界。不能在一个 frozen narration unit 内部切镜。
- 所有 unit_id 必须在当前 Beat 内按 frozen_text_units 给出的顺序恰好分配一次。允许一个 Shot 分配多个完整 unit，也允许一个 Beat 拆成多个 Shot，但不得拆 unit。
- dialogue 的 speaker 仍由 Script 冻结；Shot.character_refs 只表示当前画面中实际可见/出镜的角色。若某个完整 dialogue unit 被分配到 speaker 不可见的 Shot，后续 Production Semantics 会把它确定性解释为画外声音。

引用规则：
- character_refs 只能来自 allowed_character_refs；prop_refs 只能来自 allowed_prop_refs。
- prop_manifest 给出每个允许道具 ID 对应的 canonical_name、aliases 与 explicit_facts；不得按 ID 顺序猜测道具。
- prop_refs 只包含当前 Shot 画面中实际可见、被拿取、移动、操作、使用或作为明确视觉主体的道具；不得因为整个 Scene 出现过或对白提到就自动加入。
- 不得把其他 Scene 的角色或道具带入当前 Shot。

摄影字段：
- shot_size 只能使用 output_contract.allowed_shot_sizes。
- camera 只能使用 output_contract.allowed_cameras。
- movement 只能使用 output_contract.allowed_movements。
- duration 必须是大于 0 的数字。
- description 必须是非空字符串；composition 必须是字符串。
- composition 只描述画面布局、主体位置和构图关系，不承担连续动作叙述；动作过程写入 description。
- composition 与 description 以简体中文描述为主；原文、角色名、品牌名、型号、地点名等已授权专有名词可保留原写法。不得为了语言统一改写剧情事实，也不得新增无来源的可阅读文字。
- description 可以从当前 Script Beat 与 beat_source_authority 中选择、拆分并收缩为单镜头可见事实，但不得把原有动作改写成新的动作细节；优先沿用上游原词。beat_source_authority 是程序从原文 source_refs 切出的最高事实窗口，Script description 是剧本化摘要。source_evidence 必须直接覆盖 description 实际使用的事实，不能只绑定同 Beat 内无关句子。
- 每个 Shot 必须对应一个连续、可直接拍摄的时间窗口。不得把“几分钟/几小时/数天/数月/数年”等长时间压缩，或两个以上明显时间阶段，塞进一个 Shot；需要时在同一 Beat 内拆成多个连续 Shot。
- description 只能写当前画面能直接观察到的视觉事实：人物动作、表情、视线、位置、道具互动、可见环境变化。不得写心理活动、作者评论、象征意义、纯声音/气味等不可直接视觉化信息。

continuity：
- 固定包含 continuous_with_previous:boolean、axis_side:string、eyeline_match:string。
- 不得输出其他 continuity 字段。

source_evidence：
- 每个 Shot 至少一项 {"quote":"..."}。
- quote 必须逐字来自当前 Beat 的 beat_source_authority.source_text，或当前 Script Scene/Beat description、当前 Beat dialogue/narration；优先使用原文 authority。不能引用别的 Beat，也不能自造证据。

质量告警与 Repair（修复）规则：
- 首次生成时仍应尽量让每个 Shot 处于一个连续、可直接拍摄的时间窗口，并把 description 写成可直接观察的视觉事实。
- storyboard_non_atomic_time_window、storyboard_non_visual_description、storyboard_description_not_supported_by_evidence、storyboard_description_evidence_binding_gap 属于程序侧质量告警，不作为字符串启发式硬事实 Gate；不得因为质量告警触发 Repair，也不得仅为了消除这些告警改写镜头。source_evidence 的 quote 是否真实属于当前 Beat/Script authority 仍是硬 Gate。
- Repair 只处理 repair_instruction.validation_errors 实际提供的硬错误；不得自行顺带修改未被硬错误指向的镜头。
- 若 validation_errors 含 storyboard_frozen_text_unit_allocation_mismatch、unknown_storyboard_frozen_text_unit_ref、storyboard_frozen_text_unit_channel_mismatch 或 storyboard_frozen_text_unit_beat_mismatch：只修 dialogue_unit_refs / narration_unit_refs 的分配；严格按照 frozen_text_units 的当前 Beat、channel、utterance_group_id 与顺序分配完整 unit_id。不得改写 Script 正文、description、character_refs、prop_refs 或 source_evidence 来规避错误。
- 若 repair_instruction.validation_errors 含 storyboard_missing_visible_prop_ref 或 storyboard_unsupported_prop_ref：使用错误中的 shot_index（从 0 开始）精确定位 invalid_output.scene.shots[shot_index].prop_refs；missing 只补入该错误的 prop_ref，unsupported 只删除该错误的 prop_ref。shot_id 是程序后注入字段，Repair 不得依赖 shot_id 定位。不得改 description、dialogue、source_evidence、beat_id 或其他镜头事件来规避错误。
- 若 validation_errors 含 storyboard_description_evidence_binding_gap：description 已被当前 Script Beat/Scene 支持，只修该 Shot.source_evidence，改绑为当前 Beat/Scene 中直接支持 description 的最小精确 quote；不得改 description 或其他镜头字段。
- 若 validation_errors 含 storyboard_description_not_supported_by_evidence：当前 description 本身未被当前 Script Beat/Scene 支持，只收缩该 Shot.description 到当前 Script 可直接支持的可见事实，并同步绑定最小精确 source_evidence；不得新增动作、人物、道具或事件。
- 若 validation_errors 含 storyboard_evidence_not_in_script：只修错误 path 指向的 source_evidence quote。优先从错误的 allowed_evidence_quotes 选择能支持当前 Shot 的最小精确 quote；若错误同时提供 beat_source_authority，只能从该当前 Beat 权威文本逐字截取。不得改 description、dialogue/narration 分配、character_refs、prop_refs 或其他镜头字段，也不得原样返回非法 quote。

禁止字段：
- director/state_in/image_prompt/video_prompt/platform_prompt 以及任何未在 output_contract 声明的字段。
- 只输出一个 JSON object：{"scene":{"shots":[...]}}；不要 markdown、解释或前后缀文本。
"""


def output_template() -> dict[str, Any]:
    return {
        "scene": {
            "shots": [{
                "beat_id": "B001",
                "character_refs": [],
                "prop_refs": [],
                "shot_size": "medium",
                "camera": "eye_level",
                "movement": "static",
                "composition": "",
                "duration": 5.0,
                "description": "",
                "dialogue_unit_refs": ["FTU_B001_D001"],
                "narration_unit_refs": ["FTU_B001_N001"],
                "continuity": {
                    "continuous_with_previous": False,
                    "axis_side": "neutral",
                    "eyeline_match": "not_applicable",
                },
                "source_evidence": [{"quote": ""}],
            }]
        }
    }


def output_contract() -> dict[str, Any]:
    return {
        "model_scene_fields": ["shots"],
        "model_shot_fields": [
            "beat_id", "character_refs", "prop_refs", "shot_size", "camera", "movement",
            "composition", "duration", "description", "dialogue_unit_refs", "narration_unit_refs", "continuity", "source_evidence",
        ],
        "dialogue_fields": ["character_id", "line"],
        "frozen_text_ref_fields": ["dialogue_unit_refs", "narration_unit_refs"],
        "continuity_fields": ["continuous_with_previous", "axis_side", "eyeline_match"],
        "source_evidence_fields": ["quote"],
        "canonical_scene_fields": ["scene_id", "context_ref", "location_ref", "shots"],
        "canonical_shot_fields": [
            "shot_id", "scene_id", "beat_id", "character_refs", "prop_refs", "shot_size", "camera",
            "movement", "composition", "duration", "description", "dialogue", "narration", "frozen_text_unit_refs", "continuity", "source_evidence",
        ],
        "program_owned_fields": ["scene_id", "context_ref", "location_ref", "shot_id", "shot.scene_id", "shot.frozen_text_unit_refs", "first_shot.continuity.continuous_with_previous"],
        "allowed_shot_sizes": sorted(SHOT_SIZE_MAP),
        "allowed_cameras": sorted(CAMERA_MAP),
        "allowed_movements": sorted(MOVEMENT_MAP),
        "dialogue_rule": "Runtime groups source dialogue continuations by speaker, splits each utterance only at complete strong sentence boundaries outside open quotes, and emits immutable semantic unit IDs; each unit is indivisible, ordered, and used exactly once; utterance_group_id preserves one source utterance identity but may span consecutive Shots",
        "narration_rule": "model allocates immutable narration semantic-unit IDs; units split only at complete strong sentence boundaries outside open quotes; each unit is indivisible, ordered, and used exactly once; Runtime materializes exact text",
        "evidence_rule": "quote must be an exact substring of current Beat source authority or current Script Scene/Beat/dialogue/narration corpus",
        "frozen_text_authority": {
            "dialogue": "Script owns exact utterance text and speaker; Runtime deterministically derives complete sentence-level FrozenTextUnits; model owns whole-unit Shot allocation only; Runtime materializes exact text",
            "narration": "Script owns exact semantic text units; model owns whole-unit Shot allocation only; Runtime materializes exact text",
        },
        "authority_manifest": authority_manifest("storyboard_scene"),
        "null_policy": "required arrays/objects must use []/{}; required scalars must not be null",
    }


def _prop_manifest(story_bible: dict[str, Any] | None, allowed_prop_refs: list[str]) -> dict[str, dict[str, Any]]:
    allowed = set(allowed_prop_refs)
    out: dict[str, dict[str, Any]] = {}
    for prop in (story_bible or {}).get("props", []) or []:
        if not isinstance(prop, dict) or prop.get("prop_id") not in allowed:
            continue
        out[str(prop["prop_id"])] = {
            "canonical_name": str(prop.get("canonical_name") or prop.get("name") or ""),
            "aliases": [str(x) for x in (prop.get("aliases") or []) if isinstance(x, str) and x],
            "explicit_facts": [str(x) for x in (prop.get("explicit_facts") or []) if isinstance(x, str) and x],
        }
    return out


_PHYSICAL_PROP_TOKENS = (
    "端着", "拿着", "拿起", "放下", "放在", "放进", "放到", "攥着", "攥在", "捂着",
    "翻出", "递给", "递出", "夹", "倒", "流进", "打开", "擦", "收起", "盖上", "关上",
    "吃", "咬", "盛", "被放", "握着", "抓着",
)
_NEGATION_TOKENS = ("没有", "并未", "未曾", "不曾", "未", "不")
_QUOTED_TEXT_RE = re.compile(r"[‘’“”\"'].*?[‘’“”\"']")


def _shot_prop_text(shot: dict[str, Any]) -> str:
    # Prop visibility is a Shot-level visual question. source_evidence may quote a
    # wider Script span containing props that are not visible in this Shot, so it
    # must not force those props into shot.prop_refs.
    return str(shot.get("description") or "")


def _verb_is_negated(text: str, verb_pos: int) -> bool:
    prefix = text[max(0, verb_pos - 10):verb_pos]
    return any(token in prefix for token in _NEGATION_TOKENS)


def _has_physical_prop_interaction(text: str, term: str) -> bool:
    start = text.find(term)
    while start >= 0:
        left = max(0, start - 12)
        right = min(len(text), start + len(term) + 12)
        window = text[left:right]
        term_pos = start - left
        for token in _PHYSICAL_PROP_TOKENS:
            search = 0
            while True:
                pos = window.find(token, search)
                if pos < 0:
                    break
                if abs(pos - term_pos) <= 10 and not _verb_is_negated(window, pos):
                    return True
                search = pos + max(1, len(token))
        start = text.find(term, start + len(term))
    return False


def _fact_supports_current_shot(text: str, fact: str) -> bool:
    clean_text = re.sub(r"[\s，。！？；：、‘’“”\"']+", "", text)
    clean_fact = re.sub(r"[\s，。！？；：、‘’“”\"']+", "", fact)
    if not clean_text or not clean_fact:
        return False
    if not any(token in clean_text and token in clean_fact for token in _PHYSICAL_PROP_TOKENS):
        return False
    return SequenceMatcher(None, clean_text, clean_fact).ratio() >= 0.45


def _required_prop_refs(text: str, manifest: dict[str, dict[str, Any]]) -> set[str]:
    visible_text = _QUOTED_TEXT_RE.sub("", text)
    refs: set[str] = set()
    for ref, meta in manifest.items():
        terms = [meta.get("canonical_name"), *(meta.get("aliases") or [])]
        if any(isinstance(term, str) and term and _has_physical_prop_interaction(visible_text, term) for term in terms):
            refs.add(ref)
            continue
        for fact in meta.get("explicit_facts") or []:
            if isinstance(fact, str) and _fact_supports_current_shot(visible_text, fact):
                refs.add(ref)
                break
    return refs


def _beat_source_authority(scene_plan_scene: dict[str, Any], source_text: str | None) -> dict[str, str]:
    if not source_text:
        return {}
    source_index = build_source_index(source_text)
    out: dict[str, str] = {}
    for beat in scene_plan_scene.get("beat_list", []) or []:
        if not isinstance(beat, dict):
            continue
        bid = str(beat.get("beat_id") or "")
        refs = [str(x) for x in beat.get("source_refs", []) or [] if isinstance(x, str)]
        if not bid or not refs:
            continue
        span = refs_to_span(source_text, source_index, refs)
        text = str((span or {}).get("source_text") or "")
        if text:
            out[bid] = text
    return out


def build_storyboard_scene_payload(
    scene_plan_scene: dict[str, Any],
    script_scene: dict[str, Any],
    *,
    unit_id: str,
    story_bible: dict[str, Any] | None = None,
    source_text: str | None = None,
) -> dict[str, Any]:
    allowed_props = list(scene_plan_scene.get("prop_refs", []) or [])
    return {
        "unit_id": unit_id,
        "contract_version": CONTRACT_VERSION,
        "scene_plan_scene": copy.deepcopy(scene_plan_scene),
        "script_scene": copy.deepcopy(script_scene),
        "frozen_text_units": build_frozen_text_units(script_scene),
        "beat_source_authority": _beat_source_authority(scene_plan_scene, source_text),
        "allowed_character_refs": list(scene_plan_scene.get("character_refs", []) or []),
        "allowed_prop_refs": allowed_props,
        "prop_manifest": _prop_manifest(story_bible, allowed_props),
        "required_beat_ids": [b.get("beat_id") for b in scene_plan_scene.get("beat_list", []) or [] if isinstance(b, dict)],
        "required_scene_continuity": bool(scene_plan_scene.get("continuous_with_previous")),
        "output_template": output_template(),
        "output_contract": output_contract(),
    }


_VISUAL_SUMMARY_PATTERNS = (
    r"^(?:之后|后来|那天之后|从那以后|第二天|第三天|每天|有时|有时候)",
    r"(?:之后|后来|那天之后|从那以后|第二天|第三天|每天|有时|有时候).*(?:来|没来|多给|还有|照常|都)",
)
_LONG_NARRATIVE_DURATION_RE = re.compile(
    r"(?:近|约|大约|足足|整整|将近)?(?:半|一|两|三|四|五|六|七|八|九|十|百|几|数|\d+)(?:个)?(?:分钟|小时|天|周|星期|月|年)(?!前|后)"
)
_TEMPORAL_JUMP_RE = re.compile(
    r"(?:后来|此后|从此|次日|翌日|第[一二三四五六七八九十百\d]+天|(?:几|数|多|\d+)(?:天|周|个月|月|年)后|[^，。；]{1,8}那年)"
)
_NON_VISUAL_COGNITION_RE = re.compile(r"(?:仿佛|似乎|好像).{0,16}(?:想起|回到|记起|意识到|明白)|(?:想起|回忆起|记起|意识到|明白|觉得|想到)")
_NON_VISUAL_AUTHORIAL_RE = re.compile(r"(?:和|与).{0,20}(?:以前|过去|当年|从前).{0,8}(?:一样|相同)|(?:象征|意味着|体现|代表)")
_NON_VISUAL_AUDIO_RE = re.compile(r"(?:传来|响起|听见|听到).{0,24}(?:声音|声|音乐|歌声|叫喊|说话)|(?:声音|歌声|音乐|叫喊声).{0,16}(?:传来|响起)")


def _description_has_non_atomic_time_window(text: str) -> bool:
    visible = _QUOTED_TEXT_RE.sub("", str(text or ""))
    if _LONG_NARRATIVE_DURATION_RE.search(visible):
        return True
    return len(_TEMPORAL_JUMP_RE.findall(visible)) >= 2


def _description_requires_visual_rewrite(text: str) -> bool:
    value = str(text or "").strip()
    if not value:
        return False
    if any(re.search(pattern, value) for pattern in _VISUAL_SUMMARY_PATTERNS):
        return True
    visible = _QUOTED_TEXT_RE.sub("", value)
    return any(pattern.search(visible) for pattern in (_NON_VISUAL_COGNITION_RE, _NON_VISUAL_AUTHORIAL_RE, _NON_VISUAL_AUDIO_RE))


def _set(target: dict[str, Any], key: str, value: Any) -> int:
    if key in target and target.get(key) == value:
        return 0
    target[key] = value
    return 1


def _ordered_unique(values: list[Any]) -> tuple[list[Any], int]:
    out: list[Any] = []
    seen: set[tuple[str, str]] = set()
    changes = 0
    for value in values:
        marker = (type(value).__name__, repr(value))
        if marker in seen:
            changes += 1
            continue
        seen.add(marker)
        out.append(value)
    return out, changes


_STRONG_TEXT_BOUNDARIES = frozenset("。！？；!?;")
_QUOTE_OPEN_TO_CLOSE = {"“": "”", "‘": "’", "「": "」", "『": "』"}
_DIALOGUE_CONTINUATION_ENDINGS = ("，", ",", "、", "：", ":")


def _split_narration_semantic_units(text: str) -> list[str]:
    """Split narration only at strong sentence boundaries outside open quotes.

    Commas are never boundaries. Punctuation inside a quoted span is not a
    boundary for the enclosing narration sentence, so a quote cannot be cut in
    half. Exact source characters are preserved.
    """
    if not isinstance(text, str) or not text:
        return []
    units: list[str] = []
    start = 0
    quote_stack: list[str] = []
    ascii_double_open = False
    for index, char in enumerate(text):
        if char in _QUOTE_OPEN_TO_CLOSE:
            quote_stack.append(_QUOTE_OPEN_TO_CLOSE[char])
            continue
        if quote_stack and char == quote_stack[-1]:
            quote_stack.pop()
            continue
        if char == '"' and not quote_stack:
            ascii_double_open = not ascii_double_open
            continue
        if char in _STRONG_TEXT_BOUNDARIES and not quote_stack and not ascii_double_open:
            unit = text[start:index + 1]
            if unit.strip():
                units.append(unit)
            start = index + 1
    tail = text[start:]
    if tail.strip():
        units.append(tail)
    return units


def _safe_frozen_unit_token(value: str) -> str:
    token = re.sub(r"[^A-Za-z0-9_-]+", "_", str(value or ""))
    return token.strip("_") or "BEAT"


def _dialogue_continues_into_next_line(text: str) -> bool:
    """Return True only for explicit continuation punctuation.

    This intentionally does not merge punctuation-less adjacent lines. The grouping
    rule is conservative and language-structural: a comma/list-colon ending says the
    current utterance is unfinished; otherwise a new Script line remains a new
    utterance unless a future contract adds stronger source metadata.
    """
    value = str(text or "").strip()
    if not value:
        return False
    while value and value[-1] in "”’」』\"'":
        value = value[:-1].rstrip()
    return bool(value) and value.endswith(_DIALOGUE_CONTINUATION_ENDINGS)


def _dialogue_utterance_groups(beat: dict[str, Any]) -> list[dict[str, Any]]:
    """Group source dialogue lines into deterministic utterances before sentence splitting.

    Only an explicit continuation ending on the previous line (comma/list-colon)
    with the same speaker joins the next Script dialogue item. This preserves the
    existing continuation semantics while letting long complete utterances expose
    safe sentence-level FrozenText boundaries.
    """
    groups: list[dict[str, Any]] = []
    previous_line = ""
    previous_character_id = ""
    for source_index, item in enumerate(beat.get("dialogue", []) or []):
        if not isinstance(item, dict):
            continue
        cid = item.get("character_id")
        line = item.get("line")
        if not isinstance(cid, str) or not cid or not isinstance(line, str) or not line:
            continue
        continues_previous = (
            bool(groups)
            and cid == previous_character_id
            and _dialogue_continues_into_next_line(previous_line)
        )
        if continues_previous:
            groups[-1]["texts"].append(line)
            groups[-1]["source_dialogue_indexes"].append(source_index)
        else:
            groups.append({
                "character_id": cid,
                "texts": [line],
                "source_dialogue_indexes": [source_index],
            })
        previous_character_id = cid
        previous_line = line
    return groups


def build_frozen_text_units(script_scene: dict[str, Any]) -> dict[str, dict[str, list[dict[str, Any]]]]:
    """Build deterministic immutable Script text units for Storyboard allocation.

    Dialogue authority remains Script-owned at utterance level, while Runtime
    deterministically exposes complete sentence-level units at strong boundaries
    outside open quotes. Narration uses the same conservative boundary rule.
    """
    out: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for beat in script_scene.get("beats", []) or []:
        if not isinstance(beat, dict):
            continue
        bid = str(beat.get("beat_id") or "")
        if not bid:
            continue
        token = _safe_frozen_unit_token(bid)
        dialogue_units: list[dict[str, Any]] = []
        for utterance_index, group in enumerate(_dialogue_utterance_groups(beat), 1):
            cid = str(group["character_id"])
            authority = "".join(str(x) for x in group["texts"])
            utterance_group_id = f"UTT_{token}_{utterance_index:03d}"
            semantic_units = _split_narration_semantic_units(authority)
            if not semantic_units and authority:
                semantic_units = [authority]
            for unit_text in semantic_units:
                dialogue_units.append({
                    "unit_id": f"FTU_{token}_D{len(dialogue_units) + 1:03d}",
                    "beat_id": bid,
                    "channel": "dialogue",
                    "character_id": cid,
                    "text": unit_text,
                    "utterance_group_id": utterance_group_id,
                    "source_dialogue_indexes": list(group["source_dialogue_indexes"]),
                })
        narration_units: list[dict[str, Any]] = []
        for narration in beat.get("narration", []) or []:
            if not isinstance(narration, str) or not narration:
                continue
            for unit_text in _split_narration_semantic_units(narration):
                narration_units.append({
                    "unit_id": f"FTU_{token}_N{len(narration_units) + 1:03d}",
                    "beat_id": bid,
                    "channel": "narration",
                    "text": unit_text,
                })
        out[bid] = {"dialogue": dialogue_units, "narration": narration_units}
    return out


def _frozen_text_unit_index(script_scene: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        str(unit["unit_id"]): unit
        for group in build_frozen_text_units(script_scene).values()
        for channel in ("dialogue", "narration")
        for unit in group[channel]
    }


def _expected_frozen_unit_refs(script_scene: dict[str, Any], beat_id: str, channel: str) -> list[str]:
    group = build_frozen_text_units(script_scene).get(str(beat_id), {})
    return [str(unit.get("unit_id")) for unit in group.get(channel, []) if isinstance(unit, dict) and unit.get("unit_id")]


def _expected_frozen_narration_texts(beat: dict[str, Any]) -> list[str]:
    texts: list[str] = []
    for narration in beat.get("narration", []) or []:
        if isinstance(narration, str) and narration:
            texts.extend(_split_narration_semantic_units(narration))
    return texts



def _split_frozen_authority_by_lexical_lengths(authority: str, lengths: list[int]) -> list[str] | None:
    """Project model-chosen segment boundaries onto one frozen authority string.

    The model owns segmentation only. Punctuation/whitespace are program-owned
    representation because Script already froze the text. We therefore compare the
    punctuation-insensitive lexical stream, then rebuild each segment from the exact
    authority text. Boundary punctuation is attached to the preceding segment.
    """
    if not lengths or any(length <= 0 for length in lengths):
        return None
    authority_key = normalize_authority_text(authority)
    if sum(lengths) != len(authority_key):
        return None

    parts: list[str] = []
    cursor = 0
    for index, target_length in enumerate(lengths):
        start = cursor
        consumed = 0
        while cursor < len(authority) and consumed < target_length:
            unit = normalize_authority_text(authority[cursor])
            consumed += len(unit)
            cursor += 1
        if consumed != target_length:
            return None
        if index < len(lengths) - 1:
            while cursor < len(authority) and not normalize_authority_text(authority[cursor]):
                cursor += 1
        parts.append(authority[start:cursor])

    if cursor != len(authority):
        parts[-1] += authority[cursor:]
    if "".join(parts) != authority:
        return None
    return parts


def _canonicalize_frozen_narration_segments(out: dict[str, Any], script_scene: dict[str, Any]) -> int:
    """Restore exact Script narration while preserving model Shot allocation."""
    beats = _script_beats(script_scene)
    refs_by_beat: dict[str, list[tuple[dict[str, Any], int, str]]] = {}
    for shot in out.get("shots", []) or []:
        if not isinstance(shot, dict):
            continue
        bid = str(shot.get("beat_id") or "")
        narration = shot.get("narration")
        if not isinstance(narration, list):
            continue
        for index, text in enumerate(narration):
            if isinstance(text, str) and text:
                refs_by_beat.setdefault(bid, []).append((shot, index, text))

    changes = 0
    for bid, refs in refs_by_beat.items():
        beat = beats.get(bid)
        if not beat:
            continue
        authority = "".join(_expected_narration(beat))
        actual = "".join(text for _, _, text in refs)
        if not authority or normalize_authority_text(actual) != normalize_authority_text(authority):
            continue
        lengths = [len(normalize_authority_text(text)) for _, _, text in refs]
        exact = _split_frozen_authority_by_lexical_lengths(authority, lengths)
        if exact is None:
            continue
        for (shot, index, old), new in zip(refs, exact):
            if old != new:
                shot["narration"][index] = new
                changes += 1
    return changes


def _canonicalize_frozen_dialogue_segments(out: dict[str, Any], script_scene: dict[str, Any]) -> int:
    """Restore exact Script utterance characters while preserving unit allocation.

    Runtime owns the sentence-level FrozenText boundaries. Storyboard may place
    complete units from one utterance on consecutive Shots, but cannot split a unit.
    """
    beats = _script_beats(script_scene)
    refs_by_beat: dict[str, list[tuple[dict[str, Any], str, str]]] = {}
    for shot in out.get("shots", []) or []:
        if not isinstance(shot, dict):
            continue
        bid = str(shot.get("beat_id") or "")
        dialogue = shot.get("dialogue")
        if not isinstance(dialogue, list):
            continue
        for item in dialogue:
            if not isinstance(item, dict):
                continue
            cid = item.get("character_id")
            line = item.get("line")
            if isinstance(cid, str) and cid and isinstance(line, str) and line:
                refs_by_beat.setdefault(bid, []).append((item, cid, line))

    changes = 0
    for bid, refs in refs_by_beat.items():
        expected = _expected_dialogue(beats.get(bid, {}))
        ri = 0
        staged: list[tuple[dict[str, Any], str]] = []
        valid = True
        for expected_cid, authority in expected:
            source_key = normalize_authority_text(authority)
            source_len = len(source_key)
            if source_len <= 0:
                valid = False
                break
            group: list[tuple[dict[str, Any], str]] = []
            total = 0
            while ri < len(refs) and total < source_len:
                item, cid, text = refs[ri]
                if cid != expected_cid:
                    valid = False
                    break
                length = len(normalize_authority_text(text))
                if length <= 0 or total + length > source_len:
                    valid = False
                    break
                group.append((item, text))
                total += length
                ri += 1
            if not valid or total != source_len:
                valid = False
                break
            actual_key = normalize_authority_text("".join(text for _, text in group))
            if actual_key != source_key:
                valid = False
                break
            exact = _split_frozen_authority_by_lexical_lengths(
                authority,
                [len(normalize_authority_text(text)) for _, text in group],
            )
            if exact is None:
                valid = False
                break
            staged.extend((item, new) for (item, _), new in zip(group, exact))
        if not valid or ri != len(refs):
            continue
        for item, new in staged:
            if item.get("line") != new:
                item["line"] = new
                changes += 1
    return changes


def canonicalize_storyboard_scene(
    scene_plan_scene: dict[str, Any],
    candidate: dict[str, Any],
    script_scene: dict[str, Any] | None = None,
    beat_source_authority: dict[str, str] | None = None,
) -> tuple[dict[str, Any], int]:
    """Inject parent Scene refs and Unit-local Shot IDs; never invent shot semantics."""
    out = copy.deepcopy(candidate)
    changes = 0
    sid = str(scene_plan_scene.get("scene_id") or "")
    changes += _set(out, "scene_id", sid)
    changes += _set(out, "context_ref", str(scene_plan_scene.get("context_ref") or ""))
    changes += _set(out, "location_ref", str(scene_plan_scene.get("location_ref") or ""))
    shots = out.get("shots")
    if not isinstance(shots, list):
        return out, changes
    frozen_index = _frozen_text_unit_index(script_scene) if isinstance(script_scene, dict) else {}
    frozen_by_beat = build_frozen_text_units(script_scene) if isinstance(script_scene, dict) else {}
    legacy_cursors: dict[str, dict[str, int]] = {
        bid: {"dialogue": 0, "narration": 0} for bid in frozen_by_beat
    }
    for index, shot in enumerate(shots, 1):
        if not isinstance(shot, dict):
            continue
        changes += _set(shot, "shot_id", f"SH{index:03d}")
        changes += _set(shot, "scene_id", sid)

        # v14 model output allocates immutable Script text by unit ID. Materialize
        # exact canonical text here so every downstream stage keeps the established
        # dialogue/narration shape and never consumes model-copied text. Legacy raw
        # dialogue/narration remains accepted by the canonicalizer for old fixtures;
        # the v14 provider contract itself emits unit refs only.
        bid = str(shot.get("beat_id") or "")
        allocated_dialogue_refs: list[str] = []
        allocated_narration_refs: list[str] = []
        if "dialogue_unit_refs" in shot:
            refs = shot.pop("dialogue_unit_refs")
            materialized_dialogue: list[dict[str, str]] = []
            if isinstance(refs, list):
                for ref in refs:
                    unit = frozen_index.get(str(ref))
                    if not unit or unit.get("channel") != "dialogue" or str(unit.get("beat_id") or "") != bid:
                        continue
                    allocated_dialogue_refs.append(str(ref))
                    materialized_dialogue.append({
                        "character_id": str(unit.get("character_id") or ""),
                        "line": str(unit.get("text") or ""),
                    })
            if shot.get("dialogue") != materialized_dialogue:
                shot["dialogue"] = materialized_dialogue
                changes += 1
            changes += 1
        elif "dialogue" not in shot:
            shot["dialogue"] = []
            changes += 1
        elif isinstance(script_scene, dict) and isinstance(shot.get("dialogue"), list):
            # Narrow compatibility path for persisted/json_object models that still
            # return canonical raw dialogue instead of v15 unit refs. Only exact,
            # complete Script dialogue units are mapped; Stage 4 validation rejects
            # arbitrary splits/paraphrases, so this inference cannot legalize them.
            group = frozen_by_beat.get(bid, {})
            units = group.get("dialogue", []) or []
            cursor = legacy_cursors.setdefault(bid, {"dialogue": 0, "narration": 0})["dialogue"]
            inferred: list[str] = []
            for item in shot.get("dialogue") or []:
                if not isinstance(item, dict) or cursor >= len(units):
                    inferred = []
                    break
                unit = units[cursor]
                if (
                    str(item.get("character_id") or "") != str(unit.get("character_id") or "")
                    or str(item.get("line") or "") != str(unit.get("text") or "")
                ):
                    inferred = []
                    break
                inferred.append(str(unit.get("unit_id") or ""))
                cursor += 1
            if inferred or not shot.get("dialogue"):
                allocated_dialogue_refs = inferred
                legacy_cursors[bid]["dialogue"] = cursor

        if "narration_unit_refs" in shot:
            refs = shot.pop("narration_unit_refs")
            materialized_narration: list[str] = []
            if isinstance(refs, list):
                for ref in refs:
                    unit = frozen_index.get(str(ref))
                    if not unit or unit.get("channel") != "narration" or str(unit.get("beat_id") or "") != bid:
                        continue
                    allocated_narration_refs.append(str(ref))
                    materialized_narration.append(str(unit.get("text") or ""))
            if shot.get("narration") != materialized_narration:
                shot["narration"] = materialized_narration
                changes += 1
            changes += 1
        elif "narration" not in shot:
            shot["narration"] = []
            changes += 1
        elif isinstance(script_scene, dict) and isinstance(shot.get("narration"), list):
            group = frozen_by_beat.get(bid, {})
            units = group.get("narration", []) or []
            cursor = legacy_cursors.setdefault(bid, {"dialogue": 0, "narration": 0})["narration"]
            inferred: list[str] = []
            for text in shot.get("narration") or []:
                if not isinstance(text, str) or cursor >= len(units):
                    inferred = []
                    break
                unit = units[cursor]
                if text != str(unit.get("text") or ""):
                    inferred = []
                    break
                inferred.append(str(unit.get("unit_id") or ""))
                cursor += 1
            if inferred or not shot.get("narration"):
                allocated_narration_refs = inferred
                legacy_cursors[bid]["narration"] = cursor
        frozen_refs = {
            "dialogue": allocated_dialogue_refs,
            "narration": allocated_narration_refs,
        }
        if shot.get("frozen_text_unit_refs") != frozen_refs:
            shot["frozen_text_unit_refs"] = frozen_refs
            changes += 1
        continuity = shot.get("continuity")
        if isinstance(continuity, dict) and "continuous_with_previous" in continuity:
            normalized_bool, bool_changed = coerce_unambiguous_bool(continuity.get("continuous_with_previous"))
            if normalized_bool is not None and (
                type(continuity.get("continuous_with_previous")) is not bool
                or continuity.get("continuous_with_previous") != normalized_bool
            ):
                continuity["continuous_with_previous"] = normalized_bool
            if bool_changed:
                changes += 1
        if index == 1 and isinstance(continuity, dict):
            parent_bool, _ = coerce_unambiguous_bool(scene_plan_scene.get("continuous_with_previous"))
            if parent_bool is None:
                parent_bool = False
            changes += _set(continuity, "continuous_with_previous", parent_bool)
        for field, mapping, aliases in (
            ("shot_size", SHOT_SIZE_MAP, {"全景": "wide", "大远景": "extreme_wide", "特写": "extreme_close"}),
            ("camera", CAMERA_MAP, {"平视": "eye_level", "俯拍": "high_angle", "仰拍": "low_angle", "顶视": "overhead", "主观": "pov"}),
            ("movement", MOVEMENT_MAP, {"固定": "static", "推近": "push_in", "拉远": "pull_out"}),
        ):
            canonical, changed = coerce_unambiguous_enum(shot.get(field), mapping, aliases)
            if canonical is not None and (type(shot.get(field)) is not str or shot.get(field) != canonical):
                shot[field] = canonical
            if changed:
                changes += 1
        duration, changed = coerce_unambiguous_number(shot.get("duration"))
        if duration is not None and (type(shot.get("duration")) not in (int, float) or shot.get("duration") != duration):
            shot["duration"] = duration
        if changed:
            changes += 1
        for field in ("character_refs", "prop_refs"):
            refs = shot.get(field)
            if isinstance(refs, list):
                normalized, count = _ordered_unique(refs)
                if count:
                    shot[field] = normalized
                    changes += count

        # Evidence quote text is not a creative field. First restore representation-only
        # drift against current Beat/Script authority. If the model over-quotes across a
        # Beat boundary, deterministically keep only exact current-authority fragments
        # that are literally present in the invalid quote. This can narrow evidence, but
        # never invent or paraphrase it. Anything not mechanically re-anchorable remains
        # a hard validator error with a precise repair path.
        if isinstance(script_scene, dict):
            bid = str(shot.get("beat_id") or "")
            beat = next((b for b in (script_scene.get("beats") or []) if isinstance(b, dict) and str(b.get("beat_id") or "") == bid), {})
            source_authority = str((beat_source_authority or {}).get(bid) or "")
            authorities = _evidence_corpus(script_scene, beat, source_authority)
            evidence = shot.get("source_evidence")
            if isinstance(evidence, list):
                normalized_evidence: list[dict[str, str]] = []
                evidence_changed = False
                for item in evidence:
                    if not isinstance(item, dict) or not isinstance(item.get("quote"), str):
                        normalized_evidence.append(item)
                        continue
                    quote = item.get("quote")
                    anchored = reanchor_quote_to_authorities(quote, authorities)
                    if anchored is not None:
                        normalized_evidence.append({"quote": anchored})
                        evidence_changed = evidence_changed or anchored != quote or set(item) != {"quote"}
                        continue
                    fragments = _reanchor_overwide_evidence_quote(quote, authorities)
                    if fragments:
                        normalized_evidence.extend({"quote": fragment} for fragment in fragments)
                        evidence_changed = True
                    else:
                        normalized_evidence.append(item)
                if evidence_changed and normalized_evidence != evidence:
                    shot["source_evidence"] = normalized_evidence
                    changes += 1
    if isinstance(script_scene, dict):
        changes += _canonicalize_frozen_dialogue_segments(out, script_scene)
        changes += _canonicalize_frozen_narration_segments(out, script_scene)
    return out, changes


def _error(errors: list[dict[str, Any]], etype: str, detail: str, **context: Any) -> None:
    item: dict[str, Any] = {"type": etype, "detail": detail}
    item.update(context)
    errors.append(item)


def _require_fields(errors: list[dict[str, Any]], item: dict[str, Any], fields: list[str], *, path: str) -> None:
    for field in fields:
        if field not in item:
            _error(errors, "missing_storyboard_field", f"{path}.{field} is required", path=path, field=field)


def _string(errors: list[dict[str, Any]], item: dict[str, Any], field: str, *, path: str, nonempty: bool = False) -> None:
    value = item.get(field)
    if not isinstance(value, str):
        _error(errors, "invalid_storyboard_scalar", f"{path}.{field} must be string", path=path, field=field)
    elif nonempty and not value.strip():
        _error(errors, "invalid_storyboard_scalar", f"{path}.{field} must be nonempty string", path=path, field=field)


def _script_beats(script_scene: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        str(b.get("beat_id")): b
        for b in script_scene.get("beats", []) or []
        if isinstance(b, dict) and b.get("beat_id")
    }


def _expected_dialogue(beat: dict[str, Any]) -> list[tuple[str, str]]:
    return [
        (str(group["character_id"]), "".join(str(x) for x in group["texts"]))
        for group in _dialogue_utterance_groups(beat)
    ]




def _expected_frozen_dialogue_segments(beat: dict[str, Any]) -> list[tuple[str, str]]:
    segments: list[tuple[str, str]] = []
    for group in _dialogue_utterance_groups(beat):
        cid = str(group["character_id"])
        authority = "".join(str(x) for x in group["texts"])
        units = _split_narration_semantic_units(authority) or ([authority] if authority else [])
        segments.extend((cid, text) for text in units)
    return segments

def _expected_narration(beat: dict[str, Any]) -> list[str]:
    return [str(x) for x in beat.get("narration", []) or [] if isinstance(x, str) and x]




_EVIDENCE_SENTENCE_RE = re.compile(r"[^。！？；\n]+[。！？；]?[”’\"']?")
_EVIDENCE_EDGE_QUOTES = " \t\r\n“”‘’\"'"


def _evidence_quote_pieces(quote: str) -> list[str]:
    pieces: list[str] = []
    for match in _EVIDENCE_SENTENCE_RE.finditer(quote):
        raw = match.group(0).strip()
        if not raw:
            continue
        pieces.append(raw)
        stripped = raw.strip(_EVIDENCE_EDGE_QUOTES)
        if stripped and stripped != raw:
            pieces.append(stripped)
        for pattern in (r"“([^”]+)”", r"‘([^’]+)’", r'"([^"]+)"'):
            for inner in re.findall(pattern, raw):
                inner = inner.strip()
                if inner:
                    pieces.append(inner)
        if "：" in raw:
            suffix = raw.rsplit("：", 1)[-1].strip(_EVIDENCE_EDGE_QUOTES)
            if suffix:
                pieces.append(suffix)
    unique: list[str] = []
    for piece in pieces:
        if piece and piece not in unique:
            unique.append(piece)
    return unique


def _reanchor_overwide_evidence_quote(quote: str, authorities: list[str]) -> list[str]:
    """Narrow an over-wide evidence quote to exact current-authority fragments.

    This is intentionally lexical and conservative: every returned fragment must be
    mechanically re-anchorable to the current Beat/Scene authority. No paraphrase,
    semantic inference, or cross-Beat recovery is allowed.
    """
    anchored: list[str] = []
    for piece in _evidence_quote_pieces(quote):
        if len(normalize_authority_text(piece)) < 4:
            continue
        exact = reanchor_quote_to_authorities(piece, authorities)
        if exact is not None and exact not in anchored:
            anchored.append(exact)
    return anchored


def _authority_units(text: str) -> list[str]:
    if not isinstance(text, str) or not text.strip():
        return []
    units = [m.group(0).strip() for m in _EVIDENCE_SENTENCE_RE.finditer(text) if m.group(0).strip()]
    return units or [text.strip()]


def _repair_evidence_candidates(corpus: list[str], invalid_quote: str, description: object, *, limit: int = 8) -> list[str]:
    """Return compact exact current-authority choices for targeted evidence Repair."""
    pool: list[str] = []
    for authority in corpus:
        for candidate in _authority_units(authority):
            if candidate and candidate not in pool and len(candidate) <= 280:
                pool.append(candidate)
        if authority and authority not in pool and len(authority) <= 280:
            pool.append(authority)

    quote_n = normalize_authority_text(invalid_quote)
    desc_n = normalize_authority_text(description)

    def score(candidate: str) -> tuple[float, float, int]:
        cn = normalize_authority_text(candidate)
        if not cn:
            return (0.0, 0.0, -len(candidate))
        quote_score = SequenceMatcher(None, cn, quote_n).ratio() if quote_n else 0.0
        desc_score = SequenceMatcher(None, cn, desc_n).ratio() if desc_n else 0.0
        if candidate in invalid_quote:
            quote_score += 1.0
        return (max(quote_score, desc_score), desc_score, -len(candidate))

    return sorted(pool, key=score, reverse=True)[:limit]

def _evidence_corpus(script_scene: dict[str, Any], beat: dict[str, Any], source_authority: str = "") -> list[str]:
    values: list[str] = []
    if isinstance(source_authority, str) and source_authority:
        values.append(source_authority)
    scene_description = script_scene.get("scene_description")
    if isinstance(scene_description, str) and scene_description:
        values.append(scene_description)
    description = beat.get("description")
    if isinstance(description, str) and description:
        values.append(description)
    for item in beat.get("dialogue", []) or []:
        if isinstance(item, dict) and isinstance(item.get("line"), str) and item.get("line"):
            values.append(item["line"])
    for item in beat.get("narration", []) or []:
        if isinstance(item, str) and item:
            values.append(item)
    return values


def _validate_model_frozen_text_allocation(
    script_scene: dict[str, Any],
    model_value: Any,
) -> list[dict[str, Any]]:
    """Validate model-owned unit allocation before canonical text materialization.

    The model may choose only where immutable text units live. It never owns the
    text itself. This validation keeps unknown/wrong-channel/wrong-beat refs and
    missing/duplicate/reordered allocations observable instead of letting them
    collapse into a generic downstream text mismatch.
    """
    if not isinstance(model_value, dict):
        return []
    shots = model_value.get("shots")
    if not isinstance(shots, list):
        return []
    # Contract v14/provider schema emits unit refs. Keep a narrow compatibility
    # path for persisted fixtures or json_object fallback models that still emit
    # raw dialogue/narration: canonical validation below accepts them only when
    # they already align to complete frozen units, so arbitrary mid-unit splits
    # remain invalid. Once any Shot uses v14 refs, require the ref contract for
    # every Shot in the Scene.
    uses_unit_refs = any(
        isinstance(shot, dict) and ("dialogue_unit_refs" in shot or "narration_unit_refs" in shot)
        for shot in shots
    )
    if not uses_unit_refs:
        return []

    errors: list[dict[str, Any]] = []
    units = build_frozen_text_units(script_scene)
    unit_index = {
        str(unit.get("unit_id")): unit
        for group in units.values()
        for channel in ("dialogue", "narration")
        for unit in group.get(channel, [])
        if isinstance(unit, dict) and unit.get("unit_id")
    }
    actual: dict[str, dict[str, list[str]]] = {
        bid: {"dialogue": [], "narration": []} for bid in units
    }

    for si, shot in enumerate(shots):
        if not isinstance(shot, dict):
            continue
        bid = str(shot.get("beat_id") or "")
        for field, channel in (("dialogue_unit_refs", "dialogue"), ("narration_unit_refs", "narration")):
            path = f"scene.shots[{si}].{field}"
            if field not in shot:
                _error(errors, "missing_storyboard_field", f"{path} is required", path=path, field=field)
                continue
            refs = shot.get(field)
            if not isinstance(refs, list):
                _error(errors, "shape_type_mismatch", f"{path} must be JSON array", path=path, expected="JSON array", actual_type=type(refs).__name__)
                continue
            for ri, ref in enumerate(refs):
                ref_path = f"{path}[{ri}]"
                if not isinstance(ref, str) or not ref:
                    _error(errors, "invalid_storyboard_frozen_text_unit_ref", f"{ref_path} must be nonempty unit_id string", path=ref_path)
                    continue
                unit = unit_index.get(ref)
                if unit is None:
                    _error(errors, "unknown_storyboard_frozen_text_unit_ref", f"unknown frozen text unit: {ref}", path=ref_path, unit_id=ref)
                    continue
                if unit.get("channel") != channel:
                    _error(errors, "storyboard_frozen_text_unit_channel_mismatch", f"{ref} belongs to {unit.get('channel')}, not {channel}", path=ref_path, unit_id=ref, expected_channel=channel, actual_channel=unit.get("channel"))
                    continue
                unit_bid = str(unit.get("beat_id") or "")
                if unit_bid != bid:
                    _error(errors, "storyboard_frozen_text_unit_beat_mismatch", f"{ref} belongs to {unit_bid}, not Shot beat {bid}", path=ref_path, unit_id=ref, expected_beat_id=bid, actual_beat_id=unit_bid)
                    continue
                actual.setdefault(bid, {"dialogue": [], "narration": []})[channel].append(ref)

    for bid, group in units.items():
        for channel in ("dialogue", "narration"):
            expected_refs = [str(unit.get("unit_id")) for unit in group.get(channel, []) if isinstance(unit, dict) and unit.get("unit_id")]
            actual_refs = actual.get(bid, {}).get(channel, [])
            if actual_refs != expected_refs:
                _error(
                    errors,
                    "storyboard_frozen_text_unit_allocation_mismatch",
                    f"{channel} frozen text units for {bid} must be allocated exactly once, in order, without splitting",
                    path="scene.shots",
                    beat_id=bid,
                    channel=channel,
                    expected_unit_refs=expected_refs,
                    got_unit_refs=actual_refs,
                )
    return errors


def validate_storyboard_scene_output(
    scene_plan_scene: dict[str, Any],
    script_scene: dict[str, Any],
    value: Any,
    *,
    prop_manifest: dict[str, dict[str, Any]] | None = None,
    beat_source_authority: dict[str, str] | None = None,
    model_allocation: Any | None = None,
) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    if not isinstance(value, dict):
        return [{"type": "shape_type_mismatch", "path": "scene", "detail": "scene must be JSON object", "expected": "JSON object", "actual_type": type(value).__name__}]

    if model_allocation is not None:
        errors.extend(_validate_model_frozen_text_allocation(script_scene, model_allocation))

    scene_fields = output_contract()["canonical_scene_fields"]
    shot_fields = output_contract()["canonical_shot_fields"]
    dialogue_fields = output_contract()["dialogue_fields"]
    continuity_fields = output_contract()["continuity_fields"]
    evidence_fields = output_contract()["source_evidence_fields"]

    _require_fields(errors, value, scene_fields, path="scene")
    for field in sorted(set(value) - set(scene_fields)):
        _error(errors, "extra_storyboard_field", f"scene.{field} is not part of Base Storyboard", path=f"scene.{field}", field=field)
    _string(errors, value, "scene_id", path="scene", nonempty=True)
    _string(errors, value, "context_ref", path="scene")
    _string(errors, value, "location_ref", path="scene", nonempty=True)
    if value.get("scene_id") != scene_plan_scene.get("scene_id"):
        _error(errors, "storyboard_scene_id_mismatch", "Storyboard scene_id must match Scene Plan", scene_id=value.get("scene_id"))
    if value.get("location_ref") != scene_plan_scene.get("location_ref"):
        _error(errors, "storyboard_location_mismatch", "Storyboard location_ref must match Scene Plan", scene_id=value.get("scene_id"))
    if (value.get("context_ref") or "") != (scene_plan_scene.get("context_ref") or ""):
        _error(errors, "storyboard_context_mismatch", "Storyboard context_ref must match Scene Plan", scene_id=value.get("scene_id"))

    shots = value.get("shots")
    if not isinstance(shots, list):
        _error(errors, "shape_type_mismatch", "scene.shots must be JSON array", path="scene.shots", expected="JSON array", actual_type=type(shots).__name__)
        return errors
    if not shots:
        _error(errors, "empty_storyboard_scene", "Storyboard Scene requires at least one Shot", scene_id=value.get("scene_id"))
        return errors

    allowed_chars = set(scene_plan_scene.get("character_refs", []) or [])
    allowed_props = set(scene_plan_scene.get("prop_refs", []) or [])
    beat_order = [str(b.get("beat_id")) for b in scene_plan_scene.get("beat_list", []) or [] if isinstance(b, dict) and b.get("beat_id")]
    allowed_beats = set(beat_order)
    beat_positions = {bid: index for index, bid in enumerate(beat_order)}
    script_beats = _script_beats(script_scene)
    actual_dialogue: dict[str, list[tuple[str, str]]] = {bid: [] for bid in beat_order}
    actual_narration: dict[str, list[str]] = {bid: [] for bid in beat_order}
    covered: set[str] = set()
    last_beat_position = -1

    for si, shot in enumerate(shots):
        sp = f"scene.shots[{si}]"
        if not isinstance(shot, dict):
            _error(errors, "shape_type_mismatch", f"{sp} must be JSON object", path=sp, expected="JSON object", actual_type=type(shot).__name__)
            continue
        _require_fields(errors, shot, shot_fields, path=sp)
        for field in sorted(set(shot) - set(shot_fields)):
            _error(errors, "extra_storyboard_field", f"{sp}.{field} is not part of Base Shot", path=f"{sp}.{field}", field=field)
        _string(errors, shot, "shot_id", path=sp, nonempty=True)
        _string(errors, shot, "scene_id", path=sp, nonempty=True)
        _string(errors, shot, "beat_id", path=sp, nonempty=True)
        _string(errors, shot, "shot_size", path=sp, nonempty=True)
        _string(errors, shot, "camera", path=sp, nonempty=True)
        _string(errors, shot, "movement", path=sp, nonempty=True)
        _string(errors, shot, "composition", path=sp)
        _string(errors, shot, "description", path=sp, nonempty=True)
        if isinstance(shot.get("description"), str) and _description_has_non_atomic_time_window(shot.get("description")):
            _error(errors, "storyboard_non_atomic_time_window", "shot.description 压缩了长叙事时间或多个时间阶段，必须拆成连续、可直接拍摄的 Shot。", shot_id=shot.get("shot_id"), shot_index=si, beat_id=shot.get("beat_id"))
        if isinstance(shot.get("description"), str) and _description_requires_visual_rewrite(shot.get("description")):
            _error(errors, "storyboard_non_visual_description", "shot.description 含不可直接视觉化的叙事、心理、作者评论或纯声音信息，必须收缩为当前镜头可拍摄的视觉事实。", shot_id=shot.get("shot_id"), shot_index=si, beat_id=shot.get("beat_id"))
        if shot.get("scene_id") != value.get("scene_id"):
            _error(errors, "shot_scene_mismatch", "shot.scene_id must equal parent scene_id", shot_id=shot.get("shot_id"))

        bid = shot.get("beat_id")
        if isinstance(bid, str) and bid in allowed_beats:
            covered.add(bid)
            current_beat_position = beat_positions[bid]
            if current_beat_position < last_beat_position:
                _error(errors, "storyboard_beat_order_violation", f"Shot Beat order must follow Scene Plan beat_list; got {bid} after a later Beat", scene_id=value.get("scene_id"), shot_id=shot.get("shot_id"), beat_id=bid)
            else:
                last_beat_position = current_beat_position
        else:
            _error(errors, "unknown_storyboard_beat", f"shot beat_id not present in current Scene Plan: {bid}", scene_id=value.get("scene_id"), shot_id=shot.get("shot_id"), beat_id=bid)

        if shot.get("shot_size") not in SHOT_SIZE_MAP:
            _error(errors, "invalid_shot_size", f"unsupported shot_size: {shot.get('shot_size')}", shot_id=shot.get("shot_id"))
        if shot.get("camera") not in CAMERA_MAP:
            _error(errors, "invalid_camera", f"unsupported camera: {shot.get('camera')}", shot_id=shot.get("shot_id"))
        if shot.get("movement") not in MOVEMENT_MAP:
            _error(errors, "invalid_movement", f"unsupported movement: {shot.get('movement')}", shot_id=shot.get("shot_id"))
        duration = shot.get("duration")
        if isinstance(duration, bool) or not isinstance(duration, (int, float)) or duration <= 0:
            _error(errors, "invalid_shot_duration", f"duration must be a positive number: {duration}", shot_id=shot.get("shot_id"))

        for field, allowed, etype in (
            ("character_refs", allowed_chars, "storyboard_character_ref_not_in_scene"),
            ("prop_refs", allowed_props, "storyboard_prop_ref_not_in_scene"),
        ):
            refs = shot.get(field)
            if not isinstance(refs, list):
                _error(errors, "shape_type_mismatch", f"{sp}.{field} must be JSON array", path=f"{sp}.{field}", expected="JSON array", actual_type=type(refs).__name__)
            else:
                for ri, ref in enumerate(refs):
                    if not isinstance(ref, str):
                        _error(errors, "shape_type_mismatch", f"{sp}.{field}[{ri}] must be string", path=f"{sp}.{field}[{ri}]", expected="string", actual_type=type(ref).__name__)
                    elif ref not in allowed:
                        _error(errors, etype, f"{field[:-1]} not allowed in current Scene: {ref}", shot_id=shot.get("shot_id"), ref=ref)

        if isinstance(prop_manifest, dict) and prop_manifest and isinstance(shot.get("prop_refs"), list):
            required_refs = _required_prop_refs(_shot_prop_text(shot), prop_manifest)
            actual_refs = {ref for ref in shot.get("prop_refs", []) if isinstance(ref, str)}
            for ref in sorted(required_refs - actual_refs):
                _error(errors, "storyboard_missing_visible_prop_ref", f"Current Shot physically uses Story Bible prop but shot.prop_refs omits it: {ref}", shot_id=shot.get("shot_id"), shot_index=si, beat_id=bid, prop_ref=ref)
            # Only call a ref unsupported when the model substituted the visible prop entirely.
            # If at least one required prop is already present, preserve additional scene-allowed refs;
            # they may be legitimately visible/contextual even when the current text does not name them.
            if required_refs and required_refs.isdisjoint(actual_refs):
                for ref in sorted(actual_refs - required_refs):
                    if ref in prop_manifest:
                        _error(errors, "storyboard_unsupported_prop_ref", f"shot.prop_refs substitutes a different prop for the prop physically supported by this Shot: {ref}", shot_id=shot.get("shot_id"), shot_index=si, beat_id=bid, prop_ref=ref)

        dialogue = shot.get("dialogue")
        if not isinstance(dialogue, list):
            _error(errors, "shape_type_mismatch", f"{sp}.dialogue must be JSON array", path=f"{sp}.dialogue", expected="JSON array", actual_type=type(dialogue).__name__)
        else:
            for di, item in enumerate(dialogue):
                dp = f"{sp}.dialogue[{di}]"
                if not isinstance(item, dict):
                    _error(errors, "shape_type_mismatch", f"{dp} must be JSON object", path=dp, expected="JSON object", actual_type=type(item).__name__)
                    continue
                _require_fields(errors, item, dialogue_fields, path=dp)
                for field in sorted(set(item) - set(dialogue_fields)):
                    _error(errors, "extra_storyboard_field", f"{dp}.{field} is not part of canonical Dialogue", path=f"{dp}.{field}", field=field)
                _string(errors, item, "character_id", path=dp, nonempty=True)
                _string(errors, item, "line", path=dp, nonempty=True)
                cid = item.get("character_id")
                # Dialogue is an audio stream frozen by Script. character_refs describes
                # who is actually visible in this Shot; a frozen speaker may therefore
                # be absent during a listener/reaction Shot. Production Semantics derives
                # offscreen deterministically from this visibility relation.
                if isinstance(bid, str) and bid in actual_dialogue and isinstance(cid, str) and isinstance(item.get("line"), str):
                    actual_dialogue[bid].append((cid, item["line"]))

        narration = shot.get("narration")
        if not isinstance(narration, list):
            _error(errors, "shape_type_mismatch", f"{sp}.narration must be JSON array", path=f"{sp}.narration", expected="JSON array", actual_type=type(narration).__name__)
        else:
            for ni, text in enumerate(narration):
                np = f"{sp}.narration[{ni}]"
                if not isinstance(text, str) or not text.strip():
                    _error(errors, "invalid_storyboard_narration", f"{np} must be nonempty string", path=np)
                elif isinstance(bid, str) and bid in actual_narration:
                    actual_narration[bid].append(text)

        continuity = shot.get("continuity")
        if not isinstance(continuity, dict):
            _error(errors, "shape_type_mismatch", f"{sp}.continuity must be JSON object", path=f"{sp}.continuity", expected="JSON object", actual_type=type(continuity).__name__)
        else:
            _require_fields(errors, continuity, continuity_fields, path=f"{sp}.continuity")
            for field in sorted(set(continuity) - set(continuity_fields)):
                _error(errors, "extra_storyboard_field", f"{sp}.continuity.{field} is not part of Base continuity", path=f"{sp}.continuity.{field}", field=field)
            if not isinstance(continuity.get("continuous_with_previous"), bool):
                _error(errors, "invalid_storyboard_scalar", f"{sp}.continuity.continuous_with_previous must be boolean", path=f"{sp}.continuity.continuous_with_previous", field="continuous_with_previous")
            elif si == 0 and continuity.get("continuous_with_previous") is not bool(scene_plan_scene.get("continuous_with_previous")):
                _error(errors, "storyboard_scene_boundary_continuity_mismatch", "first Shot continuity.continuous_with_previous must equal Scene Plan.continuous_with_previous", scene_id=value.get("scene_id"), shot_id=shot.get("shot_id"))
            _string(errors, continuity, "axis_side", path=f"{sp}.continuity", nonempty=True)
            _string(errors, continuity, "eyeline_match", path=f"{sp}.continuity", nonempty=True)

        evidence = shot.get("source_evidence")
        if not isinstance(evidence, list):
            _error(errors, "shape_type_mismatch", f"{sp}.source_evidence must be JSON array", path=f"{sp}.source_evidence", expected="JSON array", actual_type=type(evidence).__name__)
        elif not evidence:
            _error(errors, "missing_storyboard_source_evidence", "each Shot requires at least one source_evidence item", shot_id=shot.get("shot_id"))
        else:
            beat = script_beats.get(str(bid)) if isinstance(bid, str) else None
            source_authority = str((beat_source_authority or {}).get(str(bid)) or "")
            corpus = _evidence_corpus(script_scene, beat or {}, source_authority)
            valid_evidence_quotes: list[str] = []
            for ei, item in enumerate(evidence):
                ep = f"{sp}.source_evidence[{ei}]"
                if not isinstance(item, dict):
                    _error(errors, "shape_type_mismatch", f"{ep} must be JSON object", path=ep, expected="JSON object", actual_type=type(item).__name__)
                    continue
                _require_fields(errors, item, evidence_fields, path=ep)
                for field in sorted(set(item) - set(evidence_fields)):
                    _error(errors, "extra_storyboard_field", f"{ep}.{field} is not part of source_evidence", path=f"{ep}.{field}", field=field)
                quote = item.get("quote")
                if not isinstance(quote, str) or not quote.strip():
                    _error(errors, "invalid_storyboard_evidence_quote", f"{ep}.quote must be nonempty string", path=ep)
                elif not any(quote in text for text in corpus):
                    repair_path = f"{ep}.quote"
                    _error(
                        errors,
                        "storyboard_evidence_not_in_script",
                        f"source evidence quote is not anchored to current Script Beat/Scene: {quote}",
                        path=repair_path,
                        target_path=repair_path,
                        repair_targets=[repair_path],
                        shot_id=shot.get("shot_id"),
                        shot_index=si,
                        beat_id=bid,
                        evidence_index=ei,
                        quote=quote,
                        allowed_evidence_quotes=_repair_evidence_candidates(corpus, quote, shot.get("description")),
                        beat_source_authority=source_authority,
                        repair_instruction=(
                            "replace only this source_evidence quote with the smallest exact quote from the current Beat/Scene authority; "
                            "do not change description or any other Shot field"
                        ),
                    )
                else:
                    valid_evidence_quotes.append(quote)

            description = shot.get("description")
            if isinstance(description, str) and description.strip():
                # Two separate invariants must not be conflated:
                # 1) the Shot description itself must be supported by current Script authority;
                # 2) the model-selected source_evidence must actually bind that supported description.
                # A binding gap is repairable by rebinding evidence only; an unsupported
                # description is a real semantic error and must shrink the description.
                if not text_is_anchored(description, corpus):
                    _error(
                        errors,
                        "storyboard_description_not_supported_by_evidence",
                        "Shot description is not sufficiently anchored by the current Script Beat/Scene authority",
                        shot_id=shot.get("shot_id"),
                        shot_index=si,
                        beat_id=bid,
                        path=f"{sp}.description",
                        repair_action="Shrink only this Shot.description to visible facts directly supported by the current Script Beat/Scene, then bind the smallest exact source_evidence quote(s).",
                    )
                elif valid_evidence_quotes and not text_is_anchored(description, valid_evidence_quotes):
                    _error(
                        errors,
                        "storyboard_description_evidence_binding_gap",
                        "Shot description is supported by the current Script Beat/Scene, but the bound source_evidence does not directly support that description",
                        shot_id=shot.get("shot_id"),
                        shot_index=si,
                        beat_id=bid,
                        path=f"{sp}.source_evidence",
                        bound_evidence=valid_evidence_quotes,
                        repair_action="Keep description unchanged and replace only this Shot.source_evidence with the smallest exact current-Beat/Scene quote(s) that directly support the description.",
                    )

    for bid in beat_order:
        if bid not in covered:
            _error(errors, "missing_storyboard_beat", f"Storyboard missing Beat {bid}", scene_id=value.get("scene_id"), beat_id=bid)
        expected = _expected_frozen_dialogue_segments(script_beats.get(bid, {}))
        actual = actual_dialogue.get(bid, [])
        if actual != expected:
            _error(
                errors,
                "storyboard_dialogue_mismatch",
                "Storyboard must allocate complete dialogue FrozenText semantic units exactly once, in order and with the same speaker; commas and open quotes are not valid split boundaries",
                scene_id=value.get("scene_id"),
                beat_id=bid,
                path="scene.shots",
                expected_segments=expected,
                got_segments=actual,
            )
        expected_narration = _expected_frozen_narration_texts(script_beats.get(bid, {}))
        actual_voiceover = actual_narration.get(bid, [])
        expected_joined = "".join(expected_narration)
        actual_joined = "".join(actual_voiceover)
        if actual_voiceover != expected_narration:
            _error(
                errors,
                "storyboard_narration_mismatch",
                "Storyboard must allocate complete frozen narration semantic units exactly once, in order; commas and open quotes are not valid split boundaries",
                scene_id=value.get("scene_id"),
                beat_id=bid,
                path="scene.shots",
                expected_joined=expected_joined,
                got_joined=actual_joined,
                expected_segments=expected_narration,
                got_segments=actual_voiceover,
            )

    return errors
