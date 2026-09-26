from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

_TEMPLATE_ROOT = Path(__file__).resolve().parents[3] / "packages" / "prompt_foundry_v13" / "templates"


def _template(name: str) -> dict[str, Any]:
    return json.loads((_TEMPLATE_ROOT / name).read_text(encoding="utf-8"))


def _sorted_ids(items: list[dict[str, Any]] | None, key: str) -> list[str]:
    return sorted(str(item[key]) for item in (items or []) if item.get(key))


def _scene_plan_manifest(scene_plan: dict[str, Any] | None) -> dict[str, Any]:
    scenes = []
    for scene in (scene_plan or {}).get("scenes", []) or []:
        scenes.append({
            "scene_id": scene.get("scene_id"),
            "location_ref": scene.get("location_ref"),
            "context_ref": scene.get("context_ref") or "",
            "beat_ids": [b.get("beat_id") for b in scene.get("beat_list", []) or [] if b.get("beat_id")],
        })
    return {"scene_plan": scenes}


def reference_manifest(stage: str, artifacts: dict[str, Any]) -> dict[str, Any]:
    manifest: dict[str, Any] = {}
    story = artifacts.get("story_bible") or {}
    if story:
        manifest.update({
            "character_refs": _sorted_ids(story.get("characters"), "character_id"),
            "location_refs": _sorted_ids(story.get("scenes"), "scene_id"),
            "prop_refs": _sorted_ids(story.get("props"), "prop_id"),
            "context_refs": _sorted_ids(story.get("narrative_contexts"), "context_id"),
        })
    if artifacts.get("scene_plan"):
        manifest.update(_scene_plan_manifest(artifacts.get("scene_plan")))
        manifest["scene_ids"] = [s["scene_id"] for s in manifest["scene_plan"] if s.get("scene_id")]
        manifest["beat_ids"] = [bid for s in manifest["scene_plan"] for bid in s.get("beat_ids", [])]
    if artifacts.get("storyboard_base"):
        manifest["shot_ids"] = [
            shot.get("shot_id")
            for scene in artifacts["storyboard_base"].get("scenes", []) or []
            for shot in scene.get("shots", []) or []
            if shot.get("shot_id")
        ]
    return manifest




