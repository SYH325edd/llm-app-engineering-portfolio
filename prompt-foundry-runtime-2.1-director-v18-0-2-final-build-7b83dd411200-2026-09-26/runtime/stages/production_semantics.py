from __future__ import annotations

import copy
import re
from typing import Any

from runtime.value_normalization import coerce_unambiguous_bool
from runtime.text_authority import reanchor_quote_to_authorities, text_is_anchored
from runtime.authority_contract import authority_manifest

CONTRACT_VERSION = "production_semantics_shot.v1j"

RENDERABILITY_STATUSES = {"renderable", "needs_adaptation", "blocked"}
AUDIO_TYPES = {"diegetic", "non_diegetic"}
AUDIO_ROLES = {"action", "environment", "atmosphere"}
AUDIO_ORIGINS = {"source", "production_design"}
ISSUE_TYPES = {"non_visual_source", "underspecified_action", "temporal_compression", "conflicting_instruction", "other"}

SOFT_QUALITY_ERROR_TYPES = frozenset({
    # These are heuristic language/overlap checks. Structural refs, exact provenance,
    # enums and no-story-change rules remain hard validation errors.
    "production_semantics_visual_event_not_supported",
    "production_semantics_non_visual_event",
})
PRODUCTION_CHOICE_TYPES = {"minimal_action_mechanism", "spatial_adjustment", "natural_reaction"}
STORY_CHANGE_FIELDS = {
    "new_characters",
    "new_relationships",
    "new_plot_outcomes",
    "new_dialogue_information",
    "new_locations",
    "new_key_props",
}
TEXT_CARRIER_TYPES = {"prop", "environment"}
DIALOGUE_DELIVERY_MODES = {"direct", "quoted", "voiceover"}
APPEARANCE_OVERRIDE_KEYS = {"age_appearance", "temporary_injury", "temporary_clothing_change"}

_PRODUCTION_AUDIO_MUSIC_RE = re.compile(r"(?:配乐|背景音乐|音乐|BGM|bgm|旋律|score|soundtrack)", re.I)
_PRODUCTION_AUDIO_SEMANTIC_EVENT_RE = re.compile(r"(?:枪声|爆炸|敲门|电话铃|手机铃|警笛|尖叫|哭喊|求救|玻璃碎裂|撞击巨响)")

SYSTEM_PROMPT = """你是 Prompt Foundry Runtime 2.x 的 Production Semantics v1j，只处理一个已经冻结的 Base Shot。
你的职责是把当前 Shot 已有证据编译成受控的影视生产语义；你不是第二个 Storyboard，也不是 Director。

模型字段只允许：visual_events、audio_events、renderability_status、renderability_issues、diegetic_text、production_choices、appearance_overlays、dialogue_delivery。
shot_id、context_ref 与完整 dialogue 均由程序注入。dialogue 的 character_id、line、offscreen、delivery_mode、embedded_quotes 都不是模型直接字段；offscreen 由程序根据“speaker 是否存在于当前 Shot.character_refs”确定性派生，delivery_mode 由 dialogue_delivery 中对对应 dialogue_index 的可选覆盖派生，未覆盖默认 direct。program_owned.dialogue_pairs[*].embedded_quote_candidates 由程序从冻结对白中的内层引号精确提取，模型只能选择 quote_index，不能改写原话。

硬边界：
1. visual_events 只编译当前已经冻结的 Base Shot 可见语义：action 必须由 program_owned.current_shot_visual_authority（即已通过 Stage 4 校验的当前 Shot.description）直接支持；不得新增该 Shot 没有的动作或剧情事实。source_evidence 仍必须绑定 program_owned.current_shot_evidence 中的原始 Script 证据，用于 provenance，不要求 action 与原始 quote 保持同一措辞。
2. audio_events 只放非对白声音；冻结对白不得复制到 audio_events。audio_role 必须是 action/environment/atmosphere。origin=source 时必须有当前 Shot 证据；origin=production_design 时允许 source_evidence=[]，用于不改变剧情的自然动作声、环境底噪和空间氛围声（如脚步、衣料、空调、风雨、房间底噪），禁止新增可理解的语音内容、剧情事件或配乐。
3. 不要输出 dialogue。冻结对白由程序原样保留；若 speaker 在当前 Shot.character_refs 中则 offscreen=false，否则 offscreen=true。dialogue_delivery 使用 dialogue_index 指向冻结对白序号，mode 只能 direct / quoted / voiceover，未提供默认 direct。若某条 direct 对白的 embedded_quote_candidates 中确有“角色正在转述别人/此前说过的原话”，可在同一项增加 embedded_quote_indices=[quote_index,...]；普通强调、名称、术语不要标记。不确定就不标。embedded_quote_indices 只允许引用程序给出的 candidate index，禁止输出 quote text、禁止改写原话，也不要把 offscreen 写进 dialogue_delivery。
4. diegetic_text 只能提取当前 Shot 证据中逐字存在的剧情内文字，并绑定当前 Shot 已存在的 prop 或当前 scene；不得创造文字。
5. production_choices 只允许最小生产适配：minimal_action_mechanism / spatial_adjustment / natural_reaction。每条 choice 必须绑定当前 Shot source_evidence；narrative_context_ref 由程序注入当前 narrative context，模型不要猜测或改写；impact 固定为 no_story_change，且 story_changes 六类数组全部为空。
6. production_choices 禁止新增人物、关系、剧情结果、对白信息、地点或关键道具；不得改变角色动机。
7. 每条 visual/audio event、renderability issue、diegetic_text、production_choice 都必须携带 source_evidence=[{"quote":"..."}]，quote 必须逐字来自 program_owned.current_shot_evidence。注意：source_evidence 是原始 provenance；visual_events.action 的直接语义权威是 current_shot_visual_authority，二者职责不得混用。
8. visual_events / production_choices 的 character_refs / prop_refs 只能使用当前 Shot allowed refs；环境文字 carrier_ref 只能使用 program_owned.current_location_ref。
9. renderability_status 只能是 renderable / needs_adaptation / blocked。production choice 的存在不自动等于 renderable；必须按当前输出真实可执行性判断。
10. appearance_overlays 只允许当前 Shot 角色的 age_appearance / temporary_injury / temporary_clothing_change；narrative_context_ref 由程序注入当前 narrative context，模型只需绑定当前 Shot source_evidence；禁止写 face / hair / body / skin / identity 等基础资产字段。
11. appearance_overlays 是上下文临时覆盖，不得修改基础 Character Asset，也不得创建新角色。
12. visual_events.action、production_choices.choice、appearance_overlays.overrides 以简体中文生产描述为主；原文、角色名、地点名、品牌/型号等已授权专有名词可以保留原写法。不得仅因出现拉丁字母改写事实。
13. 语言表现不是剧情事实 Gate；真正的硬边界是不得新增事件、人物、关系、对白信息、地点、关键道具或改变角色动机。
14. 如果 user payload 含 repair_instruction：以 repair_instruction.invalid_output 为基底，只修 validation_errors 指向的字段。若错误为 production_semantics_visual_event_not_supported，只收缩/改写对应 visual_events[*].action，使其直接落在 current_shot_visual_authority 已冻结的可见动作范围内；不要为了让 action 过检而改 source_evidence，也不要回到更宽的 Script/Beat 上新增动作。若错误为 production_semantics_requires_adaptation，必须优先利用当前 allowed refs、current_shot_evidence 与允许的 no_story_change production_choices 解决 renderability_issues；能解决则输出 renderable，不能在不改变故事事实的前提下解决则输出 blocked，不得再次输出 needs_adaptation。
15. 只输出一个 JSON object：{"production_semantics": {...}}，不要 markdown、解释或前后缀。
"""


