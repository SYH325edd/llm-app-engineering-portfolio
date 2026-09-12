from __future__ import annotations

from textwrap import dedent

from .business_rules import FIXED_CONSTRAINTS, FIXED_PROHIBITED_ACTIONS, ROLE_ORDER


PROMPT_FORMAT_VERSION = "lakejob-serial-role-format/1.0"


ROLE_VISIBILITY = {
    "commander": ["final_objective", "task_request", "fixed_rules"],
    "executor": ["task_manifest", "payload", "current_rework_order", "fixed_rules"],
    "supervisor": ["task_manifest", "executor_output", "fixed_rules"],
    "validator": ["task_manifest", "executor_output", "evidence", "fixed_rules"],
    "auditor": ["final_objective", "acceptance_criteria", "executor_output", "evidence", "fixed_rules"],
}


ROLE_FORBIDDEN_CONTEXT = {
    "commander": ["executor_output", "supervisor_output", "validator_output", "auditor_output"],
    "executor": ["auditor_private_context"],
    "supervisor": ["validator_output", "auditor_output"],
    "validator": ["auditor_output"],
    "auditor": ["supervisor_output", "validator_output", "rework_history", "previous_audits"],
}


def fixed_prompt_header(role: str) -> str:
    if role not in ROLE_ORDER:
        raise ValueError(f"unknown role: {role}")
    constraints = "\n".join(f"- {item}" for item in FIXED_CONSTRAINTS)
    prohibited = "\n".join(f"- {item}" for item in FIXED_PROHIBITED_ACTIONS)
    return dedent(
        f"""
        LakeJob 五角色串行闭环作业协议
        Prompt Format: {PROMPT_FORMAT_VERSION}
        当前角色: {role}

        固定约束：
        {constraints}

        禁止事项：
        {prohibited}

        输出要求：
        - 仅输出该角色对应的结构化 JSON 对象。
        - 不输出私有推理过程、思维链或角色间讨论。
        - 不修改最终目标、验收标准和固定业务规则。
        - 不执行当前角色权限之外的工作。
        """
    ).strip()