def output_contract(stage: str) -> dict[str, Any]:
    contracts: dict[str, dict[str, Any]] = {
        "story_bible": {
            "required_top_level_fields": ["bible_id", "project_id", "version", "characters", "scenes", "props", "narrative_contexts"],
            "required_character_fields": ["character_id", "canonical_name", "aliases", "role_type", "explicit_facts", "inferred_facts", "identity_lock", "visual_lock", "source_evidence"],
            "required_scene_fields": ["scene_id", "canonical_name", "name", "time", "weather", "explicit_facts", "visual_lock", "source_evidence"],
            "required_prop_fields": ["prop_id", "canonical_name", "name", "aliases", "narrative_importance", "visual_presence", "visual_asset_required", "explicit_facts", "source_evidence"],
            "empty_value_policy": "keep required fields; use [], {}, or empty string instead of omitting them",
            "container_types": {
                "characters": "array<object>", "scenes": "array<object>", "props": "array<object>", "narrative_contexts": "array<object>",
                "character.aliases": "array", "character.explicit_facts": "array", "character.inferred_facts": "array",
                "character.identity_lock": "object", "character.visual_lock": "object", "character.source_evidence": "array<object>",
                "scene.explicit_facts": "array", "scene.visual_lock": "object", "scene.source_evidence": "array<object>",
                "prop.aliases": "array", "prop.explicit_facts": "array", "prop.source_evidence": "array<object>"
            },
        },
        "scene_plan": {
            "required_top_level_fields": ["scenes"],
            "required_scene_fields": ["scene_id", "context_ref", "location_ref", "time", "character_refs", "prop_refs", "continuous_with_previous", "dramatic_goal", "conflict", "turning_point", "beat_list"],
            "required_beat_fields": ["beat_id", "description", "type"],
            "context_ref_rule": "exactly one allowed context_ref or empty string",
            "id_rule": "scene_id and beat_id are globally unique; beat_id never resets per scene",
            "empty_value_policy": "keep every required field; use [], {}, false, or empty string instead of omitting it",
            "container_types": {
                "scenes": "array<object>", "scene.character_refs": "array<string>", "scene.prop_refs": "array<string>", "scene.beat_list": "array<object>"
            },
        },
        "script": {
            "required_top_level_fields": ["scenes"],
            "required_scene_fields": ["scene_id", "context_ref", "location_ref", "scene_heading", "scene_description", "beats"],
            "required_beat_fields": ["beat_id", "description", "dialogue"],
            "required_dialogue_fields": ["character_id", "line"],
            "copy_rule": "scene_id/location_ref/context_ref/beat_id must exactly copy Scene Plan",
            "container_types": {
                "scenes": "array<object>", "scene.beats": "array<object>", "beat.dialogue": "array<object>"
            },
        },
        "storyboard_base": {
            "required_top_level_fields": ["scenes"],
            "required_scene_fields": ["scene_id", "context_ref", "location_ref", "shots"],
            "required_shot_fields": ["shot_id", "scene_id", "beat_id", "character_refs", "prop_refs", "shot_size", "camera", "movement", "composition", "duration", "description", "dialogue", "continuity", "source_evidence"],
            "forbidden_fields_anywhere": ["director", "state_in", "image_prompt", "video_prompt", "platform_prompt"],
            "container_types": {
                "scenes": "array<object>", "scene.shots": "array<object>", "shot.character_refs": "array<string>",
                "shot.prop_refs": "array<string>", "shot.dialogue": "array<object>", "shot.source_evidence": "array<object>", "shot.continuity": "object"
            },
        },
        "director": {
            "required_top_level_fields": ["scenes"],
            "base_storyboard_rule": "all non-director fields must remain byte-for-byte semantically unchanged",
            "required_director_fields": ["dramatic_intent", "primary_subject_refs", "speaker_target_refs", "reaction_target_refs", "performance_actions", "visual_focus", "action_delta", "state_out", "continuity_scope"],
            "required_performance_action_fields": ["character_ref", "action", "transformation_type", "dependency_tags", "source_evidence"],
            "required_visual_focus_fields": ["focus_type", "subject_refs", "body_regions", "prop_refs", "environment_keys"],
            "container_types": {
                "scenes": "array<object>",
                "scene.shots": "array<object>",
                "shot.director": "object",
                "director.primary_subject_refs": "array<string>",
                "director.speaker_target_refs": "array<string>",
                "director.reaction_target_refs": "array<string>",
                "director.performance_actions": "array<object>",
                "performance_action.dependency_tags": "array<string>",
                "performance_action.source_evidence": "array<object>",
                "director.visual_focus": "object",
                "visual_focus.subject_refs": "array<string>",
                "visual_focus.body_regions": "object map<string,array<string>>",
                "visual_focus.prop_refs": "array<string>",
                "visual_focus.environment_keys": "array<string>",
                "director.action_delta": "object {characters: object, props: object, environment: object}",
                "director.state_out": "object {characters: object, props: object, environment: object}",
                "director.continuity_scope": "object",
                "continuity_scope.inherit.characters": "object map<string,array<string>>",
                "continuity_scope.inherit.props": "object map<string,array<string>>",
                "continuity_scope.inherit.environment": "array<string>"
            },
            "forbidden_fields_anywhere": ["state_in", "image_prompt", "video_prompt", "platform_prompt"],
        },
        "pvb": {
            "required_top_level_fields": ["characters"],
            "required_character_fields": ["character_id", "visual_identity", "wardrobe", "status", "version"],
            "required_visual_identity_fields": ["age_appearance", "face", "hair", "body", "skin"],
            "required_wardrobe_fields": ["default", "outerwear", "shirt", "footwear", "accessory"],
            "required_leaf_fields": ["value", "source", "status"],
            "container_types": {
                "characters": "array<object>", "character.visual_identity": "object", "character.wardrobe": "object",
                "visual_identity.*": "object", "wardrobe.*": "object"
            },
        },
        "psb": {
            "required_top_level_fields": ["scenes"],
            "required_scene_fields": ["scene_id", "production_visual", "status", "version"],
            "required_production_visual_fields": ["space", "layout", "materials", "lighting", "color", "environment"],
            "required_leaf_fields": ["value", "source", "status"],
            "container_types": {
                "scenes": "array<object>", "scene.production_visual": "object", "production_visual.*": "object"
            },
        },
        "style_guide": {
            "required_top_level_fields": ["era", "region", "genre", "tone", "visual_reference"],
            "required_leaf_fields": ["value", "source", "status"],
            "extra_top_level_fields_allowed": False,
            "container_types": {
                "era": "object", "region": "object", "genre": "object", "tone": "object", "visual_reference": "object"
            },
        },
    }
    return contracts[stage]