def output_template() -> dict[str, Any]:
    return {
        "visual_events": [{
            "action": "",
            "character_refs": [],
            "prop_refs": [],
            "source_evidence": [{"quote": ""}],
        }],
        "audio_events": [{
            "audio_type": "diegetic",
            "audio_role": "action",
            "origin": "source",
            "content": "",
            "source_evidence": [{"quote": ""}],
        }],
        "renderability_status": "renderable",
        "renderability_issues": [{
            "type": "underspecified_action",
            "detail": "",
            "source_evidence": [{"quote": ""}],
        }],
        "dialogue_delivery": [{"dialogue_index": 0, "mode": "direct", "embedded_quote_indices": [0]}],
        "dialogue": [{
            "character_id": "",
            "line": "",
            "offscreen": False,
            "delivery_mode": "direct",
            "embedded_quotes": [{"text": "", "mode": "quoted"}],
        }],
        "diegetic_text": [{
            "content": "",
            "carrier_type": "prop",
            "carrier_ref": "",
            "required_visible": True,
            "source_evidence": [{"quote": ""}],
        }],
        "production_choices": [{
            "type": "minimal_action_mechanism",
            "choice": "",
            "affected_character_refs": [],
            "affected_prop_refs": [],
            "narrative_context_ref": "",
            "impact": "no_story_change",
            "rationale": "",
            "story_changes": {field: [] for field in sorted(STORY_CHANGE_FIELDS)},
            "source_evidence": [{"quote": ""}],
        }],
        "appearance_overlays": [{
            "character_ref": "",
            "narrative_context_ref": "",
            "overrides": {"age_appearance": ""},
            "source_evidence": [{"quote": ""}],
        }],
    }


def output_contract() -> dict[str, Any]:
    return {
        "model_fields": [
            "visual_events", "audio_events", "renderability_status", "renderability_issues",
            "diegetic_text", "production_choices", "appearance_overlays", "dialogue_delivery",
        ],
        "canonical_fields": [
            "shot_id", "context_ref", "visual_events", "audio_events", "renderability_status",
            "renderability_issues", "dialogue_delivery", "dialogue", "diegetic_text", "production_choices", "appearance_overlays",
        ],
        "program_owned_fields": ["shot_id", "context_ref", "dialogue", "dialogue.character_id", "dialogue.line", "dialogue.offscreen", "dialogue.delivery_mode", "dialogue.embedded_quotes", "dialogue.embedded_quotes[].text", "dialogue.embedded_quotes[].mode", "production_choices[].narrative_context_ref", "appearance_overlays[].narrative_context_ref"],
        "visual_event_fields": ["action", "character_refs", "prop_refs", "source_evidence"],
        "audio_event_fields": ["audio_type", "audio_role", "origin", "content", "source_evidence"],
        "renderability_issue_fields": ["type", "detail", "source_evidence"],
        "dialogue_delivery_fields": ["dialogue_index", "mode", "embedded_quote_indices"],
        "dialogue_delivery_required_fields": ["dialogue_index", "mode"],
        "dialogue_delivery_optional_fields": ["embedded_quote_indices"],
        "dialogue_fields": ["character_id", "line", "offscreen", "delivery_mode", "embedded_quotes"],
        "embedded_quote_fields": ["text", "mode"],
        "diegetic_text_fields": ["content", "carrier_type", "carrier_ref", "required_visible", "source_evidence"],
        "production_choice_fields": [
            "type", "choice", "affected_character_refs", "affected_prop_refs",
            "narrative_context_ref", "impact", "rationale", "story_changes", "source_evidence",
        ],
        "appearance_overlay_fields": ["character_ref", "narrative_context_ref", "overrides", "source_evidence"],
        "allowed_appearance_override_keys": sorted(APPEARANCE_OVERRIDE_KEYS),
        "story_change_fields": sorted(STORY_CHANGE_FIELDS),
        "allowed_renderability_statuses": sorted(RENDERABILITY_STATUSES),
        "allowed_audio_types": sorted(AUDIO_TYPES),
        "allowed_audio_roles": sorted(AUDIO_ROLES),
        "allowed_audio_origins": sorted(AUDIO_ORIGINS),
        "allowed_issue_types": sorted(ISSUE_TYPES),
        "allowed_production_choice_types": sorted(PRODUCTION_CHOICE_TYPES),
        "allowed_text_carrier_types": sorted(TEXT_CARRIER_TYPES),
        "allowed_dialogue_delivery_modes": sorted(DIALOGUE_DELIVERY_MODES),
        "authority_rule": (
            "visual_events compile only the frozen Base Shot visual authority while retaining exact upstream Script provenance; "
            "production choices may add only minimal no-story-change staging; appearance overlays are evidence-bound temporary context overrides only"
        ),
    }



