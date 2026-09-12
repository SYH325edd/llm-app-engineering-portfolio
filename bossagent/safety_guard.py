"""LakeJob real-action safety guard."""

from __future__ import annotations

import json
import os
import random
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from jobradar_log import _one, db_conn, log_event


DEFAULT_CONFIG_PATH = Path("config") / "real_run_config.yaml"
DEFAULT_BLACKLIST_PATH = Path("runtime") / "blacklist_companies.txt"
DEFAULT_RISK_KEYWORDS = (
    "\u9a8c\u8bc1\u7801",
    "\u5f02\u5e38",
    "\u9891\u7e41",
    "\u5b89\u5168",
    "\u98ce\u9669",
    "\u8bf7\u7a0d\u540e",
    "\u8bbf\u95ee\u53d7\u9650",
)
PAUSE_STATES = {
    "captcha": ("验证码", "滑块", "拼图", "captcha", "security check", "安全验证"),
    "login_expired": ("登录失效", "登录已过期", "请重新登录", "请登录", "扫码登录", "login expired"),
    "account_abnormal": ("账号异常", "账户异常", "账号被冻结", "限制使用", "违规"),
    "access_restricted": ("访问受限", "拒绝访问", "access denied", "restricted"),
    "too_frequent": ("操作频繁", "操作太频繁", "请求频繁", "访问频繁", "稍后再试", "too many requests"),
    "risk_control": ("风控", "风险提示", "安全风险", "risk control"),
}


@dataclass(frozen=True)
class SafetyConfig:
    max_real_applies_per_day: int = 5
    max_real_messages_per_day: int = 5
    max_items_per_run: int = 1
    min_action_interval_seconds: int = 60
    random_delay_min_seconds: int = 30
    random_delay_max_seconds: int = 90
    blacklist_companies_file: str = str(DEFAULT_BLACKLIST_PATH)
    risk_keywords: tuple[str, ...] = DEFAULT_RISK_KEYWORDS


def _coerce_scalar(value: str) -> Any:
    value = value.strip()
    if not value:
        return ""
    if value[0] in ("'", '"') and value[-1:] == value[0]:
        value = value[1:-1]
    if "\\u" in value:
        try:
            return value.encode("ascii").decode("unicode_escape")
        except UnicodeError:
            pass
    if value.lower() in ("true", "false"):
        return value.lower() == "true"
    try:
        return int(value)
    except ValueError:
        return value


def _parse_yaml_like(path: Path) -> dict[str, Any]:
    data: dict[str, Any] = {}
    current_key: str | None = None
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        if line.lstrip().startswith("- ") and current_key:
            data.setdefault(current_key, []).append(_coerce_scalar(line.lstrip()[2:]))
            continue
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        current_key = key
        if value == "":
            data[key] = []
        elif value.startswith("[") and value.endswith("]"):
            data[key] = [_coerce_scalar(item) for item in value[1:-1].split(",") if item.strip()]
        else:
            data[key] = _coerce_scalar(value)
    return data


def _load_config_file() -> dict[str, Any]:
    config_path = Path(os.getenv("LAKEJOB_REAL_RUN_CONFIG", str(DEFAULT_CONFIG_PATH)))
    if not config_path.exists():
        return {}
    if config_path.suffix.lower() == ".json":
        return json.loads(config_path.read_text(encoding="utf-8"))
    return _parse_yaml_like(config_path)


def _get_int(raw: dict[str, Any], key: str, env: str, default: int) -> int:
    value = os.getenv(env)
    if value is not None:
        return int(value)
    if key in raw:
        return int(raw[key])
    return default


def _delay_range(raw: dict[str, Any]) -> tuple[int, int]:
    env_min = os.getenv("LAKEJOB_RANDOM_DELAY_MIN_SECONDS")
    env_max = os.getenv("LAKEJOB_RANDOM_DELAY_MAX_SECONDS")
    if env_min is not None or env_max is not None:
        return int(env_min or "30"), int(env_max or "90")
    value = raw.get("random_delay_range_seconds")
    if isinstance(value, list) and len(value) >= 2:
        return int(value[0]), int(value[1])
    if isinstance(value, str) and "-" in value:
        left, right = value.split("-", 1)
        return int(left.strip()), int(right.strip())
    return 30, 90


