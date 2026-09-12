# LakeJob

LakeJob is a local automation MVP for job search and recruitment workflows on BOSS. It uses a shared PostgreSQL Core, a PlatformAdapter layer, and a BOSS automation adapter so JobRadar and RecruitRadar write into the same data model.

Real BOSS Mode is experimental and not part of the stable Local MVP guarantee.

> **Release warning:** never zip the local project directory and send it to another
> person. It may contain browser profiles, cookies, login state, resumes, screenshots,
> logs, or a local database. Run `python scripts/make_release.py` and distribute only
> the generated source archive.

## Current Features

- LakeJob Core schema for jobs, candidates, match scores, applications, conversations, messages, and logs.
- JobRadar mock flow and real BOSS job search.
- RecruitRadar mock flow and real BOSS candidate search.
- BOSS QR login state reuse through `runtime/boss_auth_state.json`.
- Real Mode smoke tests for auth-only, write-db-only, dry-apply, one-message smoke, and one-apply smoke.
- Safety Guard for daily limits, per-run limits, duplicate protection, blacklist, random delay, and risk keywords.
- Configurable real-run policy in `config/real_run_config.yaml`.
- Scheduler for planned local runs using `config/scheduler.yaml`.

## Architecture

```mermaid
flowchart TD
  CLI["CLI / Scheduler"] --> JR["JobRadar"]
  CLI --> RR["RecruitRadar"]
  JR --> PA["PlatformAdapter / BossAdapter"]
  RR --> PA
  PA --> BA["BossAutomation / Playwright"]
  JR --> Core["LakeJob Core PostgreSQL"]
  RR --> Core
  SG["Safety Guard"] --> JR
  SG --> RR
  Scheduler["scheduler.py"] --> SG
```

## Directory Structure

```text
adapters/                  Platform adapters
config/                    Real-run and scheduler config
lakejobai-job-radar/       BOSS automation implementation
runtime/                   Local runtime state, ignored except .gitkeep
scripts/                   Environment and pre-push checks
schema.sql                 PostgreSQL schema
run_dual_mock_validation.py
run_real_mode_smoke_test.py
safety_guard.py
scheduler.py
```

## Requirements

- Windows with PowerShell or cmd.
- Python 3.11 or newer.
- PostgreSQL.
- A BOSS account for Real Mode.
- Optional AI key through `LAKEJOB_AI_API_KEY`.

## Installation

```powershell
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python -m playwright install
```

## PostgreSQL Setup

Create a database and user that match your local environment, then initialize, migrate,
and seed the safe local defaults:

```powershell
$env:LAKEJOB_DATABASE_URL="postgresql://lakejob_user:lakejob_pass@localhost:5432/lakejob_db"
python scripts/db_migrate.py
python scripts/db_seed_local.py
```

## Environment Variables

Copy `.env.example` into your local shell or `.env` file. Do not commit `.env`.

```powershell
$env:LAKEJOB_DATABASE_URL="postgresql://lakejob_user:lakejob_pass@localhost:5432/lakejob_db"
$env:LAKEJOB_AI_API_KEY="your_ai_key_here"
$env:LAKEJOB_REAL_RUN_CONFIG="config/real_run_config.yaml"
```

## Startup

Mock validation:

```powershell
python run_dual_mock_validation.py
```

Real Mode auth only:

```powershell
python run_real_mode_smoke_test.py --mode jobradar --keyword "Python" --real --auth-only
```

JobRadar real search dry run:

```powershell
python run_real_mode_smoke_test.py --mode jobradar --keyword "Python" --real --dry-run --limit 1
```

JobRadar write-db-only validation:

```powershell
python run_real_mode_smoke_test.py --mode jobradar --keyword "Python" --real --write-db-only --limit 1
```

JobRadar dry apply validation:

```powershell
python run_real_mode_smoke_test.py --mode jobradar --keyword "Python" --real --dry-apply --limit 1
```

One real message smoke test:

```powershell
python run_real_mode_smoke_test.py --mode jobradar --keyword "Python" --real --message-smoke --send-real --confirm-send SEND_ONE_REAL_MESSAGE
```

One real apply smoke test:

```powershell
python run_real_mode_smoke_test.py --mode jobradar --keyword "Python" --real --apply-smoke --send-real --confirm-apply APPLY_ONE_REAL_JOB
```

Scheduler:

```powershell
python scheduler.py
```

## Safety Guard

Safety Guard blocks high-risk real actions before sending or applying. Defaults include daily real apply and message limits, per-run limit, minimum interval, random delay, duplicate platform job protection, same-company daily dedupe, blacklist support, and risk keyword detection.

Edit `config/real_run_config.yaml` to adjust policy. Runtime blacklist entries live in `runtime/blacklist_companies.txt`.

Vision search results are deliberately non-actionable. A real apply or message requires a
non-`vision://` source URL, a confirmed detail timestamp and evidence, an action-specific
permission flag, an exact confirmation phrase, SafetyGuard approval, QuotaPolicy approval,
and an audit record. The local seed sets both real-action quotas to zero.

## Tests and release

```powershell
python -m compileall .
python -m pytest -q
python scripts/pre_push_check.py
python scripts/make_release.py
```

## Scheduler

`scheduler.py` checks `config/scheduler.yaml` once per minute. It records task state in `runtime/scheduler_state.json` and writes local events to `runtime/scheduler.log`. Runtime files are ignored by Git.

## FAQ

Why does Real Mode need manual login? BOSS requires QR login and may trigger verification. The project saves local auth state after the first successful login.

Why are runtime files ignored? They may contain login state, screenshots, debug HTML, or local execution state.

Can this run unattended at high volume? No. The MVP intentionally keeps Safety Guard limits low and requires explicit confirmation for real smoke actions.

## Risk Statement

Real Mode interacts with a third-party platform. Use only low-frequency tests, respect platform rules, and stop immediately if verification, risk-control, or access-limit messages appear.
