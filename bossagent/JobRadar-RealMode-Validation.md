# JobRadar Real Mode Validation

## 当前调用链

```text
JobRadar
  -> jobradar_search.py / jobradar_apply.py
  -> adapters.boss.BossAdapter
  -> adapters.base.PlatformAdapter inheritance contract
  -> lakejobai-job-radar/boss_automation.py BossAutomation
  -> BOSS 求职端页面
```

验收点：JobRadar 文件没有直接 import `BossAutomation` 或 `boss_automation`。JobRadar 只 import `BossAdapter`。

## 当前数据流

搜索与评分：

```text
jobradar_search.search_jobs()
  -> BossAdapter.start()
  -> BossAdapter.search_jobs(... allow_mock=...)
  -> BossAutomation.search_jobs_real()
  -> BossAutomation.fetch_job_detail()
  -> boss_job_to_core()
  -> jobradar_log.upsert_job()
  -> score_job_ai_first()
  -> jobradar_log.add_match_score()
  -> jobradar_log.log_event()
```

投递：

```text
jobradar_apply.apply_jobs()
  -> jobradar_apply.apply_one_job()
  -> jobradar_log.create_application()
  -> jobradar_log.create_conversation()
  -> jobradar_log.add_message()
  -> BossAdapter.apply_to_job(... dry_run=...)
  -> BossAutomation.send_job_apply_message()
  -> jobradar_log.set_application_status()
  -> jobradar_log.log_event()
```

## 通过项

1. JobRadar 没有直接 import `BossAutomation`。
   - `rg "BossAutomation|boss_automation" jobradar_search.py jobradar_apply.py jobradar_ai_msg.py jobradar_log.py` 无匹配。

2. `BossAdapter` 区分 `allow_mock=True / allow_mock=False`。
   - `BossAdapter.search_jobs(... allow_mock=False)` 使用 `effective_allow_mock = allow_mock`。
   - `allow_mock=False` 时 adapter 未启动或真实搜索失败会抛 `RuntimeError`。
   - `allow_mock=True` 时保留 `_mock_boss_jobs()` fallback。

3. `allow_mock=False` 走真实 BOSS 岗位搜索。
   - `BossAdapter.search_jobs()` 调用 `BossAutomation.search_jobs_real()`。
   - `BossAutomation.search_jobs_real()` 调用 `ensure_jobseeker_logged_in()` 后搜索 BOSS 求职端岗位。

4. `allow_mock=True` 仍能 mock fallback。
   - adapter 未启动或真实搜索异常时，`allow_mock=True` 返回 `_mock_boss_jobs()` 映射后的 Core-shaped job。

5. 岗位搜索结果写入 `jobs`。
   - `jobradar_search.py` 调用 `jobradar_log.upsert_job()`。

6. 岗位匹配分写入 `match_scores`。
   - `jobradar_search.py` 调用 `jobradar_log.add_match_score()`。
   - AI key 存在时走 AI-first；无 key 或 AI 失败时 fallback 到规则评分。

7. 投递记录写入 `applications`。
   - `jobradar_apply.py` 调用 `create_application()`。

8. 投递消息写入 `conversations / messages`。
   - `jobradar_apply.py` 调用 `create_conversation()` 和 `add_message()`。

9. 日志写入 `logs`。
   - 搜索流程和投递流程均调用 `log_event()`。

10. `dry_run` 不会真实发送消息。
    - `jobradar_apply.py` 在 `dry_run=True` 时不调用 `adapter.start()`。
    - `BossAdapter.apply_to_job(... dry_run=True)` 直接返回 dry-run result，不调用 BOSS 发送。
    - dry-run message 状态写为 `draft`。

11. `auto_apply` 有命令级安全限制。
    - 默认 `--apply-limit 1`。
    - `apply_jobs()` 只处理 `targets[:max(0, apply_limit)]`。

12. 不会在 dry-run 投递阶段误打开真实 BOSS 浏览器。
    - dry-run 投递不启动 adapter。
    - 注意：真实搜索阶段本身需要打开 BOSS 浏览器，这是 Real Mode 的预期行为。

13. 未发现绕过 Core 的 JobRadar 数据写入。
    - `jobs / match_scores / applications / conversations / messages / logs` 都通过 `jobradar_log.py` 写入 PostgreSQL Core。
    - `BossAutomation` 初始化仍会触碰 legacy SQLite state，这是现有技术债，不是 JobRadar 业务数据写入路径。

14. 未发现第 13 步 RecruitRadar 编译级破坏。
    - `python -m py_compile recruitradar_search.py recruitradar_msg.py recruitradar_score.py recruitradar_log.py` 通过。
    - `BossAdapter.search_candidates()` 和 `BossAutomation.search_candidates()` 仍存在。

15. 指定语法检查通过。
    - `python -m py_compile lakejobai-job-radar\boss_automation.py adapters\boss\adapter.py adapters\boss\mapper.py jobradar_search.py jobradar_ai_msg.py jobradar_apply.py jobradar_log.py`

16. 未修改 `schema.sql` 和 `run_dual_mock_validation.py`。
    - `git diff -- schema.sql run_dual_mock_validation.py` 无业务 diff。

## 失败项

无 P0 失败项。

## 技术债

1. 真实 BOSS 端到端未执行。
   - 需要本机 Playwright、可用 BOSS 求职端账号、扫码登录和真实会话。

2. `auto_apply` 只有命令级 `apply_limit`，没有 JobRadar 层全局日限。
   - 现有默认值是 1，但用户仍可显式传较大值。

3. BOSS 页面 DOM 和 URL 有变动风险。
   - 当前依赖多选择器兜底，仍需要真实页面校准。

4. `BossAutomation.__init__()` 仍初始化 legacy SQLite state。
   - JobRadar Core 数据没有写入 SQLite，但 automation 层仍有历史状态副作用。

5. AI 评分和 AI 首句生成使用 HTTP Chat Completions 兼容调用。
   - 还没有统一 AI client。

## 必须修复项

无 P0 必须修复项。

建议后续在进入大规模真实投递前增加一个 P1 保护：JobRadar 层硬性每日投递上限。

## 是否允许进入下一步

允许进入下一步。

结论：PASSED
