# DeepSeek Live Test

## Purpose

`test_deepseek_live.py` verifies that `DeepSeekProvider` can make one safe live API call when a real API key is configured.

The script does not touch Boss automation, Resume Center, JobRadar, RecruitRadar, PostgreSQL, messages, applications, or schema.

## Environment Variables

PowerShell:

```powershell
$env:DEEPSEEK_API_KEY="your_real_deepseek_key"
$env:DEEPSEEK_BASE_URL="https://api.deepseek.com"
$env:DEEPSEEK_MODEL="deepseek-chat"
```

Only `DEEPSEEK_API_KEY` is required. `DEEPSEEK_BASE_URL` and `DEEPSEEK_MODEL` have defaults.

## Run

```powershell
python test_deepseek_live.py
```

## Success Output

```text
PASSED DeepSeek live test
message: 您好，我对AI视频设计师岗位很感兴趣，有AI视频、剪辑和提示词相关经验，想进一步了解岗位要求。
```

The generated message must be Chinese and no longer than 100 characters.

## SKIPPED Meaning

If `DEEPSEEK_API_KEY` is not configured, the script prints:

```text
SKIPPED: DEEPSEEK_API_KEY not configured
```

and exits with code `0`. This is expected in local or CI environments without a live key.

## Failure Output

If DeepSeek returns an error, invalid JSON, an empty message, or a message longer than 100 characters, the script prints:

```text
FAILED: <reason>
```

## Safety

The script never prints the API key, never saves it, never writes the database, and never triggers any real recruitment automation.
