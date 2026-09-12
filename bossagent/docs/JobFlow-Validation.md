# Job Flow Validation

## 测试环境

本次验收验证 Job Flow 在本地 PostgreSQL 环境中的完整数据库链路。

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

如果本地没有求职画像，测试会创建测试画像：

```yaml
profile_name: 测试求职画像
name: 测试用户
target_job_title: AI视频设计师
target_city: 杭州
expected_salary: 8-15K
skills: AI视频,剪辑,Prompt,内容运营
education: 本科
project_experience: AI视频生成平台、提示词优化、短视频内容自动化
```

模拟 `POST /job/run` 参数：

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
test_job_flow_db.py
```

执行逻辑：

1. 检查 DB URL。
2. 创建或复用求职画像。
3. 通过 FastAPI `TestClient` 模拟 `POST /job/run`。
4. 使用 mock/dry_run 岗位生成。
5. 执行岗位评分。
6. 执行 A/B/C 分级。
7. 写入 `jobs`。
8. 写入 `match_scores`。
9. 写入 `logs`。
10. 验证 `/jobs` 岗位池页面返回 `200`。
11. 验证页面不崩溃。

## 写入表

本次 DB 验收写入：

- `jobs`
- `match_scores`
- `logs`

Job Flow 日志 payload 包含：

```json
{
  "job_flow": true,
  "action": "run_job_search",
  "profile_name": "",
  "keyword": "AI视频",
  "city": "杭州",
  "skills": "AI视频,剪辑,Prompt",
  "limit": 3,
  "mode": "mock",
  "dry_run": true,
  "jobs_found": 3,
  "jobs_saved": 3,
  "success": true
}
```

## 验证结果

本地 DB 实测输出：

```json
{
  "status": "PASSED",
  "job_delta": 3,
  "match_score_delta": 3,
  "job_flow_log_delta": 1,
  "job_pool_status": 200
}
```

检查项：

- `jobs` 新增 `3` 条：通过。
- `match_scores` 新增 `3` 条：通过。
- `logs` 新增 `job_flow=true` 记录：通过。
- 返回结果包含 A/B/C 分级：通过。
- `/jobs` 岗位池页面返回 `200`：通过。
- 页面不崩溃：通过。
- 无 DB URL 时输出 SKIPPED：通过。

## 已知限制

- 本步骤只验证 mock/dry_run 求职主流程。
- 不触发真实 BOSS。
- 不发送真实消息。
- 不真实投递。
- Real 模式仍只允许岗位搜索，不允许 auto apply。

## 最终结论

PASSED