def _strict_json_suffix(stage: str) -> str:
    required = ", ".join(output_contract(stage)["required_top_level_fields"])
    return (
        "\n\nJSON 输出硬约束：\n"
        f"- 必须输出顶层字段：{required}。不得缺失任何必填字段。\n"
        "- 字段即使为空也必须保留，按契约使用空字符串、空数组、空对象或 false；禁止擅自省略。\n"
        "- 只输出一个 JSON object；不要 markdown、不要解释、不要前后缀文本。\n"
        "- user payload 中的 output_contract 与 output_template 是硬约束，不是示例建议。"
    )


def story_bible_prompt() -> str:
    return """你是 Prompt Foundry v1.3 的 Story Bible Extractor。只从小说原文抽取可验证叙事事实，不做生产设计。\n\n规则：\n1. characters/scenes/props/narrative_contexts 只能来自原文。\n2. 场景必须是可拍摄物理地点；叙事时间/现实层变化用 narrative_contexts 表达。\n3. explicit_facts 只放原文明示；inferred_facts 只放必要且低风险的推断。\n4. visual_lock 只保存原文明示的稳定视觉事实，不补齐缺失视觉信息。\n5. role_type 只用 main/supporting/background/referenced_only。\n6. 所有 source_evidence.quote 必须能逐字对应原文。\n7. 使用稳定 ID：char_001 / scene_001 / prop_001 / context_001；每一类 ID 在整个项目内必须唯一、顺序递增，不得重复。\n8. narrative_contexts 若为空就输出 []；若存在，每个 context_id 必须唯一。\n9. 必须按 output_contract 输出完整字段结构。""" + _strict_json_suffix("story_bible")


def scene_plan_prompt() -> str:
    return """你是 Prompt Foundry v1.3 的 Scene Planner。输入 Story Bible 与原文，将故事规划成 Scene 与 Beat，不生成镜头。\n\n规则：\n1. 只能使用 reference_manifest 中列出的稳定 ID；禁止自行创造 character/location/prop/context 引用。\n2. scene_id 使用 SC001、SC002…，在全项目唯一且顺序递增。\n3. location_ref 必须精确等于一个 Story Bible scene_XXX。\n4. context_ref 只能是一个 context_XXX 字符串或空字符串，绝不能把多个 context 用逗号、斜杠、数组或自然语言拼进一个字段。若一段剧情跨越多个 narrative context，必须按 context 边界拆成多个 Scene，每个 Scene 只保留一个 context_ref；没有 context 则为空字符串。\n5. beat_id 使用 B001、B002…，在全项目唯一且按故事顺序持续递增；不得在新 Scene 中从 B001 重新开始。\n6. 一个 beat 是一个可拍摄戏剧单元，不是单个动作；保持原文顺序。\n7. continuous_with_previous 只表示时间/空间连续。\n8. 不新增剧情、对白、地点、人物、道具或情绪结论。\n9. character_refs / prop_refs 只能从 reference_manifest 精确复制。\n10. 必须输出顶层字段 scenes；每个 Scene 必须输出 scene_id/context_ref/location_ref/time/character_refs/prop_refs/continuous_with_previous/dramatic_goal/conflict/turning_point/beat_list；每个 Beat 必须输出 beat_id/description/type。""" + _strict_json_suffix("scene_plan")


