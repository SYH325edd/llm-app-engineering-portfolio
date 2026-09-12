# Recruit Flow Validation

## 测试环境

本次验收目标是验证 Recruit Flow 在本地 PostgreSQL 环境中的完整数据库链路。

使用数据库：

```text
LAKEJOB_DATABASE_URL=postgresql://lakejob_user:lakejob_pass@localhost:5432/lakejob_db
```

如果当前 shell 没有配置 `LAKEJOB_DATABASE_URL`，测试脚本会输出：

```text
SKIPPED: LAKEJOB_DATABASE_URL not configured
```

并以退出码 `0` 结束。

## 测试输入

如果本地没有招聘画像，测试会创建测试画像：

```yaml
profile_name: 测试招聘画像
company_name: LakeJob测试公司
job_title: AI视频运营
city: 杭州
salary_range: 8-15K
core_skills: AI视频,剪辑,Prompt,内容运营
experience_requirement: 1-3年
education_requirement: 本科
```

模拟 `POST /recruit/run` 参数：

```text
keyword=AI视频
city=杭州
skills=AI视频,剪辑,Prompt
limit=3
mode=mock
dry_run=true
```

## 测试流程

测试脚本：

```text
test_recruit_flow_db.py
```

执行逻辑：

1. 检查 DB URL。
2. 创建或复用招聘画像。
3. 通过 FastAPI `TestClient` 模拟 `POST /recruit/run`。
4. 使用 mock/dry_run 候选人生成。
5. 执行 AI-first 评分。
6. 执行 A/B/C 分级。
7. 写入 `candidates`。
8. 写入 `match_scores`。
9. 写入 `logs`。
10. 写入 Talent Pool 状态事件 `matched`。
11. 验证页面不崩溃。

## 写入表

本次 DB 验收写入：

- `candidates`
- `match_scores`
- `logs`

并通过 `logs` 事件源记录 Talent Pool 状态：

```json
{
  "talent_pool": true,
  "action": "update_status",
  "new_status": "matched"
}
```

Recruit Flow 日志 payload 包含：

```json
{
  "recruit_flow": true,
  "action": "run_candidate_search",
  "profile_name": "",
  "keyword": "AI视频",
  "city": "杭州",
  "skills": "AI视频,剪辑,Prompt",
  "limit": 3,
  "mode": "mock",
  "dry_run": true,
  "candidates_found": 3,
  "candidates_saved": 3,
  "success": true
}
```

## 验证结果

本地 DB 实测输出：

```json
{
  "status": "PASSED",
  "candidate_delta": 3,
  "match_score_delta": 3,
  "recruit_flow_log_delta": 1,
  "matched_count": 3
}
```

检查项：

- `candidates` 新增 `3` 条：通过。
- `match_scores` 新增 `3` 条：通过。
- `logs` 新增 `recruit_flow=true` 记录：通过。
- 返回结果包含 A/B/C 分级：通过。
- Talent Pool 可读取 `matched` 状态：通过。
- 页面不崩溃：通过。
- 无 DB URL 时输出 SKIPPED：通过。

## 修复项

验收时发现 Mock AI Provider 可能返回：

```text
score_type=mock
```

但 Core schema 的 `match_scores.score_type` 只允许：

```text
manual / rule / ai / hybrid
```

已在 `recruit_flow.py` 中做最小修复：写入 `match_scores` 前将非法 `score_type` 归一化为 `rule`。

## 已知限制

- 本步骤只验证 mock/dry_run 招聘主流程。
- 不触发真实 BOSS。
- 不发送真实消息。
- 不真实投递。
- Real 模式仍只允许搜索，不允许 auto-message。

## 最终结论

PASSED
