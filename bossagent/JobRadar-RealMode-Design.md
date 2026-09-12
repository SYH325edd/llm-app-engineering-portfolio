# JobRadar Real Mode Design

## 新增能力

- BOSS 求职端登录状态检测。
- BOSS 求职端真实岗位搜索。
- 岗位卡片抓取与 Core-shaped Job 映射。
- 岗位详情抓取。
- AI-first 岗位匹配评分，无 AI key 时 fallback 到规则评分。
- 匹配分写入 `match_scores`。
- 可选自动投递首句。
- `dry_run` 下只写 LakeJob Core 记录，不真实发送到 BOSS。

## 调用链

```text
JobRadar CLI
  -> jobradar_search.py / jobradar_apply.py
  -> PlatformAdapter contract
  -> BossAdapter
  -> BossAutomation
  -> BOSS 求职端页面
```

JobRadar 不直接 import `BossAutomation`。

## 数据流

```text
BOSS 岗位搜索页
  -> BossAutomation.search_jobs_real()
  -> BossAdapter.search_jobs()
  -> boss_job_to_core()
  -> jobradar_search.filter_jobs()
  -> jobradar_log.upsert_job()
  -> score_job_ai_first()
  -> jobradar_log.add_match_score()
  -> optional jobradar_apply.apply_jobs()
  -> applications / conversations / messages / logs
```

## 命令行使用示例

```powershell
python jobradar_search.py "AI视频设计师" --city "杭州" --skills "剪辑,AI视频,提示词" --limit 5
```

只写库不真实发送：

```powershell
python jobradar_search.py "AI视频设计师" --city "杭州" --skills "剪辑,AI视频,提示词" --limit 5 --auto-apply --apply-limit 1 --dry-run
```

真实发送首句：

```powershell
python jobradar_search.py "AI视频设计师" --city "杭州" --skills "剪辑,AI视频,提示词" --limit 5 --auto-apply --apply-limit 1
```

允许 mock fallback：

```powershell
python jobradar_search.py "AI视频设计师" --city "杭州" --skills "剪辑,AI视频,提示词" --limit 5 --allow-mock
```

## dry_run 与真实发送区别

- `dry_run=True`：创建 `applications`、`conversations`、`messages`、`logs`，message 状态为 `draft`，application 状态为 `draft`，不打开 BOSS 沟通入口，不发送消息。
- `dry_run=False`：通过 `BossAdapter.apply_to_job()` 打开 BOSS 岗位沟通入口并发送首句，随后写入发送结果。

## allow_mock 与真实模式区别

- `allow_mock=False`：真实模式。Boss 搜索失败、未启动、未登录或页面异常时抛出清晰异常，不静默返回 mock。
- `allow_mock=True`：兼容模式。真实搜索不可用时返回 mock 岗位，保留原有 mock fallback 能力。

## 技术债

- BOSS 页面 DOM 和 URL 会变动，当前岗位和候选人抽取使用多选择器兜底，仍需要真实账号持续校准。
- 城市编码依赖现有 `CITIES` 字典，部分中文编码历史文件仍存在乱码风险。
- AI 评分使用 HTTP Chat Completions 兼容接口，未抽象成统一 AI client。
- 自动投递仍依赖浏览器页面状态、BOSS 风控和账号权限。

## 未跑真实 BOSS 的原因说明

本次只执行了语法验证。真实端到端运行需要本机 Playwright 浏览器、可用 BOSS 求职端账号、扫码登录和真实页面会话。当前环境无法代替用户完成 BOSS 登录和真实站点交互确认。
