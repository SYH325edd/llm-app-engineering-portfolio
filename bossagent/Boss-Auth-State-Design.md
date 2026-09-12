# Boss Auth State Design

## 登录状态保存位置

BOSS Real Mode 登录状态保存到：

```text
runtime/boss_auth_state.json
```

保存内容来自 Playwright `storage_state()`，包括 cookies 和 origin state。浏览器仍使用 Playwright persistent context；该文件用于跨 smoke test 运行显式复用登录状态。

## 第一次如何扫码

运行：

```powershell
python run_real_mode_smoke_test.py --mode jobradar --keyword "AI视频设计师" --real --auth-only
```

流程：

1. 打开一次 BOSS 求职端页面。
2. 如果未登录，停留在当前页面等待人工扫码。
3. 用户扫码登录成功后，在终端按 Enter。
4. 程序最多低频检查 3 次，每次间隔至少 5 秒。
5. 登录成功后保存 `runtime/boss_auth_state.json`。
6. 不执行搜索、不投递、不发送消息。

RecruitRadar 登录状态也使用同一个文件：

```powershell
python run_real_mode_smoke_test.py --mode recruitradar --keyword "Python后端" --real --auth-only
```

## 第二次如何复用

第二次运行真实 smoke test 时，如果 `runtime/boss_auth_state.json` 存在，`BossAutomation.start()` 会加载其中的 cookies 到 Playwright persistent context。

示例：

```powershell
python run_real_mode_smoke_test.py --mode jobradar --keyword "AI视频设计师" --real --dry-run --limit 1
```

预期行为：

- 复用已保存登录状态。
- 不反复打开扫码登录页。
- 如状态过期，只停留当前页面让用户重新扫码，不进行高频刷新。

## reset-auth 用法

删除保存的登录状态，让下一次运行重新扫码：

```powershell
python run_real_mode_smoke_test.py --mode jobradar --keyword "AI视频设计师" --real --reset-auth --auth-only
```

也可以对 RecruitRadar 使用：

```powershell
python run_real_mode_smoke_test.py --mode recruitradar --keyword "Python后端" --real --reset-auth --auth-only
```

## auth-only 用法

`--auth-only` 只做登录：

- 打开 BOSS 页面。
- 等待人工扫码。
- 保存 `runtime/boss_auth_state.json`。
- 不查数据库计数。
- 不搜索。
- 不投递。
- 不发消息。

## 如何避免刷新登录页

新的登录逻辑遵守以下规则：

- 只做一次 `page.goto()` 到目标 BOSS 页面。
- 不在等待登录期间循环跳转。
- 不调用 `page.reload()`。
- 不因为未登录就频繁打开扫码登录页。
- 登录状态最多检查 3 次。
- 每次检查间隔至少 5 秒。
- 用户扫码成功后按 Enter，再进行低频检查和保存。

## dry_run 规则

`dry_run=True` 允许：

- 打开浏览器。
- 读取页面。
- 搜索和抓取页面信息。
- 写入 Core 记录。

`dry_run=True` 禁止：

- 真实发送消息。
- 真实投递。

## 注意事项

如果遇到验证码、风控、账号异常或登录失败：

1. 停止脚本。
2. 不要重复运行造成高频访问。
3. 手工处理账号状态。
4. 必要时使用 `--reset-auth --auth-only` 重新保存状态。
