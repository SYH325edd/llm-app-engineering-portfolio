from __future__ import annotations

import json
import os
import sys
import traceback
import types
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _install_playwright_import_shim() -> None:
    try:
        import playwright.sync_api  # type: ignore  # noqa: F401

        return
    except ImportError:
        pass

    playwright_module = types.ModuleType("playwright")
    sync_api_module = types.ModuleType("playwright.sync_api")

    class Locator:
        pass

    def sync_playwright():
        raise RuntimeError("playwright is not installed and is not used by database validation")

    sync_api_module.Locator = Locator
    sync_api_module.sync_playwright = sync_playwright
    playwright_module.sync_api = sync_api_module
    sys.modules.setdefault("playwright", playwright_module)
    sys.modules.setdefault("playwright.sync_api", sync_api_module)


_install_playwright_import_shim()

import lakejob.application.jobs.apply as jobradar_apply  # noqa: F401
import lakejob.infrastructure.database.jobs as jobradar_log  # noqa: F401
import lakejob.application.jobs.search as jobradar_search  # noqa: F401
import lakejob.infrastructure.database.recruiting as recruitradar_log  # noqa: F401
import lakejob.application.recruiting.message as recruitradar_msg  # noqa: F401
import lakejob.application.recruiting.score as recruitradar_score  # noqa: F401
import lakejob.application.recruiting.search as recruitradar_search  # noqa: F401


RESULTS_FILE = Path("runtime") / "validation" / "dual-run-validation.md"
TABLES = (
    "jobs",
    "candidates",
    "applications",
    "match_scores",
    "conversations",
    "messages",
    "logs",
)


def _require_database_url() -> str:
    database_url = os.getenv("LAKEJOB_DATABASE_URL")
    if not database_url:
        raise RuntimeError("LAKEJOB_DATABASE_URL is required")
    return database_url


def _driver():
    try:
        import psycopg  # type: ignore

        return "psycopg", psycopg
    except ImportError:
        try:
            import psycopg2  # type: ignore

            return "psycopg2", psycopg2
        except ImportError as exc:
            raise RuntimeError("Install psycopg or psycopg2 before running validation") from exc


def _connect(database_url: str):
    _, driver = _driver()
    return driver.connect(database_url)


def _one(cur) -> dict[str, Any] | None:
    row = cur.fetchone()
    if row is None:
        return None
    columns = [desc[0] for desc in cur.description]
    return dict(zip(columns, row))


def _json(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, default=str)


def _execute_one(cur, sql: str, params: tuple[Any, ...]) -> dict[str, Any]:
    try:
        cur.execute(sql, params)
        row = _one(cur)
    except Exception as exc:
        raise RuntimeError(f"SQL failed: {exc}\n\nSQL:\n{sql.strip()}\n\nParams:\n{params}") from exc
    if row is None:
        raise RuntimeError(f"SQL returned no row:\n{sql.strip()}")
    return row


def _count_table(conn, table: str) -> int:
    with conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS count FROM {table}")
        row = _one(cur)
    return int(row["count"])


def _collect_counts(conn) -> dict[str, int]:
    return {table: _count_table(conn, table) for table in TABLES}


def _delta(before: dict[str, int], after: dict[str, int], table: str) -> int:
    return after.get(table, 0) - before.get(table, 0)


def _ensure_platform(cur) -> str:
    row = _execute_one(
        cur,
        """
        INSERT INTO platforms (code, name, category, base_url, status)
        VALUES (%s, %s, 'job_board', 'https://www.zhipin.com', 'active')
        ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
        """,
        ("boss", "BOSS Direct Hire"),
    )
    return str(row["id"])


def _ensure_account(cur, platform_id: str, account_type: str, display_name: str) -> str:
    external_account_id = f"dualrun-validation:{account_type}:{display_name}"
    row = _execute_one(
        cur,
        """
        INSERT INTO accounts (platform_id, account_type, display_name, external_account_id, status)
        VALUES (%s, %s, %s, %s, 'active')
        ON CONFLICT (platform_id, external_account_id) WHERE external_account_id IS NOT NULL
        DO UPDATE SET display_name = EXCLUDED.display_name
        RETURNING id
        """,
        (platform_id, account_type, display_name, external_account_id),
    )
    return str(row["id"])


