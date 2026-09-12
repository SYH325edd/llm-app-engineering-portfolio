from __future__ import annotations

from dataclasses import dataclass
from typing import Any


ROLE_ORDER = ("commander", "executor", "supervisor", "validator", "auditor")
MINIMUM_SCORE = 95
MAXIMUM_RETRY_COUNT = 3

FIXED_PROHIBITED_ACTIONS = [
    "不得绕过登录、验证码、安全验证或平台风控",
    "不得读取或导出平台账号密码、Cookie、Token 或浏览器密钥",
    "不得使用代理池、账号池、批量刷取或高频自动操作",
    "不得把模拟数据、占位数据或推测结果冒充真实执行结果",
    "不得编造求职者的学历、技能、经历、证书、项目或到岗承诺",
    "不得由 AI 单独完成最终淘汰、正式拒绝、Offer、录用或薪资承诺",
    "不得跳过视觉动作后的结果验证",
    "不得删除或覆盖已锁定结果和审计日志",
]

FIXED_CONSTRAINTS = [
    "五个角色严格串行，同一时间只能激活一个角色",
    "任意审核环节驳回后只返回执行员，不重新运行总指挥",
    "最多自动返工三次，超限后终止并等待人工介入",
    "合验员和终审审计员评分低于95分必须驳回",
    "终审审计员执行独立盲审，不得看到监督员和合验员意见",
    "全部角色仅输出结构化结论，不公开私有推理过程",
    "全部真实平台操作必须低频、前台可见、可暂停、可停止、可审计",
    "遇到 CAPTCHA、SECURITY_CHECK、登录失效或页面状态不明确时必须暂停",
]

VISUAL_ACTION_SEQUENCE = [
    "执行前截图",
    "页面状态识别",
    "目标元素定位",
    "风险判断",
    "执行动作",
    "等待页面变化",
    "执行后截图",
    "结果验证",
    "写入审计日志",
]

SENSITIVE_DECISIONS = {
    "reject_candidate",
    "formal_rejection",
    "offer",
    "hire",
    "salary_commitment",
    "contract_commitment",
    "background_check_conclusion",
}

BLOCKING_PAGE_STATES = {
    "CAPTCHA",
    "SECURITY_CHECK",
    "LOGIN_EXPIRED",
    "UNKNOWN",
}


@dataclass(frozen=True)
class PolicyFinding:
    allowed: bool
    code: str
    message: str


def validate_real_action(action: str, context: dict[str, Any]) -> PolicyFinding:
    """Apply the fixed product safety policy before a real visual action.

    This policy does not try to bypass platform controls. It is deliberately
    conservative: missing evidence or authorization blocks the action.
    """

    page_state = str(context.get("page_state") or "UNKNOWN").upper()
    if page_state in BLOCKING_PAGE_STATES:
        return PolicyFinding(False, "blocked_page_state", f"页面状态 {page_state} 必须人工处理")

    if bool(context.get("verification_present")):
        return PolicyFinding(False, "verification_present", "检测到验证码或安全验证，任务已暂停")

    if action in SENSITIVE_DECISIONS:
        return PolicyFinding(False, "human_approval_required", "该动作属于重大招聘决策，必须人工确认")

    if not bool(context.get("user_authorized")):
        return PolicyFinding(False, "user_authorization_required", "缺少用户明确授权")

    if not bool(context.get("pre_action_evidence")):
        return PolicyFinding(False, "pre_action_evidence_required", "缺少执行前证据")

    if not bool(context.get("target_confirmed")):
        return PolicyFinding(False, "target_confirmation_required", "目标对象未完成二次确认")

    if int(context.get("daily_count") or 0) >= int(context.get("daily_limit") or 0):
        return PolicyFinding(False, "daily_limit_reached", "已达到每日动作上限")

    if bool(context.get("duplicate_target")):
        return PolicyFinding(False, "duplicate_target", "检测到重复对象")

    return PolicyFinding(True, "allowed", "动作通过固定业务规则")
