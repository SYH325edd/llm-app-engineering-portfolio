# RealMode Smoke Test Design

## 新增文件

- `run_real_mode_smoke_test.py`
- `REAL-MODE-RUNBOOK.md`
- `RealMode-SmokeTest-Design.md`

## 运行命令

JobRadar 真实搜索 dry_run：

```powershell
python run_real_mode_smoke_test.py --mode jobradar --real --dry-run --keyword "AI视频设计师" --city "杭州" --skills "剪辑,AI视频,提示词" --limit 1
```

JobRadar 投递 dry_run：

```powershell
python run_real_mode_smoke_test.py --mode jobradar --real --dry-run --keyword "AI视频设计师" --city "杭州" --skills "剪辑,AI视频,提示词" --limit 1 --auto-apply --apply-limit 1
```

RecruitRadar 真实搜索 dry_run：

```powershell
python run_real_mode_smoke_test.py --mode recruitradar --real --dry-run --keyword "Python后端" --city "杭州" --skills "Python,FastAPI,PostgreSQL" --limit 1
```

RecruitRadar 自动首句 dry_run：

```powershell
python run_real_mode_smoke_test.py --mode recruitradar --real --dry-run --keyword "Python后端" --city "杭州" --skills "Python,FastAPI,PostgreSQL" --limit 1 --auto-message --message-limit 1
```

## 安全策略

- 不传 `--real` 直接拒绝运行。
- 默认 `dry_run=True`。
- 默认 `limit=1`。
- 默认 `message_limit=0`。
- smoke test 拒绝 `limit > 1`。
- smoke test 拒绝 `apply_limit > 1`。
- smoke test 拒绝 `message_limit > 1`。
- JobRadar 的 `--auto-message` 会被拒绝。
- RecruitRadar 的 `--auto-apply` 会被拒绝。

## dry_run 策略

JobRadar：

- dry_run 搜索会真实打开 BOSS 求职端进行搜索。
- dry_run 投递会写 `applications / conversations / messages / logs`。
- dry_run 投递不会启动真实 BOSS 发送流程。

RecruitRadar：

- dry_run 搜索会真实打开 BOSS 招聘端进行搜索。
- dry_run 自动首句会被 smoke test 压制为不发送。
- dry_run 自动首句只做搜索、保存、评分和日志。

## 真实发送保护

真实发送必须同时满足：

```text
--real
--send-real
--confirm-send "I UNDERSTAND REAL BOSS MESSAGES WILL BE SENT"
```

缺少任一条件都会拒绝真实发送。

## 输出结果

脚本输出 JSON summary，包含：

- 搜索结果数量
- `jobs` 写入数量
- `candidates` 写入数量
- `match_scores` 写入数量
- `applications` 写入数量
- `conversations` 写入数量
- `messages` 写入数量
- `logs` 写入数量
- 是否真实发送消息

## 当前仍未真实端到端测试的原因

当前步骤只准备真实 BOSS 测试前入口，不执行真实端到端。

真实测试需要：

- 本机 Playwright Firefox。
- 可用 BOSS 求职端或招聘端账号。
- 人工扫码登录。
- 用户现场确认验证码、风控和账号状态。

下一步才允许人工扫码登录，进行 `limit=1` 的真实搜索测试。
