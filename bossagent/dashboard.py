"""LakeJob local console dashboard.

Dashboard V2 is intentionally local and command based. It can show Core
statistics, recent logs, Safety Guard config, and scheduler task state. It
cannot trigger real apply or real message actions.
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any

from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from dashboard_actions import (
    apply_config_set,
    apply_scheduler_command,
    load_real_run_config,
    load_scheduler_config,
)
from dashboard_metrics import NA, fetch_operation_metrics


console = Console()


def _driver():
    try:
        import psycopg  # type: ignore

        return "psycopg", psycopg
    except ImportError:
        try:
            import psycopg2  # type: ignore

            return "psycopg2", psycopg2
        except ImportError as exc:
            raise RuntimeError("Install psycopg or psycopg2 to use Dashboard DB features") from exc


def get_db_connection():
    url = os.getenv("LAKEJOB_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("Set LAKEJOB_DATABASE_URL or DATABASE_URL")
    _, driver = _driver()
    return driver.connect(url)


def _fetch_one_count(cur, table: str) -> int:
    cur.execute(f"SELECT COUNT(*) FROM {table};")
    return int(cur.fetchone()[0])


def fetch_statistics() -> dict[str, Any]:
    stats = {
        "jobs": 0,
        "candidates": 0,
        "applications": 0,
        "match_scores": 0,
        "conversations": 0,
        "messages": 0,
        "logs": 0,
        "jobs_today": 0,
        "applications_today": 0,
        "messages_today": 0,
    }
    try:
        with get_db_connection() as conn:
            cur = conn.cursor()
            for table in [
                "jobs",
                "candidates",
                "applications",
                "match_scores",
                "conversations",
                "messages",
                "logs",
            ]:
                stats[table] = _fetch_one_count(cur, table)

            cur.execute("SELECT COUNT(*) FROM jobs WHERE created_at::date = CURRENT_DATE;")
            stats["jobs_today"] = int(cur.fetchone()[0])
            cur.execute("SELECT COUNT(*) FROM applications WHERE created_at::date = CURRENT_DATE;")
            stats["applications_today"] = int(cur.fetchone()[0])
            cur.execute("SELECT COUNT(*) FROM messages WHERE created_at::date = CURRENT_DATE;")
            stats["messages_today"] = int(cur.fetchone()[0])
    except Exception as exc:
        console.print(f"[yellow]Dashboard DB statistics unavailable: {exc}[/yellow]")
    return stats


def fetch_recent_logs(limit: int = 20) -> list[dict[str, Any]]:
    try:
        with get_db_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT created_at, message, status, payload
                FROM logs
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (limit,),
            )
            rows = cur.fetchall()
    except Exception as exc:
        console.print(f"[yellow]Dashboard logs unavailable: {exc}[/yellow]")
        return []

    logs: list[dict[str, Any]] = []
    for created_at, message, status, payload in rows:
        if isinstance(payload, str):
            try:
                payload_obj = json.loads(payload)
            except json.JSONDecodeError:
                payload_obj = {}
        else:
            payload_obj = payload or {}
        logs.append(
            {
                "created_at": created_at,
                "action": payload_obj.get("action") or payload_obj.get("command") or message,
                "status": status,
                "reason": payload_obj.get("reason", ""),
                "blocked": payload_obj.get("blocked", ""),
                "task_name": payload_obj.get("task_name", ""),
            }
        )
    return logs


def render_summary() -> None:
    stats = fetch_statistics()
    table = Table(title="LakeJob Dashboard V2")
    table.add_column("Metric", justify="left")
    table.add_column("Value", justify="right")
    for key in [
        "jobs",
        "candidates",
        "applications",
        "match_scores",
        "conversations",
        "messages",
        "logs",
        "jobs_today",
        "applications_today",
        "messages_today",
    ]:
        table.add_row(key, str(stats[key]))
    console.print(Panel(table, title=datetime.now().strftime("%Y-%m-%d %H:%M:%S")))


def _format_list(items: list[dict[str, Any]]) -> str:
    if not items:
        return NA
    return "\n".join(f"{item.get('name', NA)}: {item.get('count', 0)}" for item in items)


def _add_metric_rows(table: Table, metrics: dict[str, Any], keys: list[str]) -> None:
    if "error" in metrics:
        table.add_row("error", str(metrics["error"]))
        return
    for key in keys:
        value = metrics.get(key, NA)
        if isinstance(value, list):
            value = _format_list(value)
        table.add_row(key, str(value))


def render_operation_dashboard() -> None:
    metrics = fetch_operation_metrics(get_db_connection)
    if "error" in metrics:
        console.print(f"[yellow]Operation metrics unavailable: {metrics['error']}[/yellow]")
        return

    funnel = Table(title="Recruiting Funnel")
    funnel.add_column("Metric")
    funnel.add_column("Value", justify="right")
    _add_metric_rows(
        funnel,
        metrics["recruiting_funnel"],
        [
            "candidates",
            "scored_candidates",
            "candidate_conversations",
            "candidate_messages",
            "applications",
            "submitted_applications",
            "responded_applications",
        ],
    )

    talent = Table(title="Talent Profile")
    talent.add_column("Metric")
    talent.add_column("Value")
    _add_metric_rows(talent, metrics["talent_profile"], ["total", "active", "top_cities", "top_titles", "top_education"])

    jobs = Table(title="Job Pool")
    jobs.add_column("Metric")
    jobs.add_column("Value")
    _add_metric_rows(jobs, metrics["job_pool"], ["total", "active", "created_today", "top_cities", "top_companies"])

    companies = Table(title="Company Pool")
    companies.add_column("Metric")
    companies.add_column("Value")
    _add_metric_rows(companies, metrics["company_pool"], ["distinct_companies", "companies_with_applications", "top_by_jobs", "top_by_applications"])

    ai = Table(title="AI Effect")
    ai.add_column("Metric")
    ai.add_column("Value")
    _add_metric_rows(ai, metrics["ai_effect"], ["total_scores", "avg_score", "ai_or_hybrid_scores", "rule_scores", "high_scores_80_plus", "by_type"])

    safety = Table(title="Safety Guard")
    safety.add_column("Metric")
    safety.add_column("Value")
    _add_metric_rows(safety, metrics["safety_guard"], ["total_events", "blocked_events", "blocked_today", "top_reasons"])

    flow = Table(title="Real-Time Task Flow")
    flow.add_column("created_at")
    flow.add_column("level")
    flow.add_column("message")
    flow.add_column("task")
    flow.add_column("success")
    flow.add_column("blocked")
    flow.add_column("reason")
    events = metrics["task_flow"].get("events", []) if "error" not in metrics["task_flow"] else []
    if not events:
        flow.add_row(NA, NA, NA, NA, NA, NA, NA)
    for event in events:
        flow.add_row(
            event.get("created_at", NA),
            str(event.get("level", NA)),
            str(event.get("message", NA)),
            str(event.get("task_name", NA)),
            str(event.get("success", NA)),
            str(event.get("blocked", NA)),
            str(event.get("reason", NA)),
        )

    for table in [funnel, talent, jobs, companies, ai, safety, flow]:
        console.print(table)


def render_logs() -> None:
    table = Table(title="Recent Core Logs")
    table.add_column("created_at")
    table.add_column("action")
    table.add_column("status")
    table.add_column("reason")
    table.add_column("blocked")
    table.add_column("task_name")
    for item in fetch_recent_logs(20):
        table.add_row(
            str(item["created_at"]),
            str(item["action"]),
            str(item["status"]),
            str(item["reason"]),
            str(item["blocked"]),
            str(item["task_name"]),
        )
    console.print(table)


def render_config() -> None:
    config = load_real_run_config()
    keys = [
        "daily_real_apply_limit",
        "daily_real_message_limit",
        "max_items_per_run",
        "min_action_interval_seconds",
        "min_interval_seconds",
        "random_delay_seconds",
        "random_delay_range_seconds",
        "blacklist_companies_file",
        "risk_keywords",
    ]
    table = Table(title="Safety Guard Config")
    table.add_column("Key")
    table.add_column("Value")
    for key in keys:
        if key in config:
            table.add_row(key, json.dumps(config[key], ensure_ascii=False))
    console.print(table)


def render_scheduler() -> None:
    config = load_scheduler_config()
    task_names = [
        "jobradar_search",
        "jobradar_apply",
        "recruitradar_search",
        "recruitradar_message",
    ]
    table = Table(title="Scheduler Tasks")
    table.add_column("task")
    table.add_column("enabled")
    table.add_column("cron")
    table.add_column("dry_run")
    table.add_column("limit")
    for task_name in task_names:
        task = config.get(task_name, {}) or {}
        limit = task.get("limit", task.get("apply_limit", task.get("message_limit", "")))
        table.add_row(
            task_name,
            str(task.get("enabled", False)),
            str(task.get("cron", "")),
            str(task.get("dry_run", True)),
            str(limit),
        )
    console.print(table)


def print_help() -> None:
    console.print(
        """
