# Operation Dashboard Design

## Goal

Dashboard V2 now includes an operations view for non-technical review. It summarizes the current recruiting pipeline, talent pool, job pool, company pool, AI scoring, Safety Guard behavior, and recent task flow.

## Scope

This step only enhances the local console display layer.

No database schema, automation logic, Safety Guard logic, or real BOSS actions were changed.

## Data Sources

Metrics are calculated from existing LakeJob Core tables:

- `jobs`
- `applications`
- `messages`
- `match_scores`
- `logs`
- `candidates`
- `conversations`

When a metric has no supporting data, the dashboard shows `N/A` instead of estimating or fabricating values.

## Modules

### Recruiting Funnel

Shows candidates, scored candidates, candidate conversations, candidate messages, applications, submitted applications, and responded applications.

### Talent Profile

Shows total/active candidates plus top cities, current titles, and education buckets.

### Job Pool

Shows total/active jobs, jobs created today, top job cities, and top companies by job count.

### Company Pool

Shows distinct companies, companies with applications, top companies by jobs, and top companies by applications.

### AI Effect

Shows total scores, average score, AI/hybrid score count, rule score count, high-score count, and score type distribution.

### Safety Guard

Shows Safety Guard events, blocked events, blocked events today, and top block reasons.

### Real-Time Task Flow

Shows recent scheduler, dashboard action, and Safety Guard events from `logs`.

## Commands

Start:

```powershell
python dashboard.py
```

Show operation metrics:

```text
ops
```

Refresh the basic dashboard:

```text
refresh
```

View Core logs:

```text
logs
```

## Safety

The operation dashboard is read-only for business actions. It cannot trigger real apply, real message, browser automation, or BOSS platform activity.