def load_config() -> SafetyConfig:
    raw = _load_config_file()
    delay_min, delay_max = _delay_range(raw)
    blacklist_file = os.getenv(
        "LAKEJOB_BLACKLIST_COMPANIES_FILE",
        str(raw.get("blacklist_companies_file") or DEFAULT_BLACKLIST_PATH),
    )
    risk_keywords = raw.get("risk_keywords") or list(DEFAULT_RISK_KEYWORDS)
    if isinstance(risk_keywords, str):
        risk_keywords = [item.strip() for item in risk_keywords.split(",") if item.strip()]
    return SafetyConfig(
        max_real_applies_per_day=_get_int(raw, "daily_real_apply_limit", "LAKEJOB_MAX_REAL_APPLIES_PER_DAY", 5),
        max_real_messages_per_day=_get_int(raw, "daily_real_message_limit", "LAKEJOB_MAX_REAL_MESSAGES_PER_DAY", 5),
        max_items_per_run=_get_int(raw, "max_items_per_run", "LAKEJOB_MAX_ITEMS_PER_RUN", 1),
        min_action_interval_seconds=_get_int(raw, "min_interval_seconds", "LAKEJOB_MIN_ACTION_INTERVAL_SECONDS", 60),
        random_delay_min_seconds=delay_min,
        random_delay_max_seconds=delay_max,
        blacklist_companies_file=blacklist_file,
        risk_keywords=tuple(str(item) for item in risk_keywords),
    )


def clamp_run_limit(value: int | None, *, smoke: bool = False) -> int:
    if smoke:
        return 1
    cfg = load_config()
    safety_limit = min(max(0, int(value or 0)), cfg.max_items_per_run)
    try:
        from quota_policy import clamp_run_limit as clamp_quota_run_limit

        return min(safety_limit, clamp_quota_run_limit(value))
    except Exception as exc:
        print(f"WARN: failed to load per-run quota, using safety limit: {exc}")
        return safety_limit


def risk_keyword_reason(text: str | None, keywords: tuple[str, ...] | None = None) -> str | None:
    body = text or ""
    for keyword in keywords or load_config().risk_keywords:
        if keyword in body:
            return "risk_keyword_detected"
    return None


def _pause_reason(text: str, vision_page_state: dict[str, Any]) -> str | None:
    explicit = str(vision_page_state.get("page_status") or vision_page_state.get("status") or "").lower()
    if explicit in PAUSE_STATES:
        return explicit
    combined = f"{text}\n{json.dumps(vision_page_state, ensure_ascii=False, default=str)}".lower()
    for reason, terms in PAUSE_STATES.items():
        if any(term.lower() in combined for term in terms):
            return reason
    return None


def _has_page_evidence(
    *,
    page_text: str | None,
    page_title: str,
    url: str,
    screenshot_path: str,
    ocr_text: str,
    vision_page_state: dict[str, Any] | None,
) -> bool:
    return page_text is not None or any((page_title, url, screenshot_path, ocr_text)) or vision_page_state is not None