def _insert_job(cur, platform_id: str, account_id: str, run_id: str) -> dict[str, Any]:
    mock_job = {
        "external_job_id": f"dualrun-mock-job-{run_id}",
        "source_url": f"mock://dualrun/jobs/{run_id}",
        "title": "DualRun Mock Backend Engineer",
        "company_name": "DualRun Mock Company",
        "salary_text": "20k-35k",
        "city": "Beijing",
        "location": "Beijing",
        "experience_text": "3-5 years",
        "education_text": "Bachelor",
        "description": "Mock validation job for PostgreSQL write chain.",
    }
    return _execute_one(
        cur,
        """
        INSERT INTO jobs (
            platform_id, account_id, external_job_id, source_url, title,
            company_name, salary_text, city, location, experience_text,
            education_text, description, status, raw_data
        )
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'active',%s::jsonb)
        RETURNING *
        """,
        (
            platform_id,
            account_id,
            mock_job["external_job_id"],
            mock_job["source_url"],
            mock_job["title"],
            mock_job["company_name"],
            mock_job["salary_text"],
            mock_job["city"],
            mock_job["location"],
            mock_job["experience_text"],
            mock_job["education_text"],
            mock_job["description"],
            _json(mock_job),
        ),
    )


def _insert_candidate(cur, platform_id: str, account_id: str, run_id: str) -> dict[str, Any]:
    mock_candidate = {
        "external_candidate_id": f"dualrun-mock-candidate-{run_id}",
        "source_url": f"mock://dualrun/candidates/{run_id}",
        "name": "DualRun Mock Candidate",
        "headline": "Backend engineer with platform experience",
        "current_company": "MockTech",
        "current_title": "Backend Engineer",
        "city": "Beijing",
        "location": "Beijing",
        "experience_text": "5 years",
        "education_text": "Bachelor",
        "skills": ["Python", "FastAPI", "PostgreSQL"],
        "resume_text": "Mock candidate used only for PostgreSQL validation.",
    }
    return _execute_one(
        cur,
        """
        INSERT INTO candidates (
            platform_id, account_id, external_candidate_id, source_url, name,
            headline, current_company, current_title, city, location,
            experience_text, education_text, skills, resume_text, status, raw_data
        )
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,'active',%s::jsonb)
        RETURNING *
        """,
        (
            platform_id,
            account_id,
            mock_candidate["external_candidate_id"],
            mock_candidate["source_url"],
            mock_candidate["name"],
            mock_candidate["headline"],
            mock_candidate["current_company"],
            mock_candidate["current_title"],
            mock_candidate["city"],
            mock_candidate["location"],
            mock_candidate["experience_text"],
            mock_candidate["education_text"],
            _json(mock_candidate["skills"]),
            mock_candidate["resume_text"],
            _json(mock_candidate),
        ),
    )


def _insert_application(
    cur,
    platform_id: str,
    account_id: str,
    direction: str,
    run_id: str,
    *,
    job_id: str | None = None,
    candidate_id: str | None = None,
) -> dict[str, Any]:
    return _execute_one(
        cur,
        """
        INSERT INTO applications (
            platform_id, account_id, job_id, candidate_id, direction,
            external_application_id, stage, status, submitted_at,
            last_activity_at, metadata
        )
        VALUES (%s,%s,%s,%s,%s,%s,'mock','submitted',now(),now(),%s::jsonb)
        RETURNING *
        """,
        (
            platform_id,
            account_id,
            job_id,
            candidate_id,
            direction,
            f"dualrun-{direction}-application-{run_id}",
            _json({"source": "run_dual_mock_validation.py", "run_id": run_id}),
        ),
    )


def _insert_match_score(
    cur,
    job_id: str,
    candidate_id: str,
    application_id: str,
    run_id: str,
) -> dict[str, Any]:
    return _execute_one(
        cur,
        """
        INSERT INTO match_scores (
            job_id, candidate_id, application_id, score, score_type,
            summary, details, status, computed_at
        )
        VALUES (%s,%s,%s,92.500,'rule',%s,%s::jsonb,'active',now())
        RETURNING *
        """,
        (
            job_id,
            candidate_id,
            application_id,
            "DualRun mock candidate matches mock job",
            _json({"run_id": run_id, "matched_skills": ["Python", "FastAPI", "PostgreSQL"]}),
        ),
    )


