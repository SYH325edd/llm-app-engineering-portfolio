# LakeJob Local Development Setup

This guide prepares a Windows machine for LakeJob Core mock validation.

The goal is to run existing JobRadar + RecruitRadar flows locally. It does not add business features.

## 1. Install Python on Windows

Recommended version: Python 3.11 or 3.12.

Option A: install from the official website.

1. Open https://www.python.org/downloads/windows/
2. Download the latest Python 3.11+ installer.
3. Run the installer.
4. Check `Add python.exe to PATH`.
5. Choose `Install Now`.

Option B: install with winget.

```powershell
winget install Python.Python.3.12
```

Close and reopen PowerShell after installation.

## 2. Verify Python, pip, and py

Run:

```powershell
python --version
pip --version
py -3 --version
```

Expected result:

- `python --version` prints Python 3.10 or newer.
- `pip --version` prints a pip version.
- `py -3 --version` prints Python 3.x.

If `python.exe` opens Microsoft Store or cannot run, disable the Windows App Execution Alias:

1. Open Windows Settings.
2. Search `App execution aliases`.
3. Disable aliases for `python.exe` and `python3.exe`.
4. Reopen PowerShell.

## 3. Create a virtual environment

From the repository root:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
```

If PowerShell blocks activation:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
.\.venv\Scripts\Activate.ps1
```

## 4. Install dependencies

```powershell
pip install -r requirements.txt
```

## 5. Install Playwright browser runtime

The legacy BOSS automation uses Playwright Firefox.

```powershell
python -m playwright install firefox
```

For a full local browser set:

```powershell
python -m playwright install
```

## 6. Start PostgreSQL

Option A: local PostgreSQL installer.

1. Install PostgreSQL from https://www.postgresql.org/download/windows/
2. Start the PostgreSQL service from Windows Services.
3. Create a database named `lakejob`.

Example:

```powershell
createdb lakejob
```

Option B: Docker.

```powershell
docker run --name lakejob-postgres -e POSTGRES_PASSWORD=lakejob -e POSTGRES_DB=lakejob -p 5432:5432 -d postgres:16
```

## 7. Initialize, migrate, and seed PostgreSQL

With local PostgreSQL tools:

```powershell
$env:LAKEJOB_DATABASE_URL="postgresql://postgres:lakejob@localhost:5432/lakejob"
python scripts/db_migrate.py
python scripts/db_seed_local.py
```

If your local password or username differs, update the connection string.

`db_migrate.py` initializes an empty database from `schema.sql`, applies numbered
`migrations/*.sql` in order, and records checksums in `schema_migrations`. Re-running both
commands is safe. The local seed is draft-only: real apply and real message quotas are 0.

Do not manually zip this directory for release. Use `python scripts/make_release.py`.

## 8. Set environment variables

For the current PowerShell session:

```powershell
$env:LAKEJOB_DATABASE_URL="postgresql://postgres:lakejob@localhost:5432/lakejob"
$env:LAKEJOB_AI_API_KEY="your-api-key"
$env:OPENAI_API_KEY="your-openai-api-key"
```

Only one AI key is required. `LAKEJOB_AI_API_KEY` takes priority in the current MVP code.

For persistent user-level variables:

```powershell
setx LAKEJOB_DATABASE_URL "postgresql://postgres:lakejob@localhost:5432/lakejob"
setx LAKEJOB_AI_API_KEY "your-api-key"
setx OPENAI_API_KEY "your-openai-api-key"
```

Open a new PowerShell window after `setx`.

## 9. Check the environment

```powershell
python scripts/check_env.py
```

Required checks:

- Python version.
- Database URL.
- `psycopg` or `psycopg2`.
- Database connection.
- Playwright import.

AI key check:

- Required for JobRadar AI message generation.
- Optional for RecruitRadar because it has a fallback message.

## 10. Run mock validation commands

JobRadar mock job search:

```powershell
python jobradar_search.py Python --skills Python --limit 2
```

RecruitRadar mock candidate search:

```powershell
python recruitradar_search.py Python --job-title "Backend Engineer" --skills "Python,FastAPI" --limit 2
```

RecruitRadar message flow, after a candidate exists in Core:

```powershell
python recruitradar_msg.py <candidate-id> --message-type invite --job-title "Backend Engineer" --skills "Python,FastAPI"
```

JobRadar apply flow, after a job exists in Core:

```powershell
python jobradar_apply.py --job-id <job-id> --skills Python,FastAPI
```

## 11. Notes

- Mock fallback lives inside `BossAdapter`, not inside JobRadar or RecruitRadar business code.
- JobRadar and RecruitRadar still call `BossAdapter`.
- Real BOSS automation can replace mock fallback inside the adapter boundary later.
- `BossAutomation` still has legacy SQLite writes internally; this remains technical debt.
