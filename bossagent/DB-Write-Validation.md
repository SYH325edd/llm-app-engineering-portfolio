# DB Write Validation

## 目标

验证 JobRadar Real Mode 的真实岗位搜索结果可以写入 LakeJob Core：

```text
真实搜索
  -> 解析岗位
  -> 写入 jobs
  -> 写入 match_scores
  -> 写入 logs
```

本验证不测试真实投递，不发送消息。

## 运行命令

```powershell
python run_real_mode_smoke_test.py --mode jobradar --keyword "Python" --real --write-db-only --limit 1
```

可指定城市和技能：

```powershell
python run_real_mode_smoke_test.py --mode jobradar --keyword "AI视频设计师" --city "杭州" --skills "剪辑,AI视频,提示词" --real --write-db-only --limit 1
```

## write-db-only 行为

`--write-db-only` 会强制：

- `limit=1`
- `dry_run=True`
- `auto_apply=False`
- `apply_limit=0`
- `allow_mock=False`

它会执行：

- 真实 BOSS 岗位搜索
- 岗位解析
- `jobs` 写入
- `match_scores` 写入
- `logs` 写入

它不会执行：

- `applications` 写入
- `conversations` 写入
- `messages` 写入
- `send_message`
- `apply_to_job`

## 输出字段

脚本输出 JSON，其中关键字段为：

- `jobs_parsed_count`
- `jobs_written`
- `match_scores_written`
- `logs_written`
- `applications_written`
- `conversations_written`
- `messages_written`
- `search_debug_url`
- `debug_html_path`
- `debug_screenshot_path`

通过标准：

```text
jobs_parsed_count >= 1
jobs_written >= 1
match_scores_written >= 1
logs_written >= 1
applications_written == 0
conversations_written == 0
messages_written == 0
```

## 失败排查

如果 `jobs_parsed_count == 0`，检查：

```text
runtime/debug_job_search.html
runtime/debug_job_search.png
```

这两个文件用于人工确认 BOSS 页面结构是否变化。

## 禁止事项

- 不修改 `schema.sql`
- 不修改 `run_dual_mock_validation.py`
- 不验证真实投递
- 不发送消息
- 不修改 RecruitRadar