[bold]Commands[/bold]
  help                              Show commands
  refresh                           Refresh dashboard counts
  logs                              Show recent 20 Core logs
  ops                               Show operation dashboard metrics
  config                            Show Safety Guard config
  set <key> <value>                 Update Safety Guard config
  scheduler                         Show scheduler tasks
  scheduler enable <task_name>      Enable a scheduler task
  scheduler disable <task_name>     Disable a scheduler task
  quit                              Exit Dashboard

Dashboard cannot trigger real apply or real message actions.
"""
    )


def handle_command(command: str) -> bool:
    parts = command.strip().split()
    if not parts:
        return True

    name = parts[0].lower()
    if name == "help":
        print_help()
    elif name == "refresh":
        render_summary()
    elif name == "logs":
        render_logs()
    elif name == "ops":
        render_operation_dashboard()
    elif name == "config":
        render_config()
    elif name == "set":
        if len(parts) != 3:
            console.print("[red]Usage: set <key> <value>[/red]")
        else:
            result = apply_config_set(parts[1], parts[2], command=command)
            console.print(result.message)
    elif name == "scheduler":
        if len(parts) == 1:
            render_scheduler()
        elif len(parts) == 3 and parts[1] in {"enable", "disable"}:
            result = apply_scheduler_command(parts[1], parts[2], command=command)
            console.print(result.message)
        else:
            console.print("[red]Usage: scheduler [enable|disable] <task_name>[/red]")
    elif name == "quit":
        console.print("Dashboard exited.")
        return False
    else:
        console.print(f"[red]Unknown command: {name}. Type help.[/red]")
    return True


def main() -> None:
    console.print("[bold cyan]LakeJob Dashboard V2[/bold cyan]")
    console.print("Type help for commands. Real apply/message actions are not available here.")
    render_summary()
    render_operation_dashboard()
    while True:
        try:
            command = console.input("[bold green]dashboard> [/bold green]")
        except (KeyboardInterrupt, EOFError):
            console.print("\nDashboard exited.")
            break
        if not handle_command(command):
            break


if __name__ == "__main__":
    main()
