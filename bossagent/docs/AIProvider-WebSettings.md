# AI Provider Web Settings

## Page Entry

Open:

```text
http://localhost:8000/ai-settings
```

The Web Console menu includes `AI Settings`.

## Config Items

The page displays and edits:

- `provider`: `mock` or `deepseek`
- `model`: default `deepseek-chat`
- `base_url`: default `https://api.deepseek.com`
- `DEEPSEEK_API_KEY` status: `已配置` or `未配置`

The API key value is never displayed.

## API Key Setup

Set the key through the environment:

```powershell
$env:DEEPSEEK_API_KEY="your_real_key"
$env:DEEPSEEK_BASE_URL="https://api.deepseek.com"
$env:DEEPSEEK_MODEL="deepseek-chat"
```

Do not save API keys in `config/real_run_config.yaml`.

## Save Logic

Saving AI settings updates only:

```yaml
ai:
  provider: mock
  model: deepseek-chat
  base_url: https://api.deepseek.com
```

All other real-run config fields are preserved.

The save action writes Core `logs` with:

```json
{
  "web_console": true,
  "ai_settings": true,
  "action": "save_ai_settings",
  "provider": "mock",
  "success": true,
  "error": ""
}
```

## Test Logic

`POST /ai-settings/test` calls `get_ai_provider().health_check()`.

- `provider=mock`: returns local mock OK.
- `provider=deepseek` without `DEEPSEEK_API_KEY`: returns a clear missing-key error.
- `provider=deepseek` with `DEEPSEEK_API_KEY`: returns DeepSeek provider health.

The test action writes Core `logs` with:

```json
{
  "web_console": true,
  "ai_settings": true,
  "action": "test_ai_settings",
  "provider": "deepseek",
  "success": false,
  "error": "DEEPSEEK_API_KEY is required"
}
```

## Safety

The page does not:

- display API keys
- save API keys to YAML
- read `.env` contents
- trigger Boss automation
- send real messages
- apply to jobs
- modify `schema.sql`