def _insert_conversation(
    cur,
    platform_id: str,
    account_id: str,
    application_id: str,
    run_id: str,
    *,
    direction: str,
    job_id: str | None = None,
    candidate_id: str | None = None,
    counterparty_name: str = "",
    counterparty_role: str = "unknown",
) -> dict[str, Any]:
    subject_type = "application" if direction == "jobradar" else "candidate"
    subject_id = application_id if direction == "jobradar" else candidate_id
    return _execute_one(
        cur,
        """
        INSERT INTO conversations (
            platform_id, account_id, application_id, job_id, candidate_id,
            external_conversation_id, subject_type, subject_id,
            counterparty_name, counterparty_role, last_message_at,
            last_message_preview, unread_count, status, metadata
        )
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,now(),%s,0,'active',%s::jsonb)
        RETURNING *
        """,
        (
            platform_id,
            account_id,
            application_id,
            job_id,
            candidate_id,
            f"dualrun-{direction}-conversation-{run_id}",
            subject_type,
            subject_id,
            counterparty_name,
            counterparty_role,
            f"DualRun {direction} mock message",
            _json({"source": "run_dual_mock_validation.py", "run_id": run_id}),
        ),
    )


def _insert_message(
    cur,
    conversation_id: str,
    platform_id: str,
    account_id: str,
    run_id: str,
    *,
    direction: str,
    sender_name: str,
    content: str,
) -> dict[str, Any]:
    return _execute_one(
        cur,
        """
        INSERT INTO messages (
            conversation_id, platform_id, account_id, external_message_id,
            sender_type, sender_name, content, content_type, direction,
            sent_at, status, metadata
        )
        VALUES (%s,%s,%s,%s,'ai',%s,%s,'text','outbound',now(),'sent',%s::jsonb)
        RETURNING *
        """,
        (
            conversation_id,
            platform_id,
            account_id,
            f"dualrun-{direction}-message-{run_id}",
            sender_name,
            content,
            _json({"source": "run_dual_mock_validation.py", "run_id": run_id, "flow": direction}),
        ),
    )


def _insert_log(
    cur,
    platform_id: str,
    account_id: str,
    run_id: str,
    *,
    message: str,
    entity_type: str,
    entity_id: str,
    conversation_id: str | None = None,
) -> dict[str, Any]:
    return _execute_one(
        cur,
        """
        INSERT INTO logs (
            platform_id, account_id, conversation_id, log_type, level,
            message, entity_type, entity_id, payload, status
        )
        VALUES (%s,%s,%s,'audit','info',%s,%s,%s,%s::jsonb,'active')
        RETURNING *
        """,
        (
            platform_id,
            account_id,
            conversation_id,
            message,
            entity_type,
            entity_id,
            _json({"source": "run_dual_mock_validation.py", "run_id": run_id}),
        ),
    )


def _write_results(
    *,
    passed: bool,
    started_at: datetime,
    finished_at: datetime,
    before_counts: dict[str, int],
    after_counts: dict[str, int],
    ids: dict[str, str],
    error: str | None,
) -> None:
    status = "PASSED" if passed else "FAILED"
    lines = [
        "# DualRun Validation Results",
        "",
        f"- Status: {status}",
        f"- Started At: {started_at.isoformat()}",
        f"- Finished At: {finished_at.isoformat()}",
        "",
        "## Counts",
        "",
        "| Table | Before | After | Delta |",
        "| --- | ---: | ---: | ---: |",
    ]
    for table in TABLES:
        lines.append(
            f"| {table} | {before_counts.get(table, 0)} | {after_counts.get(table, 0)} | {_delta(before_counts, after_counts, table)} |"
        )
    lines.extend(["", "## Inserted IDs", ""])
    for name, value in ids.items():
        lines.append(f"- {name}: {value}")
    if error:
        lines.extend(["", "## Error", "", "```", error.strip(), "```"])
    RESULTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    RESULTS_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")