def _model_asset_projection(assets: dict[str, Any]) -> dict[str, Any]:
    """Keep only shot-local production facts the model can actually use.

    Source evidence/offsets and unrelated Story Bible metadata remain program-owned
    and are intentionally excluded from high-fanout shot prompts.
    """
    out: dict[str, Any] = {"characters": {}, "props": {}, "scene": {}, "context": {}}
    for ref, item in (assets.get("characters") or {}).items():
        if not isinstance(item, dict):
            continue
        out["characters"][ref] = {
            key: copy.deepcopy(item.get(key))
            for key in ("character_id", "canonical_name", "aliases", "role_type", "explicit_facts", "identity_lock", "visual_lock")
            if item.get(key) not in (None, "", [], {})
        }
    for ref, item in (assets.get("props") or {}).items():
        if not isinstance(item, dict):
            continue
        out["props"][ref] = {
            key: copy.deepcopy(item.get(key))
            for key in ("prop_id", "canonical_name", "name", "aliases", "narrative_importance", "visual_presence", "explicit_facts")
            if item.get(key) not in (None, "", [], {})
        }
    scene = assets.get("scene") or {}
    if isinstance(scene, dict):
        out["scene"] = {
            key: copy.deepcopy(scene.get(key))
            for key in ("scene_id", "canonical_name", "name", "time", "weather", "explicit_facts", "visual_lock")
            if scene.get(key) not in (None, "", [], {})
        }
    narrative = assets.get("context") or {}
    if isinstance(narrative, dict):
        out["context"] = {
            key: copy.deepcopy(narrative.get(key))
            for key in ("context_id", "reality_status", "temporal_mode", "representation_mode")
            if narrative.get(key) not in (None, "", [], {})
        }
    return out


def _model_output_template() -> dict[str, Any]:
    # Item field shapes are already published in output_contract. Empty collection
    # skeletons avoid resending seven verbose example objects for every Shot.
    return {
        "visual_events": [],
        "audio_events": [],
        "renderability_status": "renderable",
        "renderability_issues": [],
        "dialogue_delivery": [],
        "diegetic_text": [],
        "production_choices": [],
        "appearance_overlays": [],
    }


def _model_output_contract() -> dict[str, Any]:
    contract = output_contract()
    return {
        "item_fields": {
            "visual_events": contract["visual_event_fields"],
            "audio_events": contract["audio_event_fields"],
            "renderability_issues": contract["renderability_issue_fields"],
            "dialogue_delivery": contract["dialogue_delivery_required_fields"],
            "diegetic_text": contract["diegetic_text_fields"],
            "production_choices": [x for x in contract["production_choice_fields"] if x != "narrative_context_ref"],
            "appearance_overlays": [x for x in contract["appearance_overlay_fields"] if x != "narrative_context_ref"],
        },
        "optional_item_fields": {"dialogue_delivery": contract["dialogue_delivery_optional_fields"]},
        "allowed_values": {
            "renderability_status": contract["allowed_renderability_statuses"],
            "audio_type": contract["allowed_audio_types"],
            "audio_role": contract["allowed_audio_roles"],
            "audio_origin": contract["allowed_audio_origins"],
            "issue_type": contract["allowed_issue_types"],
            "production_choice_type": contract["allowed_production_choice_types"],
            "text_carrier_type": contract["allowed_text_carrier_types"],
            "appearance_override_keys": contract["allowed_appearance_override_keys"],
        },
        "program_owned_fields": contract["program_owned_fields"],
        "authority_matrix": {
            "visual_events[].action": "program_owned.current_shot_visual_authority",
            "visual_events[].source_evidence": "program_owned.current_shot_evidence",
            "audio_events[origin=source].content": "program_owned.current_shot_evidence",
            "diegetic_text[].content": "bound source_evidence verbatim",
            "production_choices[].choice": "no-story-change adaptation authority with bound current_shot_evidence provenance",
            "appearance_overlays[].overrides": "bound current_shot_evidence provenance",
        },
        "boolean_fields": ["diegetic_text[].required_visible"],
        "boolean_values": [True, False],
        "allowed_appearance_override_keys": contract["allowed_appearance_override_keys"],
        "story_change_fields": contract["story_change_fields"],
        "unknown_fields": "forbidden",
        "authority_manifest": authority_manifest("production_semantics_shot"),
    }



def build_production_semantics_payload(context: dict[str, Any], *, unit_id: str) -> dict[str, Any]:
    return {
        "unit_id": unit_id,
        "contract_version": CONTRACT_VERSION,
        "shot": copy.deepcopy(context.get("shot") or {}),
        "assets": _model_asset_projection(context.get("assets") or {}),
        "program_owned": copy.deepcopy(context.get("program_owned") or {}),
        "output_template": _model_output_template(),
        # Provider Structured Outputs validates the raw model envelope, while
        # output_template remains the inner canonical model payload used by Runtime.
        "provider_output_template": {"production_semantics": _model_output_template()},
        "output_contract": _model_output_contract(),
    }


