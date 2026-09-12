# Local Control Center Design

## Why Local First

LakeJob is still a local operator tool. The priority is to make local workflows visible and controllable before adding deployment, packaging, licensing, or SaaS administration.

Local Control Center gives users one Web Console page to see configuration, run safe one-off commands, and inspect the last result.

## Page Structure

`/control` contains four blocks:

- JobRadar
- RecruitRadar
- Resume Center
- System

The page uses the current FastAPI + Jinja2 + Tailwind CDN stack. No React or external admin framework is introduced.

## JobRadar Controls

Fields:

- enabled
- mode: `mock` or `real`
- dry_run
- allow_real_apply
- keyword
- city
- skills
- limit

Buttons:

- save config
- run one search
- run Dry Apply
- run real apply smoke test

Safety:

- default mode is `mock`
- default `dry_run=true`
- limit is forced to `1`
- real apply requires `APPLY_ONE_REAL_JOB`
- real apply uses the existing `run_real_mode_smoke_test.py` path

## RecruitRadar Controls

Fields:

- enabled
- mode: `mock` or `real`
- dry_run
- allow_real_message
- keyword
- city
- skills
- limit

Buttons:

- save config
- run candidate search
- run candidate score
- enter Talent Pool

Safety:

- default mode is `mock`
- default `dry_run=true`
- limit is forced to `1`
- real message requires `SEND_ONE_REAL_MESSAGE`
- Safety Guard is not bypassed

## Resume Center Controls

Displays:

- current AI Provider
- DeepSeek key status
- recent uploaded resumes
- successful parses
- fallback count

Links:

- upload resume
- AI Settings
- Resumes

## System Controls

Displays:

- Safety Guard status
- Scheduler status
- today's real applies / limit
- today's real messages / limit
- min interval
- random delay
- BOSS auth state existence
- DB availability
- AI Provider availability

Links:

- Config
- Scheduler
- Logs
- Profiles

## Configuration

Saved at:

```text
config/local_control.yaml
```

Last run result:

```text
runtime/local_control_last_run.json
```

## Running Commands

Control Center uses `subprocess.run()` with a 120 second timeout and captures stdout/stderr summaries.

It calls existing scripts instead of implementing automation:

- `run_real_mode_smoke_test.py`
- `recruitradar_search.py`
- `recruitradar_score.py`
- `test_resume_center.py`

## Safety Limits

Control Center does not:

- display API keys
- display `.env`
- display `boss_auth_state.json` contents
- bypass Safety Guard
- batch real apply
- batch real messages
- allow real action limit above 1

## Future Deployment

If LakeJob later adds deployment, this page can become the local operator surface behind authentication. The current design keeps deployment concerns out of the MVP.
