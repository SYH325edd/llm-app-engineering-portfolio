# Job Flow Design

## 定位

Job Flow 是 Web Console 中的求职端主流程页面，目标是从求职画像出发，完成岗位搜索、岗位评分、A/B/C 分级，并把结果写入岗位池。

本步骤不做真实投递，不发送真实消息，不修改数据库结构。

## 调用链

```text
Web Console /job
  -> job_flow.load_jobseeker_profile_for_flow()
  -> profile_center.profile_to_candidate_context()
  -> mock jobs 或 JobRadar search-only
  -> jobradar_log.upsert_job()
  -> jobradar_search.score_job_ai_first()
  -> jobradar_log.add_match_score()
  -> jobradar_log.log_event()
```

## 页面流程

`/job` 展示当前求职画像摘要：

- 姓名
- 目标岗位
- 目标城市
- 期望薪资
- 技能
- 项目经历

搜索表单包括：

- `keyword`
- `city`
- `skills`
- `limit`
- `mode`: `mock` / `real`
- `dry_run`

默认：

- `mode=mock`
- `dry_run=true`
- `limit=1`

## 执行逻辑

`POST /job/run` 会执行：

1. 读取 `config/profiles/jobseeker_profile.yaml`。
2. 构造求职者画像上下文。
3. `mode=mock` 时生成本地 mock jobs。
4. `mode=real` 时调用现有 JobRadar 搜索逻辑。
5. 强制 `dry_run=true`。
6. 强制 `auto_apply=false`。
7. 写入 `jobs`。
8. 写入 `match_scores`。
9. 写入 `logs`。

## 岗位分级

- `score >= 85`：A级岗位
- `70 <= score < 85`：B级岗位
- `score < 70`：C级岗位

## 日志字段

logs payload 包含：

```json
{
  "job_flow": true,
  "action": "run_job_search",
  "profile_name": "",
  "keyword": "",
  "city": "",
  "skills": "",
  "limit": 1,
  "mode": "mock",
  "dry_run": true,
  "jobs_found": 1,
  "jobs_saved": 1,
  "success": true
}
```

## 安全限制

Job Flow 不允许：

- 真实投递
- 真实消息
- 批量投递
- 绕过 Safety Guard

Real 模式只允许岗位搜索，不允许 `auto_apply`。

## 后续方向

- 将岗位结果详情页与岗位池联动。
- 增加岗位收藏、拒绝、已申请等状态管理。
- 后续如扩展真实投递，必须继续走 Safety Guard 和确认短语。
