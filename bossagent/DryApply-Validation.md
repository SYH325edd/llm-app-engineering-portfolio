# Dry Apply Validation

## Dry Apply 目标

验证 JobRadar 在真实 BOSS 岗位搜索之后，可以在不真实投递、不真实发送消息的前提下，把完整数据链路写入 LakeJob Core。

链路：

真实搜索岗位 -> 写入 jobs -> 写入 match_scores -> 创建 applications -> 创建 conversations -> 写入 messages -> 写入 logs

## 不会真实发送的保护点

- `--dry-apply` 强制 `dry_run=True`。
- `--dry-apply` 强制 `limit=1`。
- `--dry-apply` 禁止和 `--send-real` 同时使用。
- `--dry-apply` 不调用 `BossAdapter.apply_to_job()`。
- `--dry-apply` 不调用 `BossAutomation.send_message()`。
- 写入的 message 状态为 `draft`。
- 写入的 application 状态为 `draft`，因为当前 schema 不允许 `dry_applied`。
- logs payload 中记录 `dry_apply=true` 和 `real_send=false`。

## 写入哪些表

- `jobs`: 写入真实搜索解析出的 1 条岗位。
- `match_scores`: 每个写入岗位生成 1 条规则评分。
- `applications`: 为岗位创建 1 条 JobRadar 草稿投递记录。
- `conversations`: 为投递创建 1 条关联 job/application 的会话。
- `messages`: 为会话写入 1 条 outbound draft 首句消息。
- `logs`: 写入 1 条 Dry Apply 验证日志。

## 运行命令

```powershell
python run_real_mode_smoke_test.py --mode jobradar --keyword "Python" --real --dry-apply --limit 1
```

## 预期输出

```json
{
  "real_messages_sent": false,
  "search_results": 1,
  "jobs_written": 1,
  "match_scores_written": 1,
  "applications_written": 1,
  "conversations_written": 1,
  "messages_written": 1,
  "logs_written": 1
}
```

## 当前技术债

- `applications.status` 当前 schema 不支持 `dry_applied`，Dry Apply 使用 `draft`，并通过 logs payload 标记 `dry_apply=true`。
- smoke test 使用规则评分验证数据库链路，不代表生产 AI 匹配质量。
- draft message 的 `sent_at` 由现有 Core helper 写入当前时间，后续如需严格区分草稿时间和真实发送时间，应调整 Core helper 或 schema。
