from fastapi import APIRouter, Form, Request

from lakejob.application.messaging.center import (
    ALLOWED_CONVERSATION_STATUSES,
    get_conversation_detail as get_message_conversation_detail,
    list_conversations as list_message_conversations,
    update_conversation_status as update_message_conversation_status,
)
from lakejob.application.messaging.draft import (
    create_jobseeker_message_draft,
    create_recruiter_message_draft,
    get_message_draft,
    list_message_drafts,
    send_message_draft_once,
)
from lakejob.application.profiles.center import load_jobseeker_profile, load_recruiter_profile
from lakejob.app.ui import redirect, templates
from lakejob.app.security import require_local_request


router = APIRouter()


@router.get("/messages")
def messages_page(
    request: Request,
    keyword: str = "",
    status: str = "all",
    source: str = "",
    date: str = "",
    message: str = "",
    error: str = "",
):
    filters = {"keyword": keyword, "status": status or "all", "source": source, "date": date}
    try:
        conversations = list_message_conversations(filters)
    except Exception as exc:
        conversations = []
        error = error or str(exc)
    return templates.TemplateResponse(
        request,
        "messages.html",
        {
            "active": "messages",
            "conversations": conversations,
            "allowed_statuses": ALLOWED_CONVERSATION_STATUSES,
            "filters": filters,
            "message": message,
            "error": error,
        },
    )


@router.get("/messages/{conversation_id}")
def message_conversation_detail_page(
    request: Request, conversation_id: str, message: str = "", error: str = ""
):
    try:
        detail = get_message_conversation_detail(conversation_id)
    except Exception as exc:
        detail = None
        error = error or str(exc)
    return templates.TemplateResponse(
        request,
        "conversation_detail.html",
        {
            "active": "messages",
            "detail": detail,
            "message": message,
            "error": error or ("" if detail else "conversation not found"),
        },
    )


@router.get("/message-drafts")
def message_drafts_page(request: Request, message: str = "", error: str = ""):
    try:
        drafts = list_message_drafts()
    except Exception as exc:
        drafts = []
        error = error or str(exc)
    return templates.TemplateResponse(
        request,
        "message_drafts.html",
        {"active": "message_drafts", "drafts": drafts, "message": message, "error": error},
    )


@router.get("/message-drafts/{draft_id}")
def message_draft_detail_page(
    request: Request, draft_id: str, message: str = "", error: str = ""
):
    try:
        draft = get_message_draft(draft_id)
    except Exception as exc:
        draft = None
        error = error or str(exc)
    return templates.TemplateResponse(
        request,
        "message_draft_detail.html",
        {
            "active": "message_drafts",
            "draft": draft,
            "message": message,
            "error": error or ("" if draft else "message draft not found"),
        },
    )


@router.post("/messages/{conversation_id}/status")
def message_conversation_status(
    request: Request,
    conversation_id: str,
    status: str = Form(...),
):
    guard = require_local_request(request.client.host if request.client else None)
    if not guard.allowed:
        return redirect(f"/messages/{conversation_id}", error=guard.reason)

    try:
        update_message_conversation_status(conversation_id, status)
        return redirect(f"/messages/{conversation_id}", "conversation status updated")
    except Exception as exc:
        return redirect(f"/messages/{conversation_id}", error=str(exc))


@router.post("/message-drafts/recruiter/{candidate_id}")
def create_recruiter_draft(
    request: Request,
    candidate_id: str,
):
    guard = require_local_request(request.client.host if request.client else None)
    if not guard.allowed:
        return redirect("/message-drafts", error=guard.reason)

    try:
        draft = create_recruiter_message_draft(candidate_id, load_recruiter_profile())
        return redirect(f"/message-drafts/{draft['draft_id']}", "draft created")
    except Exception as exc:
        return redirect("/message-drafts", error=str(exc))


@router.post("/message-drafts/jobseeker/{job_id}")
def create_jobseeker_draft(
    request: Request,
    job_id: str,
):
    guard = require_local_request(request.client.host if request.client else None)
    if not guard.allowed:
        return redirect("/message-drafts", error=guard.reason)

    try:
        draft = create_jobseeker_message_draft(job_id, load_jobseeker_profile())
        return redirect(f"/message-drafts/{draft['draft_id']}", "draft created")
    except Exception as exc:
        return redirect("/message-drafts", error=str(exc))


@router.post("/message-drafts/{draft_id}/send")
def send_message_draft_page(
    request: Request,
    draft_id: str,
    confirm_phrase: str = Form(""),
):
    guard = require_local_request(request.client.host if request.client else None)
    if not guard.allowed:
        return redirect(f"/message-drafts/{draft_id}", error=guard.reason)

    try:
        result = send_message_draft_once(draft_id, confirm_phrase=confirm_phrase)
        if result.get("success"):
            return redirect(f"/message-drafts/{draft_id}", "draft sent")
        if result.get("blocked"):
            return redirect(
                f"/message-drafts/{draft_id}",
                error=f"Safety Guard blocked: {result.get('reason')}",
            )
        return redirect(
            f"/message-drafts/{draft_id}",
            error=result.get("error") or "send failed",
        )
    except Exception as exc:
        return redirect(f"/message-drafts/{draft_id}", error=str(exc))
