"""RecruitRadar MVP AI message generation and sending."""

from __future__ import annotations

import argparse
import json
from typing import Any

from lakejob.infrastructure.ai.provider import get_ai_provider
from lakejob.application.messaging.draft import create_recruiter_message_draft


def build_prompt(candidate: dict[str, Any], requirements: dict[str, Any], message_type: str) -> list[dict[str, str]]:
    content = f"""
Write one short Chinese recruiter message for BOSS.

Rules:
- 1 to 2 sentences.
- Be polite and specific.
- Do not invent candidate experience.
- Message type: {message_type}.

Role requirement:
- Title: {requirements.get("job_title", "")}
- Skills: {requirements.get("skills", "")}
- Location: {requirements.get("regions", "")}

Candidate:
- Name: {candidate.get("name", "")}
- Headline: {candidate.get("headline", "")}
- Title: {candidate.get("current_title", "")}
- Skills: {candidate.get("skills", [])}
- Resume: {(candidate.get("resume_text") or "")[:700]}
""".strip()
    return [
        {"role": "system", "content": "You write concise recruiter outreach messages."},
        {"role": "user", "content": content},
    ]


def _fallback_message(candidate: dict[str, Any], requirements: dict[str, Any], message_type: str) -> str:
    name = candidate.get("name") or "您好"
    title = requirements.get("job_title") or "相关岗位"
    if message_type == "reject":
        return f"{name}，感谢关注，目前这个岗位匹配度暂时不够，后续有合适机会再联系。"
    if message_type == "followup":
        return f"{name}，想再了解一下您对{title}的兴趣和近期机会安排，方便的话可以简单聊聊。"
    return f"{name}，您好，我这边有一个{title}机会，看到您的经历比较匹配，想和您简单沟通一下。"


def generate_recruit_message(
    candidate: dict[str, Any],
    requirements: dict[str, Any],
    *,
    message_type: str = "invite",
) -> str:
    try:
        return get_ai_provider().generate_recruiter_message(
            candidate, {**requirements, "message_type": message_type}
        )[:240]
    except Exception:
        return _fallback_message(candidate, requirements, message_type)


def send_candidate_message(
    candidate_id: str,
    *,
    message_type: str = "invite",
    requirements: dict[str, Any] | None = None,
    job_id: str | None = None,
    account_name: str = "default-recruiter",
) -> dict[str, Any]:
    del account_name, job_id
    profile = {**(requirements or {}), "message_type": message_type}
    draft = create_recruiter_message_draft(candidate_id, profile)
    return {
        "candidate_id": candidate_id,
        "sent": False,
        "draft_only": True,
        "draft_id": draft["draft_id"],
        "message": draft.get("content") or "",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="RecruitRadar MVP send candidate message")
    parser.add_argument("candidate_id")
    parser.add_argument("--message-type", choices=["invite", "followup", "reject"], default="invite")
    parser.add_argument("--job-title", default="")
    parser.add_argument("--skills", default="")
    parser.add_argument("--regions", default="")
    parser.add_argument("--job-id")
    args = parser.parse_args()
    result = send_candidate_message(
        args.candidate_id,
        message_type=args.message_type,
        job_id=args.job_id,
        requirements={"job_title": args.job_title, "skills": args.skills, "regions": args.regions},
    )
    print(json.dumps({"ok": True, "data": result}, ensure_ascii=False, default=str, indent=2))


if __name__ == "__main__":
    main()
