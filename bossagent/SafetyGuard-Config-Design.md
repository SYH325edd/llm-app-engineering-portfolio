# Safety Guard Config Design

## 目标

为真实投递和真实消息发送建立可配置策略层，让每日上限、单次上限、最小间隔、随机延迟、黑名单和风控关键词可以在不改代码的情况下调整。

## 配置文件

默认配置文件：

```text
config/real_run_config.yaml
```

支持通过环境变量覆盖配置文件路径：

```text
LAKEJOB_REAL_RUN_CONFIG
```

## 配置项

```yaml
daily_real_apply_limit: 5
daily_real_message_limit: 5
min_interval_seconds: 60
random_delay_range_seconds: [30, 90]
max_items_per_run: 1
blacklist_companies_file: runtime/blacklist_companies.txt
risk_keywords:
  - 验证码
  - 异常
  - 频繁
  - 安全
  - 风险
  - 请稍后
  - 访问受限
```

## 覆盖顺序

优先级从高到低：

1. 环境变量
2. `config/real_run_config.yaml`
3. 代码默认值

环境变量包括：

- `LAKEJOB_MAX_REAL_APPLIES_PER_DAY`
- `LAKEJOB_MAX_REAL_MESSAGES_PER_DAY`
- `LAKEJOB_MAX_ITEMS_PER_RUN`
- `LAKEJOB_MIN_ACTION_INTERVAL_SECONDS`
- `LAKEJOB_RANDOM_DELAY_MIN_SECONDS`
- `LAKEJOB_RANDOM_DELAY_MAX_SECONDS`
- `LAKEJOB_BLACKLIST_COMPANIES_FILE`

## 应用范围

Safety Guard 配置已统一用于：

- `guard_real_apply`
- `guard_real_message`
- `clamp_run_limit`
- 最小动作间隔
- 随机延迟
- 黑名单公司
- 风控关键词

## Smoke 规则

Smoke 测试仍然强制只允许 1 条。

即使 `max_items_per_run` 配置大于 1：

- `message-smoke` 仍然只发 1 条
- `apply-smoke` 仍然只投 1 个岗位
- `dry-apply` 和 `write-db-only` 仍保持单条验证设计

## 离线验证

配置验证脚本：

```powershell
python test_safety_guard_config.py
```

该脚本只验证配置读取和 Safety Guard 决策，不打开浏览器、不连接 BOSS、不发送消息、不投递岗位。

## 技术说明

当前配置读取支持项目使用的简化 YAML 格式和 JSON 配置文件。没有引入新的外部 YAML 依赖。

后续如果配置结构复杂化，可以再引入正式 YAML parser 或迁移到 Core 配置表。