def _complete_page_guard(
    *,
    account_id: str | None,
    source: str,
    page_text: str | None,
    page_title: str,
    url: str,
    screenshot_path: str,
    ocr_text: str,
    vision_page_state: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if not all((url, screenshot_path)):
        return None
    return check_page_safety(
        account_id=account_id,
        source=source,
        page_title=page_title,
        url=url,
        screenshot_path=screenshot_path,
        ocr_text=ocr_text or page_text or "",
        vision_page_state=vision_page_state or {},
    )


def _persist_account_pause(
    *,
    account_id: str | None,
    reason: str,
    source: str,
    screenshot_path: str,
) -> None:
    persisted_account_id = str(account_id or "unknown")
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO account_pauses (account_id, reason, source, screenshot_path)
                VALUES (%s, %s, %s, %s)
                """,
                (persisted_account_id, reason, source, screenshot_path),
            )
            if account_id:
                cur.execute("UPDATE accounts SET status = 'locked', updated_at = now() WHERE id::text = %s", (str(account_id),))
                cur.execute(
                    "UPDATE tasks SET status = 'paused', updated_at = now() WHERE account_id::text = %s AND status IN ('scheduled', 'running')",
                    (str(account_id),),
                )
        return
    except Exception as exc:
        fallback = Path("runtime") / "account_pauses.jsonl"
        fallback.parent.mkdir(parents=True, exist_ok=True)
        record = {
            "account_id": persisted_account_id,
            "reason": reason,
            "source": source,
            "screenshot_path": screenshot_path,
            "created_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "resolved_at": None,
            "persistence_error": str(exc),
        }
        with fallback.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")


def check_page_safety(
    page_safe: bool | None = None,
    *,
    account_id: str | None = None,
    source: str = "unknown",
    page_title: str = "",
    url: str = "",
    screenshot_path: str = "",
    ocr_text: str = "",
    vision_page_state: dict[str, Any] | None = None,
    reason: str = "page_safety_check_failed",
) -> dict[str, Any]:
    """Evaluate complete page evidence. Unknown or broken checks fail closed."""
    try:
        if page_safe is not None:
            return _decision(bool(page_safe), "allowed" if page_safe else reason)
        evidence = {
            "page_title": str(page_title or "").strip(),
            "url": str(url or "").strip(),
            "screenshot_path": str(screenshot_path or "").strip(),
            "ocr_text": str(ocr_text or "").strip(),
            "vision_page_state": vision_page_state if isinstance(vision_page_state, dict) else {},
        }
        missing = [key for key in ("url", "screenshot_path") if not evidence[key]]
        if missing:
            return _decision(False, "page_evidence_missing", missing=missing, evidence=evidence)
        if evidence["url"] == "about:blank":
            return _decision(False, "about_blank", evidence=evidence)
        vision_status = str(
            evidence["vision_page_state"].get("page_status")
            or evidence["vision_page_state"].get("status")
            or ""
        ).lower()
        if not evidence["ocr_text"] and vision_status in {"", "unknown"}:
            return _decision(False, "empty_page_evidence", evidence=evidence)

        combined = f"{evidence['page_title']}\n{evidence['url']}\n{evidence['ocr_text']}"
        pause_reason = _pause_reason(combined, evidence["vision_page_state"])
        if pause_reason:
            _persist_account_pause(
                account_id=account_id,
                reason=pause_reason,
                source=source,
                screenshot_path=evidence["screenshot_path"],
            )
            return _decision(False, pause_reason, paused=True, evidence=evidence)
        return _decision(True, "allowed", paused=False, evidence=evidence)
    except Exception as exc:
        return _decision(False, "safety_check_error", error=str(exc))


def _blacklist(path: str | None = None) -> set[str]:
    blacklist_path = Path(path or load_config().blacklist_companies_file)
    if not blacklist_path.exists():
        return set()
    return {
        line.strip()
        for line in blacklist_path.read_text(encoding="utf-8", errors="ignore").splitlines()
        if line.strip() and not line.strip().startswith("#")
    }


def _scalar(sql: str, params: tuple[Any, ...]) -> int:
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(sql, params)
        row = _one(cur)
    return int(row["count"]) if row else 0


def _daily_apply_count(platform_id: str | None, account_id: str | None) -> int:
    return _scalar(
        """
        SELECT COUNT(*) AS count
        FROM applications
        WHERE direction = 'jobradar'
          AND status = 'submitted'
          AND created_at::date = CURRENT_DATE
          AND (%s IS NULL OR platform_id = %s)
          AND (%s IS NULL OR account_id = %s)
        """,
        (platform_id, platform_id, account_id, account_id),
    )


def _daily_message_count(platform_id: str | None, account_id: str | None) -> int:
    return _scalar(
        """
        SELECT COUNT(*) AS count
        FROM messages
        WHERE direction = 'outbound'
          AND status = 'sent'
          AND created_at::date = CURRENT_DATE
          AND (%s IS NULL OR platform_id = %s)
          AND (%s IS NULL OR account_id = %s)
        """,
        (platform_id, platform_id, account_id, account_id),
    )


def _job_apply_seen(platform_id: str | None, platform_job_id: str) -> bool:
    if not platform_job_id:
        return False
    return bool(
        _scalar(
            """
            SELECT COUNT(*) AS count
            FROM applications a
            JOIN jobs j ON j.id = a.job_id
            WHERE a.direction = 'jobradar'
              AND a.status = 'submitted'
              AND (%s IS NULL OR a.platform_id = %s)
              AND j.external_job_id = %s
            """,
            (platform_id, platform_id, platform_job_id),
        )
    )


def _company_apply_seen_today(platform_id: str | None, company: str) -> bool:
    if not company:
        return False
    return bool(
        _scalar(
            """
            SELECT COUNT(*) AS count
            FROM applications a
            JOIN jobs j ON j.id = a.job_id
            WHERE a.direction = 'jobradar'
              AND a.status = 'submitted'
              AND a.created_at::date = CURRENT_DATE
              AND (%s IS NULL OR a.platform_id = %s)
              AND COALESCE(j.company_name, '') = %s
            """,
            (platform_id, platform_id, company),
        )
    )


def _recent_action_seconds(platform_id: str | None, account_id: str | None) -> int | None:
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT EXTRACT(EPOCH FROM (now() - created_at))::int AS seconds
            FROM logs
            WHERE created_at >= now() - interval '1 day'
              AND (%s IS NULL OR platform_id = %s)
              AND (%s IS NULL OR account_id = %s)
              AND payload->>'safety_guard' = 'true'
              AND payload->>'blocked' = 'false'
              AND (
                payload->>'real_apply' = 'true'
                OR payload->>'real_message' = 'true'
                OR payload->>'real_send' = 'true'
              )
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (platform_id, platform_id, account_id, account_id),
        )
        row = _one(cur)
    return int(row["seconds"]) if row and row.get("seconds") is not None else None


def _log_decision(
    *,
    action: str,
    blocked: bool,
    reason: str,
    platform_id: str | None,
    account_id: str | None,
    job: dict[str, Any] | None = None,
    candidate: dict[str, Any] | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    job = job or {}
    candidate = candidate or {}
    payload = {
        "safety_guard": True,
        "blocked": blocked,
        "reason": reason,
        "action": action,
        "job_id": str(job.get("id") or ""),
        "candidate_id": str(candidate.get("id") or candidate.get("candidate_id") or ""),
        "company": job.get("company_name") or job.get("company") or "",
        "platform_job_id": job.get("external_job_id") or job.get("platform_job_id") or "",
        **(extra or {}),
    }
    log_event(
        "Safety Guard decision",
        level="warning" if blocked else "info",
        platform_id=platform_id,
        account_id=account_id,
        entity_type="safety_guard",
        entity_id=str(job.get("id") or candidate.get("id") or ""),
        payload=payload,
    )
    if blocked:
        try:
            from audit_log import record_audit

            record_audit(
                "safety.blocked",
                target_type="safety_guard",
                target_id=str(job.get("id") or candidate.get("id") or "") or None,
                outcome="blocked",
                metadata=payload,
            )
        except Exception as exc:
            print(f"WARN: failed to write safety audit log: {exc}")


def _decision(allowed: bool, reason: str, **data: Any) -> dict[str, Any]:
    return {"allowed": allowed, "blocked": not allowed, "reason": reason, **data}


def _delay_if_allowed(cfg: SafetyConfig, *, platform_id: str | None, account_id: str | None, skip_delay: bool) -> dict[str, Any]:
    if skip_delay:
        return {"interval_sleep_seconds": 0, "random_delay_seconds": 0}
    recent_seconds = _recent_action_seconds(platform_id, account_id)
    interval_sleep = 0
    if recent_seconds is not None and recent_seconds < cfg.min_action_interval_seconds:
        interval_sleep = cfg.min_action_interval_seconds - recent_seconds
        time.sleep(interval_sleep)
    random_delay = random.randint(cfg.random_delay_min_seconds, cfg.random_delay_max_seconds)
    time.sleep(random_delay)
    return {"interval_sleep_seconds": interval_sleep, "random_delay_seconds": random_delay}


def guard_real_apply(
    *,
    platform_id: str | None,
    account_id: str | None,
    job: dict[str, Any],
    page_text: str | None = None,
    page_title: str = "",
    url: str = "",
    screenshot_path: str = "",
    ocr_text: str = "",
    vision_page_state: dict[str, Any] | None = None,
    smoke: bool = False,
    skip_delay: bool = False,
) -> dict[str, Any]:
    cfg = load_config()
    company = job.get("company_name") or job.get("company") or ""
    platform_job_id = job.get("external_job_id") or job.get("platform_job_id") or ""
    checks = [
        risk_keyword_reason(page_text, cfg.risk_keywords),
        "blacklisted_company" if company and company in _blacklist(cfg.blacklist_companies_file) else None,
        "daily_real_apply_limit_reached" if _daily_apply_count(platform_id, account_id) >= cfg.max_real_applies_per_day else None,
        "duplicate_platform_job" if _job_apply_seen(platform_id, platform_job_id) else None,
        "duplicate_company_today" if _company_apply_seen_today(platform_id, company) else None,
    ]
    reason = next((item for item in checks if item), None)
    if reason:
        page_guard = _complete_page_guard(
            account_id=account_id, source="real_apply", page_text=page_text,
            page_title=page_title, url=url, screenshot_path=screenshot_path,
            ocr_text=ocr_text, vision_page_state=vision_page_state,
        )
        if page_guard and page_guard.get("paused"):
            return page_guard
        _log_decision(
            action="real_apply",
            blocked=True,
            reason=reason,
            platform_id=platform_id,
            account_id=account_id,
            job=job,
            extra={"real_apply": True, "smoke": smoke},
        )
        return _decision(False, reason)
    if _has_page_evidence(
        page_text=page_text, page_title=page_title, url=url, screenshot_path=screenshot_path,
        ocr_text=ocr_text, vision_page_state=vision_page_state,
    ):
        page_guard = check_page_safety(
            account_id=account_id,
            source="real_apply",
            page_title=page_title,
            url=url,
            screenshot_path=screenshot_path,
            ocr_text=ocr_text or page_text or "",
            vision_page_state=vision_page_state or {},
        )
        if page_guard["blocked"]:
            _log_decision(
                action="real_apply", blocked=True, reason=page_guard["reason"],
                platform_id=platform_id, account_id=account_id, job=job,
                extra={"real_apply": True, "smoke": smoke, "page_safety": page_guard},
            )
            return page_guard
    delay = _delay_if_allowed(cfg, platform_id=platform_id, account_id=account_id, skip_delay=skip_delay)
    _log_decision(
        action="real_apply",
        blocked=False,
        reason="allowed",
        platform_id=platform_id,
        account_id=account_id,
        job=job,
        extra={"real_apply": True, "smoke": smoke, **delay},
    )
    return _decision(True, "allowed", **delay)


def guard_real_search(
    *,
    platform_id: str | None,
    account_id: str | None,
    query: str,
    page_text: str | None = None,
    page_title: str = "",
    url: str = "",
    screenshot_path: str = "",
    ocr_text: str = "",
    vision_page_state: dict[str, Any] | None = None,
    skip_delay: bool = False,
) -> dict[str, Any]:
    cfg = load_config()
    reason = risk_keyword_reason(page_text, cfg.risk_keywords)
    if reason:
        page_guard = _complete_page_guard(
            account_id=account_id, source="real_search", page_text=page_text,
            page_title=page_title, url=url, screenshot_path=screenshot_path,
            ocr_text=ocr_text, vision_page_state=vision_page_state,
        )
        if page_guard and page_guard.get("paused"):
            return page_guard
        _log_decision(
            action="real_search", blocked=True, reason=reason,
            platform_id=platform_id, account_id=account_id,
            extra={"real_search": True, "query": query},
        )
        return _decision(False, reason)
    if _has_page_evidence(
        page_text=page_text, page_title=page_title, url=url, screenshot_path=screenshot_path,
        ocr_text=ocr_text, vision_page_state=vision_page_state,
    ):
        page_guard = check_page_safety(
            account_id=account_id,
            source="real_search",
            page_title=page_title,
            url=url,
            screenshot_path=screenshot_path,
            ocr_text=ocr_text or page_text or "",
            vision_page_state=vision_page_state or {},
        )
        if page_guard["blocked"]:
            _log_decision(
                action="real_search", blocked=True, reason=page_guard["reason"],
                platform_id=platform_id, account_id=account_id,
                extra={"real_search": True, "query": query, "page_safety": page_guard},
            )
            return page_guard
    delay = _delay_if_allowed(cfg, platform_id=platform_id, account_id=account_id, skip_delay=skip_delay)
    _log_decision(
        action="real_search", blocked=False, reason="allowed",
        platform_id=platform_id, account_id=account_id,
        extra={"real_search": True, "query": query, **delay},
    )
    return _decision(True, "allowed", **delay)


def guard_real_message(
    *,
    platform_id: str | None,
    account_id: str | None,
    job: dict[str, Any] | None = None,
    candidate: dict[str, Any] | None = None,
    page_text: str | None = None,
    page_title: str = "",
    url: str = "",
    screenshot_path: str = "",
    ocr_text: str = "",
    vision_page_state: dict[str, Any] | None = None,
    smoke: bool = False,
    skip_delay: bool = False,
) -> dict[str, Any]:
    cfg = load_config()
    company = (job or {}).get("company_name") or (job or {}).get("company") or ""
    checks = [
        risk_keyword_reason(page_text, cfg.risk_keywords),
        "blacklisted_company" if company and company in _blacklist(cfg.blacklist_companies_file) else None,
        "daily_real_message_limit_reached" if _daily_message_count(platform_id, account_id) >= cfg.max_real_messages_per_day else None,
    ]
    reason = next((item for item in checks if item), None)
    if reason:
        page_guard = _complete_page_guard(
            account_id=account_id, source="real_message", page_text=page_text,
            page_title=page_title, url=url, screenshot_path=screenshot_path,
            ocr_text=ocr_text, vision_page_state=vision_page_state,
        )
        if page_guard and page_guard.get("paused"):
            return page_guard
        _log_decision(
            action="real_message",
            blocked=True,
            reason=reason,
            platform_id=platform_id,
            account_id=account_id,
            job=job,
            candidate=candidate,
            extra={"real_message": True, "smoke": smoke},
        )
        return _decision(False, reason)
    if _has_page_evidence(
        page_text=page_text, page_title=page_title, url=url, screenshot_path=screenshot_path,
        ocr_text=ocr_text, vision_page_state=vision_page_state,
    ):
        page_guard = check_page_safety(
            account_id=account_id,
            source="real_message",
            page_title=page_title,
            url=url,
            screenshot_path=screenshot_path,
            ocr_text=ocr_text or page_text or "",
            vision_page_state=vision_page_state or {},
        )
        if page_guard["blocked"]:
            _log_decision(
                action="real_message", blocked=True, reason=page_guard["reason"],
                platform_id=platform_id, account_id=account_id, job=job, candidate=candidate,
                extra={"real_message": True, "smoke": smoke, "page_safety": page_guard},
            )
            return page_guard
    delay = _delay_if_allowed(cfg, platform_id=platform_id, account_id=account_id, skip_delay=skip_delay)
    _log_decision(
        action="real_message",
        blocked=False,
        reason="allowed",
        platform_id=platform_id,
        account_id=account_id,
        job=job,
        candidate=candidate,
        extra={"real_message": True, "smoke": smoke, **delay},
    )
    return _decision(True, "allowed", **delay)
