# Local Control Center Validation

## 页面检查

- 目标页面：`/control`
- 当前代码实例验证：使用当前 `web_console.app` 临时启动在 `127.0.0.1:8001`，访问 `/control` 返回 `200`。
- 页面包含关键内容：
  - `Local Control Center`
  - `JobRadar 求职助手`
  - `RecruitRadar 招聘助手`
  - `Resume Center 简历中心`
  - `System 系统控制`
- 环境说明：本机 `127.0.0.1:8000/control` 当前返回 `404`，说明 8000 端口已有非当前实例或旧服务占用。当前代码路由已在 8001 验证通过；若要验证 8000，需要停止旧服务后重新运行 `python web_console.py`。

## 配置保存检查

测试覆盖：

- 保存 JobRadar 配置：
  - `keyword=Python`
  - `city=杭州`
  - `skills=Python,FastAPI`
  - `mode=mock`
  - `dry_run=true`
  - `limit=1`
- 保存 RecruitRadar 配置：
  - `mode=mock`
  - `dry_run=true`
  - `limit=1`
- `config/local_control.yaml` 可读写。
- `limit > 1` 会被归一化为 `1`。
- 历史配置中的 unicode 转义城市值会自动恢复为中文。

结果：通过。

## mock/dry_run 运行检查

已通过 `test_local_control.py` 离线执行以下安全路径：

- JobRadar mock/dry_run 搜索
- JobRadar mock Dry Apply
- RecruitRadar mock/dry_run 搜索

检查结果：

- 不打开 BOSS 浏览器。
- 不发送真实消息。
- 不真实投递。
- stdout 包含运行摘要。
- stderr 可记录。
- `runtime/local_control_last_run.json` 会更新。

结果：通过。

## 危险动作拦截检查

已验证：

- Apply Smoke 未输入 `APPLY_ONE_REAL_JOB` 会拒绝。
- Message Smoke 未输入 `SEND_ONE_REAL_MESSAGE` 会拒绝。
- 真实动作 `limit > 1` 会强制归一化为 `1`。
- mock 模式下不能生成真实 apply/message smoke 命令。

结果：通过。

## System 状态检查

页面与测试覆盖以下状态字段：

- DB 状态
- AI Provider 状态
- BOSS auth state
- Safety Guard 状态
- Scheduler 状态

当 `LAKEJOB_DATABASE_URL` 缺失时：

- 页面不崩溃。
- 测试不失败。
- 日志写入只打印 warning。

结果：通过。

## 发现问题

1. `templates/local_control.html` 存在乱码和断裂标签，可能导致页面显示异常。
2. 原 mock/dry_run 按钮生成的命令可能调用不匹配的真实 smoke 脚本参数。
3. RecruitRadar mock 搜索按钮原本可能调用不支持 `--allow-mock` / `--dry-run` 的 CLI。
4. 本机 8000 端口不是当前验证实例，访问 `/control` 返回 404。

## 修复项

1. 重写 `templates/local_control.html` 展示层，修复文案和 HTML/Jinja 标签。
2. `local_control.py` 中 mock/dry_run 按钮改为执行离线 mock subprocess，不启动 BOSS。
3. 保留真实 apply/message smoke 的确认短语保护。
4. 增强 `test_local_control.py`：
   - `save_config` 测试
   - mock JobRadar 搜索命令生成测试
   - Dry Apply 命令生成测试
   - RecruitRadar mock 搜索命令生成测试
   - 危险动作拒绝测试
   - `last_run` JSON 写入测试
   - System 状态读取测试

## 验证命令

```bash
python -m py_compile local_control.py web_console.py test_local_control.py
python test_local_control.py
```

结果：

```text
PASSED
```

## 最终结论

PASSED

Control Center 已具备安全本地控制能力：可以保存配置、执行 mock/dry_run 按钮、记录最近运行结果，并拦截未确认的真实投递与真实消息动作。
