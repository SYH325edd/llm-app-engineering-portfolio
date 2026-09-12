# Real Message Smoke Test

## Goal

Validate the smallest real JobRadar communication path:

Boss job -> open communication window -> send one real message -> write Core records

This test does not apply to a job and does not send messages in batch.

## Command

```powershell
python run_real_mode_smoke_test.py --mode jobradar --keyword "Python" --real --message-smoke --send-real
```

## Safety Rules

- `--message-smoke` is JobRadar-only.
- `--message-smoke` requires both `--real` and `--send-real`.
- `limit` is forced to `1`.
- `message_limit` is forced to `1`.
- `apply_limit` is forced to `0`.
- `auto_apply` is forced off.
- `auto_message` is forced off.
- It sends at most one real message, then stops.
- It does not call `BossAdapter.apply_to_job()`.
- It does not create an `applications` row.
- It cannot be combined with `--write-db-only` or `--dry-apply`.

## Message Content

The smoke test uses AI generation when an AI key is available.

Without an AI key, it falls back to:

```text
您好，我对这个岗位比较感兴趣，想进一步了解岗位要求和团队情况，期待与您沟通。
```

## Database Writes

The smoke test writes:

- `jobs`
- `match_scores`
- `conversations`
- `messages`
- `logs`

The smoke test does not write:

- `applications`

## Expected Output

The JSON summary includes:

```json
{
  "message_smoke": true,
  "real_messages_sent": true,
  "jobs_written": 1,
  "match_scores_written": 1,
  "applications_written": 0,
  "conversations_written": 1,
  "messages_written": 1,
  "logs_written": 1,
  "job_id": "...",
  "conversation_id": "...",
  "message_id": "..."
}
```

If BOSS blocks the communication window or message send, the database still records the failed message attempt with `status="failed"` and logs the error.
