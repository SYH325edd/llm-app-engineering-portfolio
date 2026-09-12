# Resume Center DeepSeek Integration

## Flow

Resume Center remains safe by default:

```yaml
ai:
  provider: mock
```

When configured as:

```yaml
ai:
  provider: deepseek
  model: deepseek-chat
  base_url: https://api.deepseek.com
```

and `DEEPSEEK_API_KEY` is present, upload flow becomes:

1. Read resume text locally.
2. Call `AIProvider.parse_resume(text)`.
3. Call `AIProvider.summarize_resume(parsed, raw_text)`.
4. Generate local rule score.
5. Write `candidates`.
6. Write `logs`.
7. Display result in Web Console.

## Fallback Mechanism

DeepSeek output must be JSON. If DeepSeek returns non-JSON, returns an invalid shape, times out, or raises any error:

1. Resume Center catches the error.
2. It falls back to local rule parsing.
3. It falls back to local summary generation.
4. It still writes `candidates`.
5. It still writes `logs`.
6. The page shows: `AI解析失败，已使用规则解析`.

No upload should fail only because DeepSeek failed.

## Page Fields

Resume detail displays:

- AI Provider: `mock`, `deepseek`, or `fallback_rule`
- AI Parse Status: `success` or `fallback`
- Fallback Used
- AI error reason, when present
- structured fields
- candidate profile
- strengths
- risks
- recommended directions
- tags
- score

Resume list displays:

- AI Provider
- AI Parse Status

## Log Fields

Resume upload logs include:

```json
{
  "resume_center": true,
  "ai_provider": "deepseek",
  "ai_parse_status": "success",
  "ai_parse_error": "",
  "fallback_used": false,
  "candidate_id": "",
  "score": 0
}
```

Fallback logs include:

```json
{
  "ai_provider": "fallback_rule",
  "ai_parse_status": "fallback",
  "ai_parse_failed": true,
  "fallback_used": true,
  "ai_parse_error": "DeepSeek response was not valid JSON"
}
```

## Safety

This integration does not:

- trigger Boss automation
- send real messages
- apply to jobs
- modify `schema.sql`
- print or store API keys

DeepSeek API keys are read only from environment variables.

## Test

`test_resume_deepseek_mock.py` uses fake providers and does not call real DeepSeek.

It validates:

- success
- fallback on non-JSON
- fallback on exception

Each case must write candidates and logs without crashing.