def run_validation() -> bool:
    started_at = datetime.now(timezone.utc)
    database_url = _require_database_url()
    before_counts = {table: 0 for table in TABLES}
    after_counts = {table: 0 for table in TABLES}
    ids: dict[str, str] = {}
    error: str | None = None
    passed = False

    try:
        run_id = started_at.strftime("%Y%m%d%H%M%S%f")
        with _connect(database_url) as conn:
            try:
                before_counts = _collect_counts(conn)
                with conn.cursor() as cur:
                    platform_id = _ensure_platform(cur)
                    jobseeker_account_id = _ensure_account(cur, platform_id, "job_seeker", "dualrun-validation-jobseeker")
                    recruiter_account_id = _ensure_account(cur, platform_id, "recruiter", "dualrun-validation-recruiter")

                    job = _insert_job(cur, platform_id, jobseeker_account_id, run_id)
                    candidate = _insert_candidate(cur, platform_id, recruiter_account_id, run_id)
                    job_id = str(job["id"])
                    candidate_id = str(candidate["id"])

                    jobradar_application = _insert_application(
                        cur,
                        platform_id,
                        jobseeker_account_id,
                        "jobradar",
                        run_id,
                        job_id=job_id,
                    )
                    recruitradar_application = _insert_application(
                        cur,
                        platform_id,
                        recruiter_account_id,
                        "recruitradar",
                        run_id,
                        job_id=job_id,
                        candidate_id=candidate_id,
                    )
                    match_score = _insert_match_score(
                        cur,
                        job_id,
                        candidate_id,
                        str(recruitradar_application["id"]),
                        run_id,
                    )

                    jobradar_conversation = _insert_conversation(
                        cur,
                        platform_id,
                        jobseeker_account_id,
                        str(jobradar_application["id"]),
                        run_id,
                        direction="jobradar",
                        job_id=job_id,
                        counterparty_name=str(job.get("company_name") or "DualRun Mock Company"),
                        counterparty_role="hr",
                    )
                    recruitradar_conversation = _insert_conversation(
                        cur,
                        platform_id,
                        recruiter_account_id,
                        str(recruitradar_application["id"]),
                        run_id,
                        direction="recruitradar",
                        job_id=job_id,
                        candidate_id=candidate_id,
                        counterparty_name=str(candidate.get("name") or "DualRun Mock Candidate"),
                        counterparty_role="candidate",
                    )

                    jobradar_message = _insert_message(
                        cur,
                        str(jobradar_conversation["id"]),
                        platform_id,
                        jobseeker_account_id,
                        run_id,
                        direction="jobradar",
                        sender_name="JobRadar Mock AI",
                        content="Hello, I am interested in this mock role.",
                    )
                    recruitradar_message = _insert_message(
                        cur,
                        str(recruitradar_conversation["id"]),
                        platform_id,
                        recruiter_account_id,
                        run_id,
                        direction="recruitradar",
                        sender_name="RecruitRadar Mock AI",
                        content="Hello, this mock role matches your backend experience.",
                    )

                    jobradar_log_row = _insert_log(
                        cur,
                        platform_id,
                        jobseeker_account_id,
                        run_id,
                        message="DualRun JobRadar mock database flow completed",
                        entity_type="application",
                        entity_id=str(jobradar_application["id"]),
                        conversation_id=str(jobradar_conversation["id"]),
                    )
                    recruitradar_log_row = _insert_log(
                        cur,
                        platform_id,
                        recruiter_account_id,
                        run_id,
                        message="DualRun RecruitRadar mock database flow completed",
                        entity_type="candidate",
                        entity_id=candidate_id,
                        conversation_id=str(recruitradar_conversation["id"]),
                    )

                    ids = {
                        "platform_id": platform_id,
                        "jobseeker_account_id": jobseeker_account_id,
                        "recruiter_account_id": recruiter_account_id,
                        "job_id": job_id,
                        "candidate_id": candidate_id,
                        "jobradar_application_id": str(jobradar_application["id"]),
                        "recruitradar_application_id": str(recruitradar_application["id"]),
                        "match_score_id": str(match_score["id"]),
                        "jobradar_conversation_id": str(jobradar_conversation["id"]),
                        "recruitradar_conversation_id": str(recruitradar_conversation["id"]),
                        "jobradar_message_id": str(jobradar_message["id"]),
                        "recruitradar_message_id": str(recruitradar_message["id"]),
                        "jobradar_log_id": str(jobradar_log_row["id"]),
                        "recruitradar_log_id": str(recruitradar_log_row["id"]),
                    }
                conn.commit()
                after_counts = _collect_counts(conn)
            except Exception:
                conn.rollback()
                raise

        required_deltas = {
            "jobs": 1,
            "candidates": 1,
            "applications": 2,
            "match_scores": 1,
            "conversations": 2,
            "messages": 2,
            "logs": 2,
        }
        failures = [
            f"{table} delta {_delta(before_counts, after_counts, table)} < {minimum}"
            for table, minimum in required_deltas.items()
            if _delta(before_counts, after_counts, table) < minimum
        ]
        if failures:
            raise RuntimeError("; ".join(failures))
        passed = True
    except Exception:
        error = traceback.format_exc()
        try:
            with _connect(database_url) as conn:
                after_counts = _collect_counts(conn)
        except Exception:
            after_counts = dict(before_counts)
        print(error, file=sys.stderr)
        passed = False
    finally:
        _write_results(
            passed=passed,
            started_at=started_at,
            finished_at=datetime.now(timezone.utc),
            before_counts=before_counts,
            after_counts=after_counts,
            ids=ids,
            error=error,
        )
    return passed


def main() -> int:
    passed = run_validation()
    print("VALIDATION PASSED" if passed else "VALIDATION FAILED")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