def script_prompt() -> str:
    return """你是 Prompt Foundry v1.3 的 Script Writer。把 Scene Plan 忠实转换为结构化剧本。\n\n规则：\n1. 原文对白逐字保留，不改写、不新增、不遗漏。\n2. 动作描述只写原文支持内容，不推断心理。\n3. scene_id/location_ref/context_ref/beat_id 必须逐值复制 Scene Plan，禁止创建新 ID、删除 ID、重编号或每场重置。\n4. Script 的 Scene 集合必须与 Scene Plan 完全一致；每个 Scene 的 Beat 集合也必须完全一致，不能多也不能少。\n5. background 角色不得获得原文没有的对白；dialogue.character_id 只能来自 reference_manifest.character_refs。\n6. 每个 Beat 必须有对应 script beat。\n7. 必须按 output_contract 输出完整字段结构。""" + _strict_json_suffix("script")


def storyboard_base_prompt() -> str:
    return """你是 Prompt Foundry v1.3 的 Storyboard Base Planner。把已校验 Script 拆为可执行镜头，但不做 Director Execution。\n\n规则：\n1. 每个 Beat 至少一个 Shot；可拆分但不得跨 Beat 合并，顺序不变。\n2. scene_id/location_ref/context_ref/beat_id 必须来自 reference_manifest 与 Script；禁止创建未知引用。\n3. shot_id 使用 SH001、SH002…，在全项目唯一且顺序递增；不得在新 Scene 中从 SH001 重新开始。\n4. 对白必须逐字来自 Script Beat，并保留 character_id；同一个 Beat 的全部 Script 对白必须在该 Beat 的所有 Shots 中按原顺序恰好重建一次，禁止遗漏、重复、改写或换 speaker。\n5. 每镜 duration <= 15 秒；movement 只能一个主运镜。\n6. description 只描述原文/剧本支持的可见事件。\n7. 不生成 director、state_in、image_prompt、video_prompt、platform_prompt。\n8. shot_size/camera/movement 使用冻结枚举。\n9. 必须按 output_contract 输出完整字段结构。""" + _strict_json_suffix("storyboard_base")


