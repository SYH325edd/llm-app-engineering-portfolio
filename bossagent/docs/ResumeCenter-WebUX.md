# Resume Center Web UX

## Upload Page

`/resumes/upload` now shows the current parsing mode before the user uploads a resume:

- `当前解析模式：Mock AI`
- `当前解析模式：DeepSeek`

It also shows only whether `DEEPSEEK_API_KEY` is configured:

- `已配置`
- `未配置`

The page never displays the API key value.

If `provider=deepseek` but `DEEPSEEK_API_KEY` is missing, the upload page shows a yellow warning:

```text
当前已选择 DeepSeek，但未配置 DEEPSEEK_API_KEY，上传后将自动回退到规则解析。
```

The upload button text is:

```text
上传并分析简历
```

After upload succeeds, the user is redirected to the resume detail page.

## Detail Page Status

`/resumes/{id}` shows a top status card group:

- AI Provider
- AI Parse Status
- Fallback Used
- Score

If `fallback_used=true`, the page shows:

```text
AI解析失败，系统已使用规则解析完成候选人画像。
```

If `ai_parse_status=success`, the page shows:

```text
AI解析成功。
```

If an AI error exists, the page shows a short error summary. API keys and sensitive environment values are not displayed.

## Resume List

`/resumes` supports filters:

- provider: `all`, `mock`, `deepseek`, `fallback_rule`
- status: `all`, `success`, `failed`, `fallback`

List columns:

- 文件名
- 候选人
- 城市
- 目标岗位
- 评分
- AI Provider
- AI Status
- Fallback
- 上传时间

## AI Settings Relationship

`/ai-settings` explains how Resume Center will use the selected provider:

- Mock: 本地规则与模拟画像
- DeepSeek: 真实 AI 解析，失败自动 fallback

The selected provider is stored in `config/real_run_config.yaml`.

## Safety Limits

Resume Center Web UX does not:

- trigger Boss automation
- send real messages
- apply to jobs
- modify `schema.sql`
- display API keys
- read or display `.env`

It only improves how parsing mode, status, fallback, and results are shown to users.
