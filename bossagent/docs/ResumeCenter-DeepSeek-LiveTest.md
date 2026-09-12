# Resume Center DeepSeek Live Test

## Purpose

`test_resume_deepseek_live.py` validates that Resume Center can safely parse one resume with a real DeepSeek API key, or safely fall back to local rule parsing if DeepSeek fails.

It does not trigger Boss automation, JobRadar, RecruitRadar, real messages, or real applies.

## Preparation

Make sure the database environment is configured if you want the test to write Core records:

```powershell
$env:LAKEJOB_DATABASE_URL="postgresql://lakejob_user:lakejob_pass@localhost:5432/lakejob_db"
```

Set DeepSeek credentials:

```powershell
$env:DEEPSEEK_API_KEY="your_real_deepseek_key"
$env:DEEPSEEK_BASE_URL="https://api.deepseek.com"
$env:DEEPSEEK_MODEL="deepseek-chat"
```

Only `DEEPSEEK_API_KEY` is required. Base URL and model have defaults.

## Run

```powershell
python test_resume_deepseek_live.py
```

The script creates:

```text
runtime/test_resume_deepseek_live.txt
```

and temporarily forces Resume Center to use `DeepSeekProvider` without changing `config/real_run_config.yaml`.

## SKIPPED Result

If `DEEPSEEK_API_KEY` is not configured:

```text
SKIPPED: DEEPSEEK_API_KEY not configured
```

The script exits with code `0`.

## Success Result

If DeepSeek returns valid JSON and Resume Center writes Core records:

```json
{
  "status": "PASSED",
  "ai_provider": "deepseek",
  "ai_parse_status": "success",
  "fallback_used": false,
  "candidate_id": "...",
  "score": 85,
  "error": ""
}
```

## Fallback Result

If DeepSeek fails but Resume Center safely falls back:

```json
{
  "status": "PASSED",
  "ai_provider": "fallback_rule",
  "ai_parse_status": "fallback",
  "fallback_used": true,
  "candidate_id": "...",
  "score": 70,
  "error": "DeepSeek response was not valid JSON"
}
```

Fallback is considered safe and valid as long as `candidates` and `logs` are written.

## Safety

The script never prints or saves the API key. It only reads the key from environment variables.

It does not:

- trigger Boss automation
- send real messages
- apply to jobs
- call JobRadar or RecruitRadar
- modify `schema.sql`
- permanently change `config/real_run_config.yaml`
