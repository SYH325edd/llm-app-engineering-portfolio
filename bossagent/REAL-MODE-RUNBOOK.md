# Real Mode Runbook

## Safety contract (read first)

Real Mode is not the default. Search may use screen vision, but a `vision://` result is
non-actionable. A real apply or message is allowed only after the exact detail page has been
opened and recorded with `details_confirmed_at`, confirmation evidence, and the matching
`can_real_apply` or `can_real_message` flag. SafetyGuard, QuotaPolicy, the exact confirmation
phrase, and audit logging are mandatory. CAPTCHA bypass, anti-detection, risk-control evasion,
bulk apply, and bulk messaging are intentionally unsupported.

This project does not claim that real BOSS actions are covered by automated tests. The normal
test suite uses mocks, dry-run plans, fake senders, and fixed visual fixtures only.

## 1. 环境检查步骤

在项目根目录执行：

```powershell
cd "C:\Users\Admin\Desktop\BOSS Agent"
python --version
python -m pip --version
```

确认依赖已安装：

```powershell
python -m pip install -r requirements.txt
python -m playwright install firefox
```

## 2. 如何激活 venv

如果已有 `.venv`：

```powershell
.\.venv\Scripts\Activate.ps1
```

如果 PowerShell 拒绝执行脚本，先在当前 shell 允许本进程执行：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

如果还没有 `.venv`：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m playwright install firefox
```

## 3. 如何确认 LAKEJOB_DATABASE_URL

```powershell
echo $env:LAKEJOB_DATABASE_URL
```

如果为空，先设置：

```powershell
$env:LAKEJOB_DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DBNAME"
```

不要把真实密码提交到 Git。

## 4. 如何运行 scripts/check_env.py

```powershell
python scripts\check_env.py
```

必须通过的检查：

- Python
- Database URL
- PostgreSQL driver
- Database connection
- Playwright

AI key 可选。无 AI key 时 JobRadar 和 RecruitRadar 会 fallback 到规则评分或模板首句。

## 5. BOSS 登录前准备

1. 确认只开一个真实测试窗口。
2. 确认账号可正常登录 BOSS 求职端或招聘端。
3. 准备人工扫码。
4. 第一次只跑 `limit=1`。
5. 第一次只跑 `dry_run`。
6. 不要在验证码、风控、账号异常时继续自动化。

## 6. JobRadar 真实搜索 dry_run 命令

只搜索、抓详情、写 `jobs`、写 `match_scores`、写 `logs`，不投递：

```powershell
python run_real_mode_smoke_test.py --mode jobradar --real --dry-run --keyword "AI视频设计师" --city "杭州" --skills "剪辑,AI视频,提示词" --limit 1
```

## 7. JobRadar 真实投递 dry_run 命令

搜索后创建投递相关 Core 记录，但不向 BOSS 真实发送：

```powershell
python run_real_mode_smoke_test.py --mode jobradar --real --dry-run --keyword "AI视频设计师" --city "杭州" --skills "剪辑,AI视频,提示词" --limit 1 --auto-apply --apply-limit 1
```

真实发送必须额外显式确认：

```powershell
python run_real_mode_smoke_test.py --mode jobradar --real --send-real --confirm-send "I UNDERSTAND REAL BOSS MESSAGES WILL BE SENT" --keyword "AI视频设计师" --city "杭州" --skills "剪辑,AI视频,提示词" --limit 1 --auto-apply --apply-limit 1
```

## 8. RecruitRadar 真实搜索 dry_run 命令

只搜索候选人、抓详情、写 `candidates`、写 `match_scores`、写 `logs`，不发送首句：

```powershell
python run_real_mode_smoke_test.py --mode recruitradar --real --dry-run --keyword "Python后端" --city "杭州" --skills "Python,FastAPI,PostgreSQL" --limit 1
```

## 9. RecruitRadar 自动首句 dry_run 命令

dry_run 下 smoke 脚本会压制真实发送，只执行搜索、保存和评分：

```powershell
python run_real_mode_smoke_test.py --mode recruitradar --real --dry-run --keyword "Python后端" --city "杭州" --skills "Python,FastAPI,PostgreSQL" --limit 1 --auto-message --message-limit 1
```

真实发送必须额外显式确认：

```powershell
python run_real_mode_smoke_test.py --mode recruitradar --real --send-real --confirm-send "I UNDERSTAND REAL BOSS MESSAGES WILL BE SENT" --keyword "Python后端" --city "杭州" --skills "Python,FastAPI,PostgreSQL" --limit 1 --auto-message --message-limit 1
```

## 10. 如何查看 Core 数据库写入结果

使用 `psql`：

```powershell
psql $env:LAKEJOB_DATABASE_URL
```

进入后执行：

```sql
SELECT COUNT(*) FROM jobs;
SELECT COUNT(*) FROM candidates;
SELECT COUNT(*) FROM match_scores;
SELECT COUNT(*) FROM applications;
SELECT COUNT(*) FROM conversations;
SELECT COUNT(*) FROM messages;
SELECT COUNT(*) FROM logs;
```

查看最近写入：

```sql
SELECT id, title, company_name, city, created_at FROM jobs ORDER BY created_at DESC LIMIT 5;
SELECT id, name, current_title, city, created_at FROM candidates ORDER BY created_at DESC LIMIT 5;
SELECT id, score, score_type, summary, created_at FROM match_scores ORDER BY created_at DESC LIMIT 5;
SELECT id, content, status, created_at FROM messages ORDER BY created_at DESC LIMIT 5;
SELECT id, message, level, created_at FROM logs ORDER BY created_at DESC LIMIT 10;
```

## 11. 如何停止浏览器

正常情况下脚本结束会关闭 Playwright Firefox。

如果浏览器未关闭：

1. 先按 `Ctrl+C` 停止当前命令。
2. 关闭打开的 Firefox 窗口。
3. 如仍残留进程，可在任务管理器结束 Firefox/Playwright 相关进程。

## 12. 遇到验证码 / 风控 / 登录失败怎么办

1. 立即停止脚本。
2. 不要重复高频重试。
3. 手工完成验证码或登录。
4. 如果账号提示异常、限制、冻结或操作频繁，当天停止真实测试。
5. 降低测试频率，重新从 `limit=1` 和 `dry_run` 开始。

## 13. 禁止高频自动发送说明

- smoke test 强制 `limit <= 1`。
- smoke test 强制 `apply-limit <= 1`。
- smoke test 强制 `message-limit <= 1`。
- 默认 `dry_run=True`。
- 默认 `message_limit=0`。
- 不传 `--real` 会拒绝运行。
- 不传 `--send-real` 不会真实发送消息。
- 真实发送必须传确认短语。

真实 BOSS 测试只允许人工监控下低频执行。
