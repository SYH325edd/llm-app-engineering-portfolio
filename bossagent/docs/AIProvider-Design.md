# AI Provider Design

## Goal

LakeJob now has a unified AI Provider layer for Resume Center, JobRadar, and RecruitRadar.

The provider layer avoids hard-coding DeepSeek into business modules. Business code calls a common interface and can run against either a local Mock provider or DeepSeek.

## Architecture

```text
Resume Center
JobRadar
RecruitRadar
    |
    v
ai.provider.get_ai_provider()
    |
    +-- MockAIProvider
    +-- DeepSeekProvider
```

## Interface

`AIProvider` defines:

- `parse_resume(text: str) -> dict`
- `summarize_resume(parsed: dict, raw_text: str) -> dict`
- `score_candidate(candidate: dict, job_profile: dict | None = None) -> dict`
- `score_job(job: dict, user_profile: dict | None = None) -> dict`
- `generate_message(context: dict) -> str`
- `health_check() -> dict`

## Mock Provider

`MockAIProvider` is the default.

It does not call any external API. It is deterministic and safe for tests, local validation, and dry-run workflows.

Resume parsing and summary generation reuse the existing rule-based Resume Center functions.

## DeepSeek Provider

`DeepSeekProvider` uses the OpenAI-compatible DeepSeek chat completions endpoint.

Environment variables:

```text
DEEPSEEK_API_KEY=your_deepseek_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

Defaults:

- `DEEPSEEK_BASE_URL=https://api.deepseek.com`
- `DEEPSEEK_MODEL=deepseek-chat`
- timeout: 30 seconds

If `ai.provider=deepseek` and no API key exists, provider creation returns a clear error. The key is never printed.

## Configuration

`config/real_run_config.yaml`:

```yaml
ai:
  provider: mock
  model: deepseek-chat
  base_url: https://api.deepseek.com
```

Supported providers:

- `mock`
- `deepseek`

## Prompts

`ai/prompts.py` centralizes prompts for:

- resume parsing
- resume summary
- candidate scoring
- job matching
- communication message generation

Prompts require JSON output and avoid exaggerated claims.

## Resume Center Integration

Resume Center calls:

- `provider.parse_resume(raw_text)`
- `provider.summarize_resume(parsed, raw_text)`

Rule scoring remains local and auditable. If DeepSeek fails, Web upload shows the error instead of crashing.

## JobRadar Integration

`jobradar_ai_msg.py` calls:

- `provider.generate_message(context)`

If provider generation fails, JobRadar falls back to a short local template.

## RecruitRadar Integration

`recruitradar_score.py` calls:

- `provider.score_candidate(candidate, requirements)`

If provider scoring fails, RecruitRadar falls back to the existing rule score.

## Safety Limits

This step does not:

- trigger Boss automation
- send real messages
- apply to jobs
- modify `schema.sql`
- print API keys

DeepSeek is only used when explicitly configured and keyed.

## Future Improvements

- Add JSON schema validation for provider responses.
- Add retry/backoff for transient API failures.
- Add provider-level usage logs.
- Add Web Console provider health display.
- Add prompt versioning and evaluation sets.
