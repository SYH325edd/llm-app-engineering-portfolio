# Dashboard V2 Runbook

## Start

```powershell
python dashboard.py
```

Dashboard V2 is a local console. It can view data, inspect logs, edit Safety Guard config, and enable or disable scheduler tasks. It cannot directly trigger real apply or real message actions.

## Commands

- `help`: show command list.
- `refresh`: refresh Core table counts.
- `logs`: show recent 20 Core logs.
- `config`: show Safety Guard config.
- `set <key> <value>`: update allowed Safety Guard keys.
- `scheduler`: show configured scheduler tasks.
- `scheduler enable <task_name>`: enable a task.
- `scheduler disable <task_name>`: disable a task.
- `quit`: exit safely.

## Config Examples

```text
set daily_real_apply_limit 3
set daily_real_message_limit 3
set max_items_per_run 1
set min_action_interval_seconds 90
```

Safety rules:

- Real apply and message limits cannot exceed 20.
- `max_items_per_run` cannot exceed 10.
- `min_action_interval_seconds` cannot be lower than 30.

## Logs

`logs` displays:

- `created_at`
- `action`
- `status`
- `payload.reason`
- `payload.blocked`
- `payload.task_name`

Dashboard config changes are written to Core `logs` with:

- `dashboard_action=true`
- `command`
- `before`
- `after`
- `success`

## Scheduler

Use:

```text
scheduler
scheduler enable jobradar_search
scheduler disable jobradar_apply
```

Supported tasks:

- `jobradar_search`
- `jobradar_apply`
- `recruitradar_search`
- `recruitradar_message`

Enabling apply or message tasks keeps `dry_run=true` by default. Dashboard does not start real apply or real message actions.

## Safety Limits

Dashboard V2 is intentionally not an execution surface for real BOSS actions. Real message and real apply smoke tests still require their dedicated CLI flags and confirmation phrases.
