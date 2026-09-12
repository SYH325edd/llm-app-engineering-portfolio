# Talent Pool Design

## Positioning

Talent Pool turns `candidates` from a static list into an ATS-like candidate management surface.

It tracks where a candidate is in the recruiting process without sending messages, applying to jobs, or triggering Boss automation.

## Status Definitions

Supported statuses:

- `new`
- `matched`
- `contacted`
- `replied`
- `wechat_exchanged`
- `interview_scheduled`
- `interviewed`
- `offer`
- `hired`
- `rejected`
- `blacklisted`

## Storage Without Schema Changes

`schema.sql` is not modified.

Candidate base data remains in `candidates`.

Talent Pool state is stored in `logs.payload` as events:

```json
{
  "talent_pool": true,
  "candidate_id": "",
  "old_status": "new",
  "new_status": "contacted",
  "action": "update_status",
  "success": true
}
```

Notes are stored as:

```json
{
  "talent_pool": true,
  "candidate_id": "",
  "action": "update_notes",
  "notes": ""
}
```

## Logs as Event Source

The latest candidate status is read from the newest `logs` row where:

- `payload.talent_pool=true`
- `payload.candidate_id=<candidate_id>`
- `payload.action=update_status`

If no status event exists, the candidate status defaults to `new`.

The latest note is read from the newest `update_notes` event.

## Web Pages

- `/talent-pool`: status dashboard, grouped counts, filters, candidate table.
- `/talent-pool/{candidate_id}`: candidate detail, current status, notes, messages, logs.

Filters:

- status
- keyword
- city
- skill
- score_min

## Safety Boundary

Talent Pool does not:

- trigger Boss automation
- send real messages
- apply to jobs
- modify `schema.sql`
- call AI

It only writes audit-style state events to `logs`.

## Future Schema Upgrade

If this becomes production-critical, a future migration could add:

- `candidate_status_events`
- `candidate_notes`
- `candidate_owner`
- `candidate_stage_changed_at`

The current log-based event source keeps the MVP schema stable.
