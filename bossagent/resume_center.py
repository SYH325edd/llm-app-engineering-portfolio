"""Resume Center storage, parsing, and Core candidate sync."""

from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from ai.provider import get_ai_provider
from resume_parser import extract_text_from_file, generate_resume_summary, parse_resume_text, score_resume


ROOT = Path(__file__).resolve().parent
UPLOAD_DIR = ROOT / "uploads" / "resumes"
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt"}


def _driver():
    try:
        import psycopg  # type: ignore

        return psycopg
    except ImportError:
        try:
            import psycopg2  # type: ignore

            return psycopg2
        except ImportError as exc:
            raise RuntimeError("Install psycopg or psycopg2 to use Resume Center") from exc


def db_conn():
    url = os.getenv("LAKEJOB_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("Set LAKEJOB_DATABASE_URL or DATABASE_URL")
    return _driver().connect(url)


def _one(cur) -> dict[str, Any] | None:
    row = cur.fetchone()
    if row is None:
        return None
    cols = [getattr(item, "name", item[0]) for item in cur.description]
    return dict(zip(cols, row))


def _json(data: Any) -> str:
    return json.dumps(data or {}, ensure_ascii=False, default=str)


def safe_filename(filename: str) -> str:
    name = Path(filename or "resume.txt").name
    stem = Path(name).stem
    suffix = Path(name).suffix.lower()
    safe_stem = re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("._-") or "resume"
    return f"{safe_stem}{suffix}"


def unique_upload_path(filename: str) -> Path:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    safe = safe_filename(filename)
    target = UPLOAD_DIR / safe
    if not target.exists():
        return target
    stem = target.stem
    suffix = target.suffix
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    counter = 1
    while True:
        candidate = UPLOAD_DIR / f"{stem}_{timestamp}_{counter}{suffix}"
        if not candidate.exists():
            return candidate
        counter += 1


def validate_upload(filename: str, content: bytes) -> None:
    suffix = Path(filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise ValueError("Only pdf, docx, and txt resumes are supported")
    if not content:
        raise ValueError("Uploaded resume is empty")
    if len(content) > MAX_UPLOAD_BYTES:
        raise ValueError("Resume file exceeds 20MB limit")


def ensure_resume_platform_account(cur) -> tuple[str, str]:
    cur.execute(
        """
        INSERT INTO platforms (code, name, category, base_url, status)
        VALUES ('resume', 'Resume Center', 'job_board', NULL, 'active')
        ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
        """
    )
    platform_id = str(cur.fetchone()[0])
    cur.execute(
        """
        INSERT INTO accounts (platform_id, account_type, display_name, external_account_id, status)
        VALUES (%s, 'system', 'resume-center', 'resume-center', 'active')
        ON CONFLICT (platform_id, external_account_id) WHERE external_account_id IS NOT NULL
        DO UPDATE SET display_name = EXCLUDED.display_name
        RETURNING id
        """,
        (platform_id,),
    )
    account_id = str(cur.fetchone()[0])
    return platform_id, account_id


def insert_candidate_from_resume(
    *,
    file_name: str,
    stored_path: Path,
    raw_text: str,
    parsed: dict[str, Any],
    summary: dict[str, Any],
    score: int,
    ai_provider: str = "mock",
    ai_parse_status: str = "success",
    ai_parse_error: str = "",
    fallback_used: bool = False,
) -> dict[str, Any]:
    resume_hash = hashlib.sha256(raw_text.encode("utf-8", errors="ignore")).hexdigest()
    candidate_name = parsed.get("name") if parsed.get("name") != "unknown" else Path(file_name).stem
    raw_data = {
        "source": "resume",
        "resume_center": {
            "file_name": file_name,
            "stored_path": str(stored_path.relative_to(ROOT)).replace("\\", "/"),
            "uploaded_at": datetime.now().isoformat(timespec="seconds"),
            "resume_hash": resume_hash,
            "parsed": parsed,
            "summary": summary,
            "score": score,
            "status": "parsed",
            "ai_provider": ai_provider,
            "ai_parse_status": ai_parse_status,
            "ai_parse_error": ai_parse_error,
            "fallback_used": fallback_used,
        },
    }
    with db_conn() as conn:
        try:
            cur = conn.cursor()
            platform_id, account_id = ensure_resume_platform_account(cur)
            cur.execute(
                """
                INSERT INTO candidates (
                  platform_id, account_id, external_candidate_id, source_url, name,
                  headline, current_company, current_title, city, location,
                  experience_text, education_text, skills, resume_text, status, raw_data
                )
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,'active',%s::jsonb)
                ON CONFLICT (platform_id, external_candidate_id) WHERE external_candidate_id IS NOT NULL
                DO UPDATE SET
                  name = EXCLUDED.name,
                  headline = EXCLUDED.headline,
                  current_title = EXCLUDED.current_title,
                  city = EXCLUDED.city,
                  location = EXCLUDED.location,
                  experience_text = EXCLUDED.experience_text,
                  education_text = EXCLUDED.education_text,
                  skills = EXCLUDED.skills,
                  resume_text = EXCLUDED.resume_text,
                  raw_data = EXCLUDED.raw_data
                RETURNING id, name, city, current_title, created_at, raw_data
                """,
                (
                    platform_id,
                    account_id,
                    f"resume:{resume_hash}",
                    str(stored_path.relative_to(ROOT)).replace("\\", "/"),
                    candidate_name or "unknown",
                    summary.get("candidate_profile", "unknown"),
                    "unknown",
                    parsed.get("target_role") or "unknown",
                    parsed.get("city") or "unknown",
                    parsed.get("city") or "unknown",
                    parsed.get("work_years") or "unknown",
                    parsed.get("education") or "unknown",
                    _json(parsed.get("skills") or []),
                    raw_text,
                    _json(raw_data),
                ),
            )
            candidate = _one(cur) or {}
            cur.execute(
                """
                INSERT INTO logs (platform_id, account_id, log_type, level, message, entity_type, entity_id, payload, status)
                VALUES (%s,%s,'audit','info','resume uploaded','candidate',%s,%s::jsonb,'active')
                """,
                (
                    platform_id,
                    account_id,
                    candidate.get("id"),
                    _json(
                        {
                            "resume_center": True,
                            "action": "upload_resume",
                            "file_name": file_name,
                            "candidate_name": candidate_name or "unknown",
                            "candidate_id": str(candidate.get("id") or ""),
                            "score": score,
                            "source": "resume",
                            "ai_provider": ai_provider,
                            "ai_parse_status": ai_parse_status,
                            "ai_parse_error": ai_parse_error,
                            "ai_parse_failed": ai_parse_status in {"failed", "fallback"},
                            "fallback_used": fallback_used,
                        }
                    ),
                ),
            )
            conn.commit()
            return candidate
        except Exception:
            conn.rollback()
            raise


def _provider_name(provider: Any) -> str:
    name = getattr(provider, "name", "")
    if name:
        return str(name)
    cls_name = provider.__class__.__name__.lower()
    if "deepseek" in cls_name:
        return "deepseek"
    if "mock" in cls_name:
        return "mock"
    return cls_name or "unknown"


def _validate_ai_result(parsed: dict[str, Any], summary: dict[str, Any]) -> None:
    if not isinstance(parsed, dict) or not parsed:
        raise ValueError("AI parse result must be a non-empty JSON object")
    if not isinstance(summary, dict) or not summary:
        raise ValueError("AI summary result must be a non-empty JSON object")
    required_summary_fields = {"candidate_profile", "strengths", "risks", "recommended_directions", "match_tags"}
    missing = required_summary_fields - set(summary)
    if missing:
        raise ValueError(f"AI summary missing fields: {', '.join(sorted(missing))}")


def parse_resume_with_provider(raw_text: str) -> dict[str, Any]:
    provider = get_ai_provider()
    provider_name = _provider_name(provider)
    try:
        parsed = provider.parse_resume(raw_text)
        summary = provider.summarize_resume(parsed, raw_text)
        _validate_ai_result(parsed, summary)
        return {
            "parsed": parsed,
            "summary": summary,
            "ai_provider": provider_name,
            "ai_parse_status": "success",
            "ai_parse_error": "",
            "fallback_used": False,
        }
    except Exception as exc:
        parsed = parse_resume_text(raw_text)
        score = score_resume(parsed)
        summary = generate_resume_summary(parsed, score)
        return {
            "parsed": parsed,
            "summary": summary,
            "ai_provider": "fallback_rule",
            "ai_parse_status": "fallback",
            "ai_parse_error": str(exc),
            "fallback_used": True,
            "attempted_provider": provider_name,
        }


def get_resume_ai_status() -> dict[str, Any]:
    try:
        from ai.provider import load_ai_config

        config = load_ai_config()
    except Exception:
        config = {"provider": "mock", "model": "deepseek-chat", "base_url": "https://api.deepseek.com"}
    provider = str(config.get("provider") or "mock")
    return {
        "provider": provider,
        "provider_label": "DeepSeek" if provider == "deepseek" else "Mock AI",
        "model": str(config.get("model") or "deepseek-chat"),
        "base_url": str(config.get("base_url") or "https://api.deepseek.com"),
        "has_deepseek_key": bool(os.getenv("DEEPSEEK_API_KEY")),
        "will_fallback_without_key": provider == "deepseek" and not bool(os.getenv("DEEPSEEK_API_KEY")),
    }


def process_resume_upload(filename: str, content: bytes) -> dict[str, Any]:
    validate_upload(filename, content)
    target = unique_upload_path(filename)
    target.write_bytes(content)
    try:
        raw_text = extract_text_from_file(target)
        if not raw_text.strip():
            raise ValueError("No readable text was extracted from resume")
        ai_result = parse_resume_with_provider(raw_text)
        parsed = ai_result["parsed"]
        score = score_resume(parsed)
        summary = ai_result["summary"]
        candidate = insert_candidate_from_resume(
            file_name=target.name,
            stored_path=target,
            raw_text=raw_text,
            parsed=parsed,
            summary=summary,
            score=score,
            ai_provider=ai_result["ai_provider"],
            ai_parse_status=ai_result["ai_parse_status"],
            ai_parse_error=ai_result["ai_parse_error"],
            fallback_used=ai_result["fallback_used"],
        )
        return {
            "candidate": candidate,
            "parsed": parsed,
            "summary": summary,
            "score": score,
            "file_name": target.name,
            "ai_provider": ai_result["ai_provider"],
            "ai_parse_status": ai_result["ai_parse_status"],
            "ai_parse_error": ai_result["ai_parse_error"],
            "fallback_used": ai_result["fallback_used"],
        }
    except Exception:
        if target.exists():
            target.unlink()
        raise


def list_resumes(provider: str = "all", status: str = "all") -> list[dict[str, Any]]:
    provider = provider if provider in {"all", "mock", "deepseek", "fallback_rule"} else "all"
    status = status if status in {"all", "success", "failed", "fallback"} else "all"
    filters = ["raw_data->>'source' = 'resume'"]
    params: list[Any] = []
    if provider != "all":
        filters.append("raw_data->'resume_center'->>'ai_provider' = %s")
        params.append(provider)
    if status != "all":
        filters.append("raw_data->'resume_center'->>'ai_parse_status' = %s")
        params.append(status)
    where_sql = " AND ".join(filters)
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT id, name, city, current_title, status, created_at, raw_data
            FROM candidates
            WHERE {where_sql}
            ORDER BY created_at DESC
            LIMIT 200
            """,
            tuple(params),
        )
        rows = []
        for row in cur.fetchall():
            candidate = dict(zip([getattr(item, "name", item[0]) for item in cur.description], row))
            resume = (candidate.get("raw_data") or {}).get("resume_center", {})
            rows.append(
                {
                    "id": candidate["id"],
                    "file_name": resume.get("file_name", "unknown"),
                    "uploaded_at": resume.get("uploaded_at") or candidate.get("created_at"),
                    "candidate_name": candidate.get("name") or "unknown",
                    "target_role": candidate.get("current_title") or "unknown",
                    "city": candidate.get("city") or "unknown",
                    "score": resume.get("score", "unknown"),
                    "status": resume.get("status") or candidate.get("status") or "unknown",
                    "ai_provider": resume.get("ai_provider", "unknown"),
                    "ai_parse_status": resume.get("ai_parse_status", "unknown"),
                    "fallback_used": resume.get("fallback_used", False),
                }
            )
        return rows


def get_resume_detail(candidate_id: str) -> dict[str, Any] | None:
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, name, city, current_title, status, created_at, resume_text, raw_data
            FROM candidates
            WHERE id = %s AND raw_data->>'source' = 'resume'
            LIMIT 1
            """,
            (candidate_id,),
        )
        row = _one(cur)
    if not row:
        return None
    resume = (row.get("raw_data") or {}).get("resume_center", {})
    return {
        "id": row["id"],
        "candidate_name": row.get("name") or "unknown",
        "city": row.get("city") or "unknown",
        "target_role": row.get("current_title") or "unknown",
        "status": resume.get("status") or row.get("status") or "unknown",
        "created_at": row.get("created_at"),
        "raw_text": row.get("resume_text") or "",
        "parsed": resume.get("parsed", {}),
        "summary": resume.get("summary", {}),
        "score": resume.get("score", "unknown"),
        "file_name": resume.get("file_name", "unknown"),
        "uploaded_at": resume.get("uploaded_at") or row.get("created_at"),
        "ai_provider": resume.get("ai_provider", "unknown"),
        "ai_parse_status": resume.get("ai_parse_status", "unknown"),
        "ai_parse_error": resume.get("ai_parse_error", ""),
        "fallback_used": resume.get("fallback_used", False),
    }
