# Web Console V1 Runbook

## Start

```powershell
python web_console.py
```

The process prints:

```text
LakeJob Web Console running at http://localhost:8000
```

Open:

```text
http://localhost:8000
```

## Pages

- `/`: dashboard with today's searches, applications, messages, new candidates, Safety Guard blocks, real apply/message usage against limits, and recent task flow.
- `/jobs`: job pool with title, company, city, salary, match score, status, and created time. Supports keyword, city, and company filters.
- `/candidates`: talent pool with name, city, skills, score, status, and created time.
- `/logs`: recent 100 Core logs with action, status, payload, reason, and blocked state.
- `/config`: Safety Guard config editor.
- `/scheduler`: scheduler task editor.

## Config Edits

`/config` reads and writes `config/real_run_config.yaml`.

Validation:

- `daily_real_apply_limit <= 20`
- `daily_real_message_limit <= 20`
- `max_items_per_run <= 10`
- `min_action_interval_seconds >= 30`
- `random_delay_seconds` must be two integers such as `30,90`

Every successful or failed config update writes Core `logs` with:

- `web_console=true`
- `action`
- `before`
- `after`
- `success`

## Scheduler Edits

`/scheduler` reads and writes `config/scheduler.yaml`.

It can edit:

- `enabled`
- `cron`
- `dry_run`
- `limit`

This page only changes configuration. It does not execute scheduled tasks.

## Safety Limits

Web Console V1 does not provide buttons or routes for:

- real apply
- real message
- Boss browser automation
- schema changes

It also does not display:

- AI keys
- `boss_auth_state.json`
- `.env` contents

## FAQ

If the dashboard shows empty tables, confirm `LAKEJOB_DATABASE_URL` points to the local LakeJob PostgreSQL database and that `schema.sql` has been imported.

If config saves fail, check file permissions for the `config/` directory.

If the server cannot start, install dependencies:

```powershell
pip install -r requirements.txt
```
