"""Map BOSS raw data into LakeJob Core-shaped dictionaries."""

from __future__ import annotations

from typing import Any


def boss_job_to_core(job: dict[str, Any]) -> dict[str, Any]:
    url = job.get("url") or job.get("source_url") or ""
    external_id = job.get("external_job_id") or job.get("platform_job_id") or url
    company = job.get("company") or job.get("company_name") or ""
    salary = job.get("salary") or job.get("salary_text") or ""
    experience = job.get("experience") or job.get("experience_text") or ""
    education = job.get("education") or job.get("education_text") or ""
    return {
        "platform_job_id": job.get("platform_job_id") or external_id,
        "external_job_id": external_id,
        "source_url": url,
        "title": job.get("title") or "Untitled Job",
        "company": company,
        "company_name": company,
        "salary": salary,
        "salary_text": salary,
        "city": job.get("city") or "",
        "experience": experience,
        "experience_text": experience,
        "education": education,
        "education_text": education,
        "description": job.get("description") or "",
        "status": "active",
        "raw_payload": job.get("raw_payload") or job.get("raw_data") or job,
        "raw_data": job,
        "vision_locator": job.get("vision_locator") or (job.get("raw_data") or {}).get("vision_locator"),
        "details_confirmed_at": job.get("details_confirmed_at"),
        "confirmation_evidence": job.get("confirmation_evidence") or {},
        "can_real_apply": bool(job.get("can_real_apply", False)),
        "reason_if_not_actionable": job.get("reason_if_not_actionable") or "details_not_confirmed",
    }


def boss_candidate_to_core(candidate: dict[str, Any]) -> dict[str, Any]:
    url = candidate.get("url") or candidate.get("source_url") or ""
    name = candidate.get("name") or candidate.get("candidate_name") or "Unknown Candidate"
    skills = candidate.get("skills")
    if isinstance(skills, str):
        skills = [item.strip() for item in skills.replace("，", ",").split(",") if item.strip()]
    return {
        "external_candidate_id": candidate.get("external_candidate_id") or url or name,
        "source_url": url,
        "name": name,
        "headline": candidate.get("headline") or candidate.get("summary"),
        "current_company": candidate.get("current_company") or candidate.get("company"),
        "current_title": candidate.get("current_title") or candidate.get("title"),
        "city": candidate.get("city"),
        "location": candidate.get("location") or candidate.get("city"),
        "experience_text": candidate.get("experience") or candidate.get("experience_text"),
        "education_text": candidate.get("education") or candidate.get("education_text"),
        "skills": skills,
        "resume_text": candidate.get("resume_text") or candidate.get("description"),
        "status": "active",
        "raw_data": candidate,
        "vision_locator": candidate.get("vision_locator") or (candidate.get("raw_data") or {}).get("vision_locator"),
        "details_confirmed_at": candidate.get("details_confirmed_at"),
        "confirmation_evidence": candidate.get("confirmation_evidence") or {},
        "can_real_message": bool(candidate.get("can_real_message", False)),
        "reason_if_not_actionable": candidate.get("reason_if_not_actionable") or "details_not_confirmed",
    }


def boss_conversation_to_core(conversation: dict[str, Any]) -> dict[str, Any]:
    return {
        "external_conversation_id": conversation.get("id") or conversation.get("external_conversation_id"),
        "subject_type": "general",
        "counterparty_name": conversation.get("hr_name") or conversation.get("name") or "",
        "counterparty_role": "hr",
        "last_message_preview": conversation.get("last_message_text") or conversation.get("text") or "",
        "unread_count": int(conversation.get("unread_count") or 0),
        "status": "active",
        "metadata": conversation,
    }


def boss_message_to_core(message: dict[str, Any]) -> dict[str, Any]:
    sender = message.get("sender") or "unknown"
    direction = "outbound" if sender == "me" else "inbound"
    sender_type = "self" if sender == "me" else "counterparty"
    return {
        "external_message_id": message.get("id") or message.get("external_message_id"),
        "sender_type": sender_type,
        "sender_name": message.get("sender_name") or "",
        "content": message.get("content") or "",
        "content_type": "text",
        "direction": direction,
        "status": message.get("status") or ("sent" if direction == "outbound" else "received"),
        "metadata": message,
    }
