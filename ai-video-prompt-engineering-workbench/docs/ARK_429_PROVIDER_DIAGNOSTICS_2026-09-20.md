# Ark 429 Provider Diagnostics — 2026-09-20

## 问题

真实运行在第一个 `story_bible` Unit 即暂停：

- HTTP: 429
- 原分类: `provider_rate_limited`
- transport attempts: 6

这不是 Story Bible Schema/Prompt 校验失败。请求在模型输出产生之前就被 Ark Provider 拒绝。

## 找到的 Provider 适配器缺陷

旧实现存在两个问题：

1. 所有 429 都被统一分类为 `provider_rate_limited`，没有区分 TPM、RPM、Quota、Burst、Overload、ModelLoading。
2. `_stream_once()` 在 `response.raise_for_status()` 后让异常离开 streaming context；外层再读取 response body 时 stream 已关闭，因此 Ark 返回的结构化错误 JSON 可能被丢失，UI 最终只能看到 `HTTP 429`。

这解释了为什么此前无法判断 6 次 429 到底属于哪一种 Provider 限制。

## 本次修复

Provider 现在在关闭 stream 前缓存错误 body，并解析：

- `error.code`
- `error.message`
- `x-request-id` / request id
- `Retry-After`

429 被拆分为：

- `provider_quota_exhausted` — `QuotaExceeded`，不可重试
- `provider_tpm_rate_limited` — TPM 超限
- `provider_rpm_rate_limited` — RPM 超限
- `provider_request_burst` — `RequestBurstTooFast`
- `provider_server_overloaded` — `ServerOverloaded`
- `provider_model_loading` — `ModelLoadingError`
- `provider_rate_limited` — 未识别的兜底 429

RPM/TPM 不再做 2/4/8/16/30 秒的密集盲重试。没有 `Retry-After` 时等待一个 60 秒窗口，只做一次恢复尝试；再次失败即暂停并保留精确 Provider 原因。`QuotaExceeded` 第一次即停止。

## Runtime/UI

Run error、failure history、Unit attempt 现在保留并展示：

- provider_code
- provider_message
- request_id
- retry_after_seconds
- transport_attempts

因此下一次真实 Ark 429 可以直接判断是配额、TPM、RPM、突发保护还是服务端负载。

## 验证

- 结构化 429 body 在 stream 关闭前可读取：通过
- `QuotaExceeded`：只请求 1 次，标记不可恢复：通过
- `RateLimitExceeded.EndpointTPMExceeded`：按窗口只恢复 1 次，保留精确错误：通过
- Runtime Provider 元数据持久化：通过
- 全量 pytest：336 tests passed
- `node --check apps/web/app.js`：通过
- `python -m compileall apps runtime packages`：通过

## 仍需真实账号验证的内容

本地包不包含真实 `ARK_API_KEY`，因此无法替用户判断当前这一次历史 429 的具体 Ark code。旧实现已经丢失该 response body，无法事后恢复。使用本修复版再发起一次请求后，页面会显示原始 Ark code/message/request id，届时可以准确区分根因。