def director_prompt() -> str:
    return """你是 Prompt Foundry v1.3 的影视分镜导演执行层。你只做导演执行决策，不创建新的叙事事实。你只拥有每个 Shot 的 director 字段；scene_id/shot_id/beat_id/character_refs/prop_refs/dialogue/镜头基础字段均由程序以 Base Storyboard 为权威，禁止修改。
所有角色、场景、道具、Scene、Beat、Shot 引用只能使用 reference_manifest 和 Base Storyboard 中既有稳定 ID。
必须保持 Base Storyboard 除 director 外的所有字段逐值不变。
每个镜头必须输出 director：dramatic_intent、primary_subject_refs、speaker_target_refs、reaction_target_refs、performance_actions、visual_focus、action_delta、state_out、continuity_scope。
state_in 由程序计算，禁止输出。
performance_actions 只能把原文已支持的动作做最小物理展开、可见状态表达或时间顺序显式化；禁止新增情绪结论、速度/力度判断、表情、身体反应或新动作。
不得生成 image_prompt、video_prompt 或 platform_prompt。

performance_actions.transformation_type 只能是 physical_sequence_expansion / visible_state_expression / temporal_order_expansion。
dependency_tags 只能是 face, eyes, mouth, head, neck, upper_body, lower_body, hands, feet, wardrobe_interaction, prop_interaction, spatial_interaction, body_detail。
visual_focus.focus_type 只能是 character, body_region, prop, spatial_relation, environment, reaction。
continuity_scope.mode 只能是 reset, inherit, partial。
state_out 只保存下一镜需要继承的动态状态，不复制 hair/face/skin/wardrobe/lighting/materials/layout/color 等静态资产。

跨字段语义约束是硬约束：
- speaker_target_refs 必须精确等于当前 Shot 对白 speaker 的角色 ID 集合；没有对白则必须是 []。不要把“听话的人”填入 speaker_target_refs。
- primary_subject_refs 只能来自当前 Shot 的 character_refs，绝不能放 prop_XXX、scene_XXX 或其他类型 ID；道具主体请使用 visual_focus.prop_refs 表达。
- reaction_target_refs 只能来自当前 Shot 的 character_refs；reaction_target_refs 中每个角色都必须有同角色 performance_action。若没有可见反应动作，就不要把该角色放进 reaction_target_refs。
- performance_actions.character_ref 只能来自当前 Shot 的 character_refs。
- visual_focus.subject_refs/body_regions 的角色只能来自当前 Shot 的 character_refs；visual_focus.prop_refs 只能来自当前 Shot 的 prop_refs。
- user payload 中的 director_shot_constraints 给出了每镜精确允许值，必须逐镜遵守。

JSON 容器类型是硬约束：
- performance_actions 必须是 JSON array，数组中的每一项必须是 JSON object，绝不能输出字符串数组或嵌套数组。
- visual_focus 必须是 JSON object；visual_focus.body_regions 必须是 JSON object 映射，例如 {\"char_001\":[\"hands\"]}，没有内容时必须输出 {}，绝不能输出 []。
- action_delta 与 state_out 必须都是 JSON object，并且都必须完整包含 characters/props/environment 三个 JSON object；没有变化时对应值用 {}。
- continuity_scope 必须是 JSON object。mode=partial 时 inherit 也必须是 JSON object；inherit.characters 与 inherit.props 必须是 JSON object 映射，inherit.environment 必须是 JSON array。
- primary_subject_refs / speaker_target_refs / reaction_target_refs / dependency_tags / subject_refs / prop_refs / environment_keys 必须是 JSON array。
- 任何声明为 JSON object 的字段都不得用 [] 代替；任何声明为 JSON array 的字段都不得用 {} 代替。
必须按 output_contract 和 output_template 输出完整 Storyboard JSON。""" + _strict_json_suffix("director")

def pvb_prompt() -> str:
    return """你是 Prompt Foundry v1.3 的 Production Visual Bible Generator。只为 role_type=main/supporting 的角色补充 Story Bible 未规定但视觉生产必须具备的角色视觉设计。\n\n规则：\n1. character_id 必须精确来自 reference_manifest.character_refs，不得生成未知角色。\n2. canonical 字段固定为 visual_identity.age_appearance/face/hair/body/skin 与 wardrobe.default/outerwear/shirt/footwear/accessory。\n3. Story Bible visual_lock 已有同名事实 → status=skipped，value/source 为空。\n4. 其余生产设计 → status=candidate, source=production_design。\n5. wardrobe.accessory 如无固定配饰生产需求 → status=optional_absent，value/source 为空；禁止“无明显配饰”等伪内容。\n6. 不输出 biography、关系、心理、剧情、动作。\n7. 只生成 main/supporting；不为 background/referenced_only 建演员级 PVB。\n8. 必须按 output_contract 输出完整字段结构。""" + _strict_json_suffix("pvb")


