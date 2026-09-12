# LakeJob Scheduler Design

## 架构

`scheduler.py` 是 LakeJob 的定时运行层。

它负责：

- 读取 `config/scheduler.yaml`
- 每分钟检查一次任务时间
- 命中时间后调用 JobRadar / RecruitRadar 现有入口
- 写入 Core `logs`
- 写入本地 `runtime/scheduler.log`
- 通过 `runtime/scheduler_state.json` 防止同一分钟重复执行

## 调度逻辑

任务配置示例：

```yaml
jobradar_search:
  enabled: true
  cron: "09:00"
  dry_run: true
  keyword: "Python"
  limit: 1
```

Scheduler 每分钟检查当前 `HH:MM` 是否等于任务 `cron`。

如果匹配且任务未在当前分钟执行过，则执行一次。

## 防重复执行

状态文件：

```text
runtime/scheduler_state.json
```

记录格式：

```json
{
  "executed": {
    "jobradar_search": "2026-06-04 09:00"
  }
}
```

同一个任务在同一分钟只会执行一次。

## Safety Guard 集成

Scheduler 不绕过真实动作入口。

- JobRadar apply 仍通过 `jobradar_apply.apply_jobs`
- RecruitRadar message 仍通过 `recruitradar_msg.send_candidate_message`
- 真实动作入口内部会调用 Safety Guard
- Scheduler 同时使用 `clamp_run_limit` 限制单次运行数量

Smoke 和真实测试入口仍强制 1 条，不会被 scheduler 配置放大。

## dry_run

`dry_run=true` 时：

- search 任务只执行搜索和评分路径
- apply/message 任务不会真实发送
- `recruitradar_message` 在 dry_run 下直接跳过真实发送

默认配置中真实 apply/message 均为 `enabled=false` 且 `dry_run=true`。

## 配置说明

默认配置：

```text
config/scheduler.yaml
```

支持任务：

- `jobradar_search`
- `jobradar_apply`
- `recruitradar_search`
- `recruitradar_message`

## 日志

Core `logs.payload` 写入：

```json
{
  "scheduler": true,
  "task_name": "jobradar_search",
  "start_time": "...",
  "end_time": "...",
  "success": true,
  "error": ""
}
```

本地日志：

```text
runtime/scheduler.log
```

记录启动、停止、执行和异常。

## 启动

```powershell
python scheduler.py
```

使用 `Ctrl+C` 安全退出。

## 离线测试

```powershell
python test_scheduler.py
```

测试不打开浏览器、不连接 BOSS、不发送消息、不投递岗位。
