from __future__ import annotations

import copy
from typing import Any

from app.prompts import STAGE_SYSTEM_PROMPTS, stage_payload
from .stages.story_bible import SYSTEM_PROMPT as STORY_BIBLE_SYSTEM_PROMPT, build_story_bible_payload
from .stages.scene_plan import SYSTEM_PROMPT as SCENE_PLAN_SYSTEM_PROMPT, build_scene_plan_payload
from .stages.script import SYSTEM_PROMPT as SCRIPT_SCENE_SYSTEM_V3, build_script_scene_payload
from .stages.storyboard import SYSTEM_PROMPT as STORYBOARD_SCENE_SYSTEM_V3, build_storyboard_scene_payload
from .stages.pvb import SYSTEM_PROMPT as PVB_CHARACTER_SYSTEM_V3
from .stages.psb import SYSTEM_PROMPT as PSB_SCENE_SYSTEM_V3
from .stages.style_guide import SYSTEM_PROMPT as STYLE_GUIDE_SYSTEM_V2
from .stages.director import SYSTEM_PROMPT as DIRECTOR_SHOT_SYSTEM_V3, build_director_shot_payload
from .stages.production_semantics import SYSTEM_PROMPT as PRODUCTION_SEMANTICS_SYSTEM_V1A
from .storyboard_redistribution import FRAGMENT_SYSTEM_PROMPT as STORYBOARD_REDISTRIBUTION_FRAGMENT_SYSTEM


def whole_stage_payload(
    stage: str,
    source_text: str,
    artifacts: dict[str, Any],
    unit_id: str,
    *,
    source_index: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    # Hash/checkpoint inputs must contain authoritative upstream data only.
    # Never let a stage's previous output leak back into its own retry payload.
    if stage == "story_bible":
        return build_story_bible_payload(source_text, unit_id=unit_id, source_index=source_index)
    if stage == "scene_plan":
        return build_scene_plan_payload(source_text, copy.deepcopy(artifacts.get("story_bible") or {}), unit_id=unit_id, source_index=source_index)
    scoped_artifacts = copy.deepcopy(artifacts)
    payload = stage_payload(stage, source_text=source_text, artifacts=scoped_artifacts)
    payload["unit_id"] = unit_id
    return payload



def system_prompt(stage: str) -> str:
    if stage == "story_bible":
        return STORY_BIBLE_SYSTEM_PROMPT
    if stage == "scene_plan":
        return SCENE_PLAN_SYSTEM_PROMPT
    if stage == "script_scene":
        return SCRIPT_SCENE_SYSTEM_V3
    if stage == "storyboard_scene":
        return STORYBOARD_SCENE_SYSTEM_V3
    if stage == "storyboard_redistribution_fragment":
        return STORYBOARD_REDISTRIBUTION_FRAGMENT_SYSTEM
    if stage == "style_guide":
        return STYLE_GUIDE_SYSTEM_V2
    if stage == "production_semantics_shot":
        return PRODUCTION_SEMANTICS_SYSTEM_V1A
    if stage == "director_scene_context":
        from .stages.director_scene_context import SYSTEM_PROMPT as DIRECTOR_SCENE_CONTEXT_SYSTEM
        return DIRECTOR_SCENE_CONTEXT_SYSTEM
    if stage in STAGE_SYSTEM_PROMPTS:
        return STAGE_SYSTEM_PROMPTS[stage]()
    return {
        "director_shot": DIRECTOR_SHOT_SYSTEM_V3,
        "pvb_character": PVB_CHARACTER_SYSTEM_V3,
        "psb_scene": PSB_SCENE_SYSTEM_V3,
    }[stage]

def model_system_prompt(stage: str, *, repair: bool = False) -> str:
    """Return the provider prompt for one call.

    Canonical stage prompts retain repair guidance for documentation and repair calls.
    Normal calls omit repair-only text so high-fanout stages do not repay that token
    cost on every shot. Core hard/soft business rules remain unchanged.
    """
    prompt = system_prompt(stage)
    if repair:
        return prompt
    out: list[str] = []
    skip_storyboard_repair = False
    for raw in prompt.splitlines():
        line = raw.strip()
        if stage == "storyboard_scene" and line == "质量告警与 Repair（修复）规则：":
            skip_storyboard_repair = True
            continue
        if skip_storyboard_repair:
            if line.startswith("- 首次生成时"):
                out.append(raw)
                continue
            if line == "禁止字段：":
                skip_storyboard_repair = False
                out.append(raw)
            continue
        if line.startswith("如果 user payload 含 repair_instruction"):
            continue
        if line.startswith("若 validation_errors") or line.startswith("若 repair_instruction"):
            continue
        # A few Director rules contain a normal hard rule followed by an inline
        # repair recipe. Keep the rule and drop only the repair suffix.
        if "若 validation_errors" in raw:
            prefix = raw.split("若 validation_errors", 1)[0].rstrip()
            if prefix:
                out.append(prefix)
            continue
        out.append(raw)
    return "\n".join(out).strip()