def canonicalize_production_semantics(candidate: dict[str, Any], context: dict[str, Any]) -> tuple[dict[str, Any], int]:
    out = copy.deepcopy(candidate)
    changes = 0
    shot = context.get("shot") or {}
    scene_context = ((context.get("assets") or {}).get("context") or {})
    shot_id = str(shot.get("shot_id") or "")
    context_ref = str(scene_context.get("context_id") or context.get("context_ref") or "")
    if out.get("shot_id") != shot_id:
        out["shot_id"] = shot_id
        changes += 1
    if out.get("context_ref") != context_ref:
        out["context_ref"] = context_ref
        changes += 1
    if "dialogue_delivery" not in out:
        out["dialogue_delivery"] = []
        changes += 1

    # Dialogue is frozen upstream and its on/off-screen status is a deterministic
    # visibility relation, not a free semantic field. Storyboard character_refs means
    # "visible in this Shot". Therefore a frozen speaker absent from character_refs is
    # necessarily offscreen for this Shot; a visible speaker is onscreen. This removes
    # a redundant model boolean and supports dialogue continuing over reaction shots.
    frozen_dialogue = (context.get("program_owned") or {}).get("dialogue_pairs") or []
    visible_character_refs = set((context.get("program_owned") or {}).get("allowed_character_refs") or [])
    delivery_overrides: dict[int, str] = {}
    embedded_quote_overrides: dict[int, list[int]] = {}
    for decision in out.get("dialogue_delivery") or []:
        if not isinstance(decision, dict):
            continue
        index = decision.get("dialogue_index")
        mode = decision.get("mode")
        if isinstance(index, int) and not isinstance(index, bool) and mode in DIALOGUE_DELIVERY_MODES:
            delivery_overrides[index] = str(mode)
            quote_indices = decision.get("embedded_quote_indices")
            if isinstance(quote_indices, list):
                embedded_quote_overrides[index] = [
                    quote_index for quote_index in quote_indices
                    if isinstance(quote_index, int) and not isinstance(quote_index, bool)
                ]
    canonical_dialogue: list[dict[str, Any]] = []
    for index, item in enumerate(frozen_dialogue):
        character_id = str(item.get("character_id") or "")
        candidates = item.get("embedded_quote_candidates") if isinstance(item, dict) else []
        candidate_by_index = {
            int(candidate.get("quote_index")): candidate
            for candidate in (candidates or [])
            if isinstance(candidate, dict)
            and isinstance(candidate.get("quote_index"), int)
            and not isinstance(candidate.get("quote_index"), bool)
            and isinstance(candidate.get("text"), str)
        }
        embedded_quotes = [
            {"text": str(candidate_by_index[quote_index]["text"]), "mode": "quoted"}
            for quote_index in embedded_quote_overrides.get(index, [])
            if quote_index in candidate_by_index
        ]
        canonical_dialogue.append({
            "character_id": character_id,
            "line": str(item.get("line") or ""),
            "offscreen": character_id not in visible_character_refs,
            "delivery_mode": delivery_overrides.get(index, "direct"),
            "embedded_quotes": embedded_quotes,
        })
    original_dialogue = out.get("dialogue")
    dialogue_exact_match = (
        isinstance(original_dialogue, list)
        and len(original_dialogue) == len(canonical_dialogue)
        and all(
            isinstance(left, dict)
            and left.get("character_id") == right.get("character_id")
            and left.get("line") == right.get("line")
            and type(left.get("offscreen")) is type(right.get("offscreen"))
            and left.get("offscreen") == right.get("offscreen")
            and left.get("delivery_mode") == right.get("delivery_mode")
            and left.get("embedded_quotes") == right.get("embedded_quotes")
            for left, right in zip(original_dialogue, canonical_dialogue)
        )
    )
    if not dialogue_exact_match:
        out["dialogue"] = canonical_dialogue
        changes += 1

    # required_visible is semantic, but exact boolean encodings may drift at the
    # representation layer just like dialogue.offscreen. Normalize only unambiguous
    # true/false/1/0 values; leave null/other text invalid for the validator.
    diegetic_items = out.get("diegetic_text")
    if isinstance(diegetic_items, list):
        for item in diegetic_items:
            if not isinstance(item, dict):
                continue
            required_visible, bool_changed = coerce_unambiguous_bool(item.get("required_visible"))
            if required_visible is not None and item.get("required_visible") is not required_visible:
                item["required_visible"] = required_visible
            elif required_visible is None and item.get("required_visible") is not None:
                # Preserve the invalid value so validation reports the original problem.
                pass
            if bool_changed:
                changes += 1

    # Narrative context identity is program-owned. A production choice/appearance
    # overlay can only apply to the current Shot context, so asking the model to
    # echo an internal context id creates a brittle exact-match failure with no
    # semantic value. Canonicalize it deterministically before validation.
    for field in ("production_choices", "appearance_overlays"):
        items = out.get(field)
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            if str(item.get("narrative_context_ref") or "") != context_ref:
                item["narrative_context_ref"] = context_ref
                changes += 1

    # These values are invariants, not model decisions. Keep the semantic choice model-owned,
    # but canonicalize the no-story-change declaration and environment carrier identity.
    choices = out.get("production_choices")
    if isinstance(choices, list):
        empty_story_changes = {field: [] for field in sorted(STORY_CHANGE_FIELDS)}
        for item in choices:
            if not isinstance(item, dict):
                continue
            if item.get("impact") != "no_story_change":
                item["impact"] = "no_story_change"
                changes += 1
            # Absence/empty object is representation drift; explicit non-empty story
            # changes are semantic evidence of an illegal mutation and must survive
            # canonicalization so the validator can reject them.
            if item.get("story_changes") in (None, {}):
                item["story_changes"] = copy.deepcopy(empty_story_changes)
                changes += 1

    current_location_ref = str((context.get("program_owned") or {}).get("current_location_ref") or "")
    diegetic_items = out.get("diegetic_text")
    if isinstance(diegetic_items, list):
        for item in diegetic_items:
            if not isinstance(item, dict):
                continue
            if item.get("carrier_type") == "environment" and current_location_ref and item.get("carrier_ref") != current_location_ref:
                item["carrier_ref"] = current_location_ref
                changes += 1

    # Evidence text is a reference to current-Shot authority, not a creative field.
    # Normalize representation-only drift to an exact authority string so punctuation
    # changes do not consume a Repair. Semantic/paraphrase drift still fails.
    authority_evidence = (context.get("program_owned") or {}).get("current_shot_evidence") or []
    for field in ("visual_events", "audio_events", "renderability_issues", "diegetic_text", "production_choices", "appearance_overlays"):
        items = out.get(field)
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            evidence = item.get("source_evidence")
            if not isinstance(evidence, list):
                continue
            for ev in evidence:
                if not isinstance(ev, dict) or not isinstance(ev.get("quote"), str):
                    continue
                anchored = reanchor_quote_to_authorities(ev.get("quote"), authority_evidence)
                if anchored is not None and anchored != ev.get("quote"):
                    ev["quote"] = anchored
                    changes += 1

    # v1e adds explicit audio ownership/category. Legacy outputs are safely migrated:
    # existing evidence-backed audio remains source-owned; missing role is classified
    # conservatively from the text only for presentation grouping.
    audio_events = out.get("audio_events")
    if isinstance(audio_events, list):
        env_tokens = ("风", "雨", "雷", "城市", "街", "走廊", "空调", "钟", "鸟", "车流", "人声", "底噪", "监护", "机器", "海浪", "虫鸣")
        for event in audio_events:
            if not isinstance(event, dict):
                continue
            if "origin" not in event:
                event["origin"] = "source" if event.get("source_evidence") else "production_design"
                changes += 1
            if "audio_role" not in event:
                content = str(event.get("content") or "")
                if event.get("audio_type") == "non_diegetic":
                    role = "atmosphere"
                elif any(token in content for token in env_tokens):
                    role = "environment"
                else:
                    role = "action"
                event["audio_role"] = role
                changes += 1
    return out, changes



def _err(errors: list[dict[str, Any]], etype: str, detail: str, **extra: Any) -> None:
    item = {"type": etype, "detail": detail}
    item.update(extra)
    errors.append(item)


def _evidence_quotes(context: dict[str, Any]) -> set[str]:
    return {
        str(item).strip()
        for item in ((context.get("program_owned") or {}).get("current_shot_evidence") or [])
        if isinstance(item, str) and item.strip()
    }


