# LakeJob Safety Guard Design

## 风控目标

Safety Guard 是真实投递和真实消息发送前的统一安全层，目标是防止系统进入高频、重复、批量发送状态，降低触发 BOSS 风控的概率。

## 默认限制

- 每日真实投递上限：`max_real_applies_per_day = 5`
- 每日真实消息上限：`max_real_messages_per_day = 5`
- 单次运行上限：`max_items_per_run = 1`
- 最小动作间隔：`min_action_interval_seconds = 60`
- 随机延迟：`random_delay_seconds = 30-90`

可通过环境变量覆盖：

- `LAKEJOB_MAX_REAL_APPLIES_PER_DAY`
- `LAKEJOB_MAX_REAL_MESSAGES_PER_DAY`
- `LAKEJOB_MAX_ITEMS_PER_RUN`
- `LAKEJOB_MIN_ACTION_INTERVAL_SECONDS`
- `LAKEJOB_RANDOM_DELAY_MIN_SECONDS`
- `LAKEJOB_RANDOM_DELAY_MAX_SECONDS`

## 去重规则

- 同一 `platform_job_id` 已经真实投递成功后，不允许重复真实投递。
- 同一公司当天最多真实投递 1 次。

## 黑名单规则

黑名单文件：

```text
runtime/blacklist_companies.txt
```

每行一个公司名。命中黑名单时，真实投递或真实消息会被拦截。

## 风控关键词

如果传入的页面文本包含以下关键词，Safety Guard 会立即拦截：

- 验证码
- 异常
- 频繁
- 安全
- 风险
- 请稍后
- 访问受限

平台页面侧仍保留 BossAutomation 的即时安全检查。

## 日志记录

所有 allow/block 决策都会写入 Core `logs`，payload 包含：

```json
{
  "safety_guard": true,
  "blocked": true,
  "reason": "...",
  "job_id": "...",
  "company": "...",
  "platform_job_id": "..."
}
```

RecruitRadar 消息会额外记录 `candidate_id`。

## 已接入入口

- `run_real_mode_smoke_test.py --message-smoke`
- `run_real_mode_smoke_test.py --apply-smoke`
- `jobradar_apply.py` 真实投递入口
- `jobradar_search.py` 未来 `auto_apply`
- `recruitradar_msg.py` 真实消息入口
- `recruitradar_search.py` 未来 `auto_message`

## Smoke 规则

Smoke 模式仍然只能处理 1 条。即使 Safety Guard 配置更大，smoke 入口仍强制：

- `limit=1`
- `apply_limit=1` 或 `message_limit=1`
- 不批量
- 不循环

## 后续可配置项

- 按账号配置不同上限。
- 按岗位类型配置更保守的动作间隔。
- 增加公司域名、行业、城市维度的黑名单。
- 将 Safety Guard 配置迁移到 Core 配置表。
- 增加 dry-run 预演报告，提前显示哪些岗位会被拦截。
