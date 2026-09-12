# Recruit Flow Design

## 定位

Recruit Flow 是 Web Console 中的招聘端主流程页面，目标是把招聘画像、候选人搜索、AI/规则评分、A/B/C 分级和 Talent Pool 状态管理串成一条本地可操作链路。

本步骤不做真实消息发送，不做真实投递，不修改数据库结构。

## 调用链

```text
Web Console /recruit
  -> recruit_flow.load_recruit_profile()
  -> profile_center.profile_to_job_context()
  -> mock candidates 或 RecruitRadar search-only
  -> recruitradar_log.upsert_candidate()
  -> recruitradar_score.score_candidate_ai_first()
  -> recruitradar_log.add_match_score()
  -> talent_pool.update_candidate_status("matched")
  -> recruitradar_log.log_event()
```

## 页面流程

`/recruit` 展示当前招聘画像摘要：

- 画像名称
- 公司名称
- 招聘岗位
- 城市
- 薪资范围
- 核心技能
- 经验要求
- 学历要求

搜索表单包括：

- 搜索关键词
- 城市
- 技能
- 数量限制
- 运行模式：Mock / Real
- Dry Run

默认配置：

- `mode=mock`
- `dry_run=true`
- `limit=1`

## 执行逻辑

`POST /recruit/run` 会执行以下步骤：

1. 读取 `config/profiles/recruiter_profile.yaml`。
2. 构造 `job_profile`。
3. `mode=mock` 时生成本地 mock candidates。
4. `mode=real` 时只调用 RecruitRadar 搜索逻辑，并强制不发送消息。
5. 对候选人执行 AI-first 评分，失败时沿用现有规则 fallback。
6. 写入 `candidates`。
7. 写入 `match_scores`。
8. 写入 logs。
9. 写入 Talent Pool 状态事件：`matched`。

## 候选人分级

- `score >= 85`：A级
- `70 <= score < 85`：B级
- `score < 70`：C级

## 结果页

`recruit_flow_results.html` 展示：

- 搜索数量
- 入库数量
- A/B/C 候选人数量
- 运行模式
- Dry Run 状态
- 候选人列表
- Talent Pool 详情入口

## 日志字段

logs payload 包含：

```json
{
  "recruit_flow": true,
  "action": "run_candidate_search",
  "profile_name": "",
  "keyword": "",
  "city": "",
  "skills": "",
  "limit": 1,
  "mode": "mock",
  "dry_run": true,
  "candidates_found": 1,
  "candidates_saved": 1,
  "success": true
}
```

## 安全限制

Recruit Flow 不提供以下能力：

- 真实发送消息
- 真实投递
- 批量群发
- 绕过 Safety Guard

Real 模式只允许候选人搜索，不允许 auto-message。

## 后续方向

- 将招聘画像与 AI Provider 更深度结合，用于技能提取和筛选规则生成。
- 增加结果筛选与批量标注，但真实消息仍需 Safety Guard 和确认短语。
- 后续如升级 schema，可把 Talent Pool 状态从 logs 事件源迁移到专用状态表。