def _visual_action_authority(context: dict[str, Any]) -> list[str]:
    """Return the frozen Base Shot wording that owns visual-event semantics.

    Script/source evidence remains provenance authority. The already-validated
    Storyboard description is a distinct downstream semantic authority: Production
    Semantics may compile/split/rephrase that visible Shot content, but may not add
    actions absent from it. Keeping these authorities separate prevents both
    hallucination laundering and false failures caused by comparing a Shot-level
    production phrase directly against wider Script wording.
    """
    program = context.get("program_owned") or {}
    values = program.get("current_shot_visual_authority") or []
    out = [str(x).strip() for x in values if isinstance(x, str) and str(x).strip()]
    if out:
        return out
    # Backward-compatible fallback for manually built/legacy contexts. At runtime
    # ContextBuilder always publishes current_shot_visual_authority explicitly.
    description = str((context.get("shot") or {}).get("description") or "").strip()
    if description:
        return [description]
    return list(_evidence_quotes(context))


def _dialogue_lines(context: dict[str, Any]) -> set[str]:
    return {
        str(item.get("line") or "").strip()
        for item in ((context.get("program_owned") or {}).get("dialogue_pairs") or [])
        if isinstance(item, dict) and str(item.get("line") or "").strip()
    }


def _validate_evidence(errors: list[dict[str, Any]], evidence: Any, allowed: set[str], *, path: str) -> None:
    if not isinstance(evidence, list) or not evidence:
        _err(errors, "production_semantics_missing_evidence", f"{path} requires non-empty source_evidence", path=path)
        return
    for index, item in enumerate(evidence):
        ep = f"{path}[{index}]"
        if not isinstance(item, dict) or set(item) != {"quote"} or not isinstance(item.get("quote"), str) or not item.get("quote", "").strip():
            _err(errors, "production_semantics_invalid_evidence", f"{ep} must be object{{quote:string}}", path=ep)
            continue
        quote = item["quote"].strip()
        qnorm = re.sub(r"\s+", "", quote)
        anchored = any(qnorm and qnorm in re.sub(r"\s+", "", anchor) for anchor in allowed)
        if not anchored:
            _err(errors, "production_semantics_unanchored_evidence", f"evidence is outside current Shot authority: {quote}", path=ep)


_NON_VISUAL_ACTION_RE = re.compile(
    r"(?:意识到|想起|回忆起|觉得|认为|希望|害怕|明白|知道|仿佛|似乎|象征|意味着|体现|感到|决定|后悔|相信)"
)


def _looks_non_visual_action(text: str) -> bool:
    return bool(_NON_VISUAL_ACTION_RE.search(text or ""))


_LATIN_RE = re.compile(r"[A-Za-z]")


def _contains_latin_text(value: Any) -> bool:
    return isinstance(value, str) and bool(_LATIN_RE.search(value))