def psb_prompt() -> str:
    return """你是 Prompt Foundry v1.3 的 Production Scene Bible Generator。只为 Story Bible 的每个物理场景补充视觉生产设计。\n\n规则：\n1. scene_id 必须精确覆盖 reference_manifest.location_refs：每个物理场景一次，不得缺失、重复或新增。\n2. canonical 字段固定为 space/layout/materials/lighting/color/environment。\n3. Story Bible visual_lock 已拥有同名 canonical 字段时，对应 PSB 字段必须 status=skipped 且 value/source 为空；否则输出 candidate + production_design。\n4. 不得新增人物、剧情事件、剧情关键道具或改变原作空间事实。\n5. 必须按 output_contract 输出完整字段结构。""" + _strict_json_suffix("psb")


def style_guide_prompt() -> str:
    return """你是 Prompt Foundry v1.3 的全局 Style Guide Generator。根据整篇故事生成真正全局的 era/region/genre/tone/visual_reference 五项候选生产风格。\n不得把单场天气、单场光线、单个道具或局部剧情事实写成全局风格。\n五个 canonical 字段必须全部存在，每项输出 value/source=production_design/status=candidate；不得新增其他顶层风格字段。必须按 output_contract 输出完整字段结构。""" + _strict_json_suffix("style_guide")


def validation_repair_prompt(stage: str) -> str:
    return f"""你正在修复 Prompt Foundry v1.3 的 {stage} 阶段结构输出。
这不是重新创作。只允许修复 validation_errors 指出的结构、ID、引用、枚举、缺失/重复项。
必须遵守 authoritative_input 与 reference_manifest；不得新增剧情事实、对白、角色、地点、道具、心理或视觉设定。
不得为了消除错误而删除原本应保留的剧情内容。
如果错误涉及 ID：优先修复为全项目唯一、顺序稳定的 ID，并同步该阶段内部相关引用。
如果错误涉及 context_ref：一个 Scene 只能是一个 context ID 或空字符串；多个 context 必须按原文/context 边界拆 Scene，禁止拼接。
如果错误涉及下游复制关系：以 authoritative_input 中上一阶段的数据为唯一真值。
如果 validation_errors.type 以 shape_ 开头：只修正对应字段的 JSON 容器类型（object/array/string），保留原有语义内容和引用；绝不能通过删除整镜、整场或剧情内容来规避 shape 错误。
如果 stage=director：必须逐镜读取 authoritative_input.director_shot_constraints。speaker_target_mismatch 时直接复制 required_speaker_target_refs；invalid_primary_subject_ref 时 primary_subject_refs 只允许角色；若 invalid_ref 属于 allowed_prop_refs，只从 primary_subject_refs 删除该 prop，并保持既有合法 visual_target.prop_refs / visual_focus.prop_refs 不变；不得用 prop 替代角色；reaction_target_without_performance 时只有两种合法修复：若原文/Shot 已支持该角色的可见反应，则补充同角色且有 source_evidence 的 performance_action，否则从 reaction_target_refs 删除该角色；禁止凭空新增表演。
返回完整修复后的 JSON 对象，不要 markdown，不要解释。"""

def _director_output_template(base_storyboard: dict[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(base_storyboard)
    for scene in out.get("scenes", []) or []:
        for shot in scene.get("shots", []) or []:
            shot["director"] = {
                "dramatic_intent": "",
                "primary_subject_refs": [],
                "speaker_target_refs": [],
                "reaction_target_refs": [],
                "performance_actions": [],
                "visual_focus": {
                    "focus_type": "",
                    "subject_refs": [],
                    "body_regions": {},
                    "prop_refs": [],
                    "environment_keys": [],
                },
                "action_delta": {"characters": {}, "props": {}, "environment": {}},
                "state_out": {"characters": {}, "props": {}, "environment": {}},
                "continuity_scope": {"mode": "reset"},
            }
    return out



def _director_shot_constraints(base_storyboard: dict[str, Any]) -> list[dict[str, Any]]:
    constraints: list[dict[str, Any]] = []
    for scene in base_storyboard.get("scenes", []) or []:
        for shot in scene.get("shots", []) or []:
            speakers: list[str] = []
            seen: set[str] = set()
            for item in shot.get("dialogue", []) or []:
                if not isinstance(item, dict):
                    continue
                ref = item.get("character_id")
                if ref and ref not in seen:
                    seen.add(ref)
                    speakers.append(ref)
            constraints.append({
                "shot_id": shot.get("shot_id"),
                "allowed_character_refs": list(shot.get("character_refs", []) or []),
                "allowed_prop_refs": list(shot.get("prop_refs", []) or []),
                "required_speaker_target_refs": speakers,
                "reaction_rule": "reaction_target_refs must be a subset of allowed_character_refs and every reaction target must have a same-character performance_action",
                "primary_subject_rule": "primary_subject_refs must be a subset of allowed_character_refs; props belong in visual_focus.prop_refs",
            })
    return constraints


def stage_payload(stage: str, *, source_text: str, artifacts: dict[str, Any]) -> dict[str, Any]:
    manifest = reference_manifest(stage, artifacts)
    contract = output_contract(stage)
    if stage == "story_bible":
        return {"source_text": source_text, "output_template": _template("story_bible.template.json"), "output_contract": contract, "id_policy": "IDs unique within each category and sequential"}
    if stage == "scene_plan":
        return {"source_text": source_text, "story_bible": artifacts["story_bible"], "reference_manifest": manifest, "output_template": _template("scene_plan.template.json"), "output_contract": contract}
    if stage == "script":
        return {"source_text": source_text, "story_bible": artifacts["story_bible"], "scene_plan": artifacts["scene_plan"], "reference_manifest": manifest, "output_template": _template("script.template.json"), "output_contract": contract}
    if stage == "storyboard_base":
        base_template = _template("storyboard_base.template.json")
        for scene in base_template.get("scenes", []):
            for shot in scene.get("shots", []):
                shot.pop("director", None)
        return {"story_bible": artifacts["story_bible"], "scene_plan": artifacts["scene_plan"], "script": artifacts["script"], "reference_manifest": manifest, "output_template": base_template, "output_contract": contract}
    if stage == "director":
        return {
            "source_text": source_text,
            "story_bible": artifacts["story_bible"],
            "script": artifacts["script"],
            "base_storyboard": artifacts["storyboard_base"],
            "reference_manifest": manifest,
            "director_shot_constraints": _director_shot_constraints(artifacts["storyboard_base"]),
            "output_template": _director_output_template(artifacts["storyboard_base"]),
            "output_contract": contract,
        }
    if stage == "pvb":
        return {"story_bible": artifacts["story_bible"], "reference_manifest": manifest, "output_template": _template("pvb.template.json"), "output_contract": contract}
    if stage == "psb":
        return {"story_bible": artifacts["story_bible"], "reference_manifest": manifest, "output_template": _template("psb.template.json"), "output_contract": contract}
    if stage == "style_guide":
        return {"source_text": source_text, "story_bible": artifacts["story_bible"], "reference_manifest": manifest, "output_template": _template("style_guide.template.json"), "output_contract": contract}
    raise KeyError(stage)


def repair_payload(stage: str, *, source_text: str, artifacts: dict[str, Any], invalid_output: dict[str, Any], validation_errors: list[dict[str, Any]]) -> dict[str, Any]:
    authoritative = stage_payload(stage, source_text=source_text, artifacts=artifacts)
    return {
        "authoritative_input": authoritative,
        "reference_manifest": authoritative.get("reference_manifest", reference_manifest(stage, artifacts)),
        "invalid_output": invalid_output,
        "validation_errors": validation_errors,
        "repair_scope": "structure_and_references_only",
    }


STAGE_SYSTEM_PROMPTS = {
    "story_bible": story_bible_prompt,
    "scene_plan": scene_plan_prompt,
    "script": script_prompt,
    "storyboard_base": storyboard_base_prompt,
    "director": director_prompt,
    "pvb": pvb_prompt,
    "psb": psb_prompt,
    "style_guide": style_guide_prompt,
}