def validate_production_semantics_output(value: Any, context: dict[str, Any]) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    if not isinstance(value, dict):
        return [{"type": "production_semantics_shape_error", "detail": "production semantics must be JSON object"}]

    contract = output_contract()
    canonical_fields = set(contract["canonical_fields"])
    for field in sorted(set(value) - canonical_fields):
        _err(errors, "production_semantics_unknown_field", f"unknown field: {field}", field=field)
    for field in contract["canonical_fields"]:
        if field not in value:
            _err(errors, "production_semantics_missing_field", f"missing field: {field}", field=field)

    shot = context.get("shot") or {}
    assets_context = ((context.get("assets") or {}).get("context") or {})
    expected_context_ref = str(assets_context.get("context_id") or context.get("context_ref") or "")
    if value.get("shot_id") != shot.get("shot_id"):
        _err(errors, "production_semantics_shot_mismatch", "shot_id must match current Shot")
    if str(value.get("context_ref") or "") != expected_context_ref:
        _err(errors, "production_semantics_context_mismatch", "context_ref must match current narrative context")

    allowed_evidence = _evidence_quotes(context)
    allowed_chars = set((context.get("program_owned") or {}).get("allowed_character_refs") or [])
    allowed_props = set((context.get("program_owned") or {}).get("allowed_prop_refs") or [])
    dialogue_lines = _dialogue_lines(context)

    visual_events = value.get("visual_events")
    if not isinstance(visual_events, list):
        _err(errors, "production_semantics_shape_error", "visual_events must be array", path="visual_events")
    else:
        for index, event in enumerate(visual_events):
            p = f"visual_events[{index}]"
            if not isinstance(event, dict):
                _err(errors, "production_semantics_shape_error", f"{p} must be object", path=p)
                continue
            expected_fields = set(contract["visual_event_fields"])
            if set(event) != expected_fields:
                _err(errors, "production_semantics_shape_error", f"{p} fields must equal {sorted(expected_fields)}", path=p)
            action = event.get("action")
            if not isinstance(action, str) or not action.strip():
                _err(errors, "production_semantics_visual_event_invalid", f"{p}.action must be nonempty string", path=f"{p}.action")
            elif _looks_non_visual_action(action):
                _err(errors, "production_semantics_non_visual_event", f"visual event is not directly filmable: {action}", path=f"{p}.action")
            chars = event.get("character_refs")
            props = event.get("prop_refs")
            if not isinstance(chars, list) or not all(isinstance(x, str) for x in chars):
                _err(errors, "production_semantics_shape_error", f"{p}.character_refs must be string array", path=f"{p}.character_refs")
            else:
                for ref in chars:
                    if ref not in allowed_chars:
                        _err(errors, "production_semantics_unknown_character_ref", f"unknown character ref: {ref}", path=f"{p}.character_refs")
            if not isinstance(props, list) or not all(isinstance(x, str) for x in props):
                _err(errors, "production_semantics_shape_error", f"{p}.prop_refs must be string array", path=f"{p}.prop_refs")
            else:
                for ref in props:
                    if ref not in allowed_props:
                        _err(errors, "production_semantics_unknown_prop_ref", f"unknown prop ref: {ref}", path=f"{p}.prop_refs")
            _validate_evidence(errors, event.get("source_evidence"), allowed_evidence, path=f"{p}.source_evidence")
            visual_authority = _visual_action_authority(context)
            if isinstance(action, str) and action.strip() and visual_authority and not text_is_anchored(action, visual_authority):
                _err(
                    errors,
                    "production_semantics_visual_event_not_supported",
                    "visual event action is not sufficiently anchored by the frozen Base Shot visual authority",
                    path=f"{p}.action",
                    authority_path="program_owned.current_shot_visual_authority",
                )

    audio_events = value.get("audio_events")
    if not isinstance(audio_events, list):
        _err(errors, "production_semantics_shape_error", "audio_events must be array", path="audio_events")
    else:
        for index, event in enumerate(audio_events):
            p = f"audio_events[{index}]"
            if not isinstance(event, dict):
                _err(errors, "production_semantics_shape_error", f"{p} must be object", path=p)
                continue
            expected_fields = set(contract["audio_event_fields"])
            if set(event) != expected_fields:
                _err(errors, "production_semantics_shape_error", f"{p} fields must equal {sorted(expected_fields)}", path=p)
            if event.get("audio_type") not in AUDIO_TYPES:
                _err(errors, "production_semantics_audio_type_invalid", f"unsupported audio_type: {event.get('audio_type')}", path=f"{p}.audio_type")
            if event.get("audio_role") not in AUDIO_ROLES:
                _err(errors, "production_semantics_audio_role_invalid", f"unsupported audio_role: {event.get('audio_role')}", path=f"{p}.audio_role")
            if event.get("origin") not in AUDIO_ORIGINS:
                _err(errors, "production_semantics_audio_origin_invalid", f"unsupported audio origin: {event.get('origin')}", path=f"{p}.origin")
            content = event.get("content")
            if not isinstance(content, str) or not content.strip():
                _err(errors, "production_semantics_audio_content_invalid", "audio content must be nonempty", path=f"{p}.content")
            elif content.strip() in dialogue_lines:
                _err(errors, "production_semantics_dialogue_in_audio_event", "frozen Shot dialogue must not be duplicated in audio_events", path=f"{p}.content")
            evidence = event.get("source_evidence")
            if event.get("origin") == "source":
                _validate_evidence(errors, evidence, allowed_evidence, path=f"{p}.source_evidence")
            else:
                if not isinstance(evidence, list):
                    _err(errors, "production_semantics_shape_error", "production-design audio source_evidence must be [] or evidence array", path=f"{p}.source_evidence")
                elif evidence:
                    _validate_evidence(errors, evidence, allowed_evidence, path=f"{p}.source_evidence")
                if isinstance(content, str) and (re.search(r'[“”"‘’]', content) or re.search(r'(?:说|问|回答|告诉|喊道|念出).{1,24}', content)):
                    _err(errors, "production_semantics_audio_design_adds_semantic_speech", "production-design audio may add natural SFX/ambience but not new semantic speech", path=f"{p}.content")
                if isinstance(content, str) and _PRODUCTION_AUDIO_MUSIC_RE.search(content):
                    _err(errors, "production_semantics_audio_design_adds_music", "production-design audio may not add music/BGM; final delivery keeps 配乐：无 unless upstream story authority explicitly requires music", path=f"{p}.content")
                if isinstance(content, str) and _PRODUCTION_AUDIO_SEMANTIC_EVENT_RE.search(content) and not evidence:
                    _err(errors, "production_semantics_audio_design_adds_story_event", "production-design audio may add natural ambience but not a new high-semantic story event sound without source evidence", path=f"{p}.content")

    status = value.get("renderability_status")
    if status not in RENDERABILITY_STATUSES:
        _err(errors, "production_semantics_invalid_renderability", f"unsupported renderability_status: {status}")

    issues = value.get("renderability_issues")
    if not isinstance(issues, list):
        _err(errors, "production_semantics_shape_error", "renderability_issues must be array", path="renderability_issues")
    else:
        for index, issue in enumerate(issues):
            p = f"renderability_issues[{index}]"
            if not isinstance(issue, dict):
                _err(errors, "production_semantics_shape_error", f"{p} must be object", path=p)
                continue
            expected_fields = set(contract["renderability_issue_fields"])
            if set(issue) != expected_fields:
                _err(errors, "production_semantics_shape_error", f"{p} fields must equal {sorted(expected_fields)}", path=p)
            if issue.get("type") not in ISSUE_TYPES:
                _err(errors, "production_semantics_issue_type_invalid", f"unsupported issue type: {issue.get('type')}", path=f"{p}.type")
            if not isinstance(issue.get("detail"), str) or not issue.get("detail", "").strip():
                _err(errors, "production_semantics_issue_detail_invalid", "issue detail must be nonempty", path=f"{p}.detail")
            _validate_evidence(errors, issue.get("source_evidence"), allowed_evidence, path=f"{p}.source_evidence")

    if status == "renderable" and isinstance(issues, list) and issues:
        _err(errors, "production_semantics_renderability_inconsistent", "renderable status requires no renderability_issues")
    if status in {"needs_adaptation", "blocked"} and isinstance(issues, list) and not issues:
        _err(errors, "production_semantics_renderability_inconsistent", f"{status} requires at least one renderability_issue")

    frozen_dialogue = (context.get("program_owned") or {}).get("dialogue_pairs") or []
    dialogue_delivery = value.get("dialogue_delivery")
    delivery_by_index: dict[int, str] = {}
    embedded_quote_indices_by_dialogue: dict[int, list[int]] = {}
    if not isinstance(dialogue_delivery, list):
        _err(errors, "production_semantics_shape_error", "dialogue_delivery must be array", path="dialogue_delivery")
    else:
        seen_delivery_indices: set[int] = set()
        required_delivery_fields = set(contract["dialogue_delivery_required_fields"])
        optional_delivery_fields = set(contract["dialogue_delivery_optional_fields"])
        allowed_delivery_fields = required_delivery_fields | optional_delivery_fields
        for index, item in enumerate(dialogue_delivery):
            p = f"dialogue_delivery[{index}]"
            if not isinstance(item, dict):
                _err(errors, "production_semantics_shape_error", f"{p} must be object", path=p)
                continue
            missing_fields = sorted(required_delivery_fields - set(item))
            extra_fields = sorted(set(item) - allowed_delivery_fields)
            if missing_fields or extra_fields:
                _err(
                    errors,
                    "production_semantics_shape_error",
                    f"{p} requires {sorted(required_delivery_fields)} and only allows optional {sorted(optional_delivery_fields)}",
                    path=p,
                )
            dialogue_index = item.get("dialogue_index")
            mode = item.get("mode")
            if not isinstance(dialogue_index, int) or isinstance(dialogue_index, bool) or not (0 <= dialogue_index < len(frozen_dialogue)):
                _err(errors, "production_semantics_dialogue_delivery_index_invalid", "dialogue_index must reference an existing frozen dialogue item", path=f"{p}.dialogue_index")
                continue
            if dialogue_index in seen_delivery_indices:
                _err(errors, "production_semantics_dialogue_delivery_duplicate", "dialogue_index may be overridden at most once", path=f"{p}.dialogue_index")
                continue
            seen_delivery_indices.add(dialogue_index)
            if mode not in DIALOGUE_DELIVERY_MODES:
                _err(errors, "production_semantics_dialogue_delivery_mode_invalid", f"unsupported delivery mode: {mode}", path=f"{p}.mode")
                continue
            delivery_by_index[dialogue_index] = str(mode)

            quote_indices = item.get("embedded_quote_indices", [])
            if not isinstance(quote_indices, list):
                _err(errors, "production_semantics_embedded_quote_indices_invalid", "embedded_quote_indices must be an array", path=f"{p}.embedded_quote_indices")
                continue
            if any(not isinstance(x, int) or isinstance(x, bool) for x in quote_indices):
                _err(errors, "production_semantics_embedded_quote_indices_invalid", "embedded_quote_indices must contain integer candidate indices", path=f"{p}.embedded_quote_indices")
                continue
            if len(set(quote_indices)) != len(quote_indices):
                _err(errors, "production_semantics_embedded_quote_duplicate", "embedded_quote_indices must not contain duplicates", path=f"{p}.embedded_quote_indices")
                continue
            candidates = frozen_dialogue[dialogue_index].get("embedded_quote_candidates") if isinstance(frozen_dialogue[dialogue_index], dict) else []
            valid_candidate_indices = {
                candidate.get("quote_index")
                for candidate in (candidates or [])
                if isinstance(candidate, dict)
                and isinstance(candidate.get("quote_index"), int)
                and not isinstance(candidate.get("quote_index"), bool)
            }
            unknown_quote_indices = [quote_index for quote_index in quote_indices if quote_index not in valid_candidate_indices]
            if unknown_quote_indices:
                _err(
                    errors,
                    "production_semantics_embedded_quote_index_invalid",
                    "embedded_quote_indices must reference program-owned embedded quote candidates",
                    path=f"{p}.embedded_quote_indices",
                    quote_indices=unknown_quote_indices,
                )
                continue
            if quote_indices and mode != "direct":
                _err(
                    errors,
                    "production_semantics_embedded_quote_mode_invalid",
                    "embedded_quote_indices are only valid inside direct dialogue; whole-item quoted/voiceover uses delivery mode only",
                    path=f"{p}.embedded_quote_indices",
                )
                continue
            embedded_quote_indices_by_dialogue[dialogue_index] = list(quote_indices)

    dialogue = value.get("dialogue")
    if not isinstance(dialogue, list):
        _err(errors, "production_semantics_shape_error", "dialogue must be array", path="dialogue")
    else:
        if len(dialogue) != len(frozen_dialogue):
            _err(errors, "production_semantics_dialogue_mismatch", "dialogue count must match frozen Shot dialogue", path="dialogue")
        for index, item in enumerate(dialogue):
            p = f"dialogue[{index}]"
            if not isinstance(item, dict):
                _err(errors, "production_semantics_shape_error", f"{p} must be object", path=p)
                continue
            expected_fields = set(contract["dialogue_fields"])
            if set(item) != expected_fields:
                _err(errors, "production_semantics_shape_error", f"{p} fields must equal {sorted(expected_fields)}", path=p)
            if not isinstance(item.get("offscreen"), bool):
                _err(errors, "production_semantics_dialogue_offscreen_invalid", "offscreen must be boolean", path=f"{p}.offscreen")
            if item.get("delivery_mode") not in DIALOGUE_DELIVERY_MODES:
                _err(errors, "production_semantics_dialogue_delivery_mode_invalid", f"unsupported delivery mode: {item.get('delivery_mode')}", path=f"{p}.delivery_mode")
            if index < len(frozen_dialogue):
                frozen = frozen_dialogue[index]
                if item.get("character_id") != frozen.get("character_id") or item.get("line") != frozen.get("line"):
                    _err(errors, "production_semantics_dialogue_mismatch", "speaker and line are program-owned frozen dialogue", path=p)
                visible_refs = set((context.get("program_owned") or {}).get("allowed_character_refs") or [])
                expected_offscreen = str(frozen.get("character_id") or "") not in visible_refs
                if isinstance(item.get("offscreen"), bool) and item.get("offscreen") is not expected_offscreen:
                    _err(errors, "production_semantics_dialogue_visibility_mismatch", "offscreen is program-derived from speaker visibility in current Shot", path=f"{p}.offscreen")
                expected_delivery = delivery_by_index.get(index, "direct")
                if item.get("delivery_mode") != expected_delivery:
                    _err(errors, "production_semantics_dialogue_delivery_mismatch", "delivery_mode must match dialogue_delivery decision or default direct", path=f"{p}.delivery_mode")
                candidates = frozen.get("embedded_quote_candidates") if isinstance(frozen, dict) else []
                candidate_by_index = {
                    candidate.get("quote_index"): candidate
                    for candidate in (candidates or [])
                    if isinstance(candidate, dict)
                    and isinstance(candidate.get("quote_index"), int)
                    and not isinstance(candidate.get("quote_index"), bool)
                    and isinstance(candidate.get("text"), str)
                }
                expected_embedded_quotes = [
                    {"text": str(candidate_by_index[quote_index]["text"]), "mode": "quoted"}
                    for quote_index in embedded_quote_indices_by_dialogue.get(index, [])
                    if quote_index in candidate_by_index
                ]
                if item.get("embedded_quotes") != expected_embedded_quotes:
                    _err(
                        errors,
                        "production_semantics_embedded_quotes_mismatch",
                        "embedded_quotes are program-owned exact text derived from selected candidate indices",
                        path=f"{p}.embedded_quotes",
                    )

    current_location_ref = str((context.get("program_owned") or {}).get("current_location_ref") or "")
    diegetic_text = value.get("diegetic_text")
    if not isinstance(diegetic_text, list):
        _err(errors, "production_semantics_shape_error", "diegetic_text must be array", path="diegetic_text")
    else:
        for index, item in enumerate(diegetic_text):
            p = f"diegetic_text[{index}]"
            if not isinstance(item, dict):
                _err(errors, "production_semantics_shape_error", f"{p} must be object", path=p)
                continue
            expected_fields = set(contract["diegetic_text_fields"])
            if set(item) != expected_fields:
                _err(errors, "production_semantics_shape_error", f"{p} fields must equal {sorted(expected_fields)}", path=p)
            content = item.get("content")
            if not isinstance(content, str) or not content.strip():
                _err(errors, "production_semantics_diegetic_text_invalid", "diegetic text content must be nonempty", path=f"{p}.content")
            if item.get("carrier_type") not in TEXT_CARRIER_TYPES:
                _err(errors, "production_semantics_invalid_text_carrier", f"unsupported carrier_type: {item.get('carrier_type')}", path=f"{p}.carrier_type")
            carrier_ref = str(item.get("carrier_ref") or "")
            if item.get("carrier_type") == "prop" and carrier_ref not in allowed_props:
                _err(errors, "production_semantics_invalid_text_carrier", f"prop carrier is outside current Shot: {carrier_ref}", path=f"{p}.carrier_ref")
            if item.get("carrier_type") == "environment" and (not current_location_ref or carrier_ref != current_location_ref):
                _err(errors, "production_semantics_invalid_text_carrier", f"environment carrier must equal current location: {current_location_ref}", path=f"{p}.carrier_ref")
            if not isinstance(item.get("required_visible"), bool):
                _err(errors, "production_semantics_diegetic_text_invalid", "required_visible must be boolean", path=f"{p}.required_visible")
            _validate_evidence(errors, item.get("source_evidence"), allowed_evidence, path=f"{p}.source_evidence")
            if isinstance(content, str) and content.strip():
                anchored_quotes = [
                    ev.get("quote", "") for ev in (item.get("source_evidence") or [])
                    if isinstance(ev, dict) and isinstance(ev.get("quote"), str)
                ]
                if not any(content.strip() in quote for quote in anchored_quotes):
                    _err(errors, "production_semantics_unanchored_diegetic_text", "diegetic text must occur verbatim in its source evidence", path=f"{p}.content")

    choices = value.get("production_choices")
    if not isinstance(choices, list):
        _err(errors, "production_semantics_shape_error", "production_choices must be array", path="production_choices")
    else:
        for index, item in enumerate(choices):
            p = f"production_choices[{index}]"
            if not isinstance(item, dict):
                _err(errors, "production_semantics_shape_error", f"{p} must be object", path=p)
                continue
            expected_fields = set(contract["production_choice_fields"])
            if set(item) != expected_fields:
                _err(errors, "production_semantics_shape_error", f"{p} fields must equal {sorted(expected_fields)}", path=p)
            if item.get("type") not in PRODUCTION_CHOICE_TYPES:
                _err(errors, "production_choice_type_invalid", f"unsupported production choice type: {item.get('type')}", path=f"{p}.type")
            if not isinstance(item.get("choice"), str) or not item.get("choice", "").strip():
                _err(errors, "production_choice_invalid", "choice must be nonempty", path=f"{p}.choice")
            if str(item.get("narrative_context_ref") or "") != expected_context_ref:
                _err(errors, "production_choice_context_mismatch", "production choice must bind current narrative context", path=f"{p}.narrative_context_ref")
            if item.get("impact") != "no_story_change":
                _err(errors, "production_choice_changes_story", "production choice impact must be no_story_change", path=f"{p}.impact")
            if not isinstance(item.get("rationale"), str) or not item.get("rationale", "").strip():
                _err(errors, "production_choice_invalid", "rationale must be nonempty", path=f"{p}.rationale")
            chars = item.get("affected_character_refs")
            props = item.get("affected_prop_refs")
            if not isinstance(chars, list) or not all(isinstance(x, str) for x in chars):
                _err(errors, "production_semantics_shape_error", "affected_character_refs must be string array", path=f"{p}.affected_character_refs")
            else:
                for ref in chars:
                    if ref not in allowed_chars:
                        _err(errors, "production_semantics_unknown_character_ref", f"unknown character ref: {ref}", path=f"{p}.affected_character_refs")
            if not isinstance(props, list) or not all(isinstance(x, str) for x in props):
                _err(errors, "production_semantics_shape_error", "affected_prop_refs must be string array", path=f"{p}.affected_prop_refs")
            else:
                for ref in props:
                    if ref not in allowed_props:
                        _err(errors, "production_semantics_unknown_prop_ref", f"unknown prop ref: {ref}", path=f"{p}.affected_prop_refs")
            story_changes = item.get("story_changes")
            if not isinstance(story_changes, dict) or set(story_changes) != STORY_CHANGE_FIELDS:
                _err(errors, "production_choice_changes_story", f"story_changes fields must equal {sorted(STORY_CHANGE_FIELDS)}", path=f"{p}.story_changes")
            else:
                changed = False
                for field in STORY_CHANGE_FIELDS:
                    values = story_changes.get(field)
                    if not isinstance(values, list):
                        _err(errors, "production_semantics_shape_error", f"{p}.story_changes.{field} must be array", path=f"{p}.story_changes.{field}")
                    elif values:
                        changed = True
                if changed:
                    _err(errors, "production_choice_changes_story", "production choice declares story changes; adaptation authority is no-story-change only", path=f"{p}.story_changes")
            _validate_evidence(errors, item.get("source_evidence"), allowed_evidence, path=f"{p}.source_evidence")

    overlays = value.get("appearance_overlays")
    if not isinstance(overlays, list):
        _err(errors, "production_semantics_shape_error", "appearance_overlays must be array", path="appearance_overlays")
    else:
        for index, item in enumerate(overlays):
            p = f"appearance_overlays[{index}]"
            if not isinstance(item, dict):
                _err(errors, "production_semantics_shape_error", f"{p} must be object", path=p)
                continue
            expected_fields = set(contract["appearance_overlay_fields"])
            if set(item) != expected_fields:
                _err(errors, "production_semantics_shape_error", f"{p} fields must equal {sorted(expected_fields)}", path=p)
            character_ref = str(item.get("character_ref") or "")
            if character_ref not in allowed_chars:
                _err(errors, "appearance_overlay_unknown_character", f"appearance overlay character is outside current Shot: {character_ref}", path=f"{p}.character_ref")
            if str(item.get("narrative_context_ref") or "") != expected_context_ref:
                _err(errors, "appearance_overlay_context_mismatch", "appearance overlay must bind current narrative context", path=f"{p}.narrative_context_ref")
            overrides = item.get("overrides")
            if not isinstance(overrides, dict) or not overrides:
                _err(errors, "appearance_overlay_invalid", "overrides must be a non-empty object", path=f"{p}.overrides")
            else:
                forbidden = sorted(set(overrides) - APPEARANCE_OVERRIDE_KEYS)
                if forbidden:
                    _err(errors, "appearance_overlay_forbidden_key", f"unsupported appearance override key(s): {', '.join(forbidden)}", path=f"{p}.overrides")
                for key, val in overrides.items():
                    if key in APPEARANCE_OVERRIDE_KEYS and (not isinstance(val, str) or not val.strip()):
                        _err(errors, "appearance_overlay_invalid", f"{key} must be nonempty string", path=f"{p}.overrides.{key}")
            _validate_evidence(errors, item.get("source_evidence"), allowed_evidence, path=f"{p}.source_evidence")

    return errors
