# Mock Fallback Validation

## Why Mock Fallback Is Needed

Local runtime validation was blocked by two issues:

- The machine had no usable Python runtime.
- Real BOSS browser automation requires Playwright, login state, and a reachable BOSS session.

RecruitRadar already had mock candidate fallback inside `BossAdapter.search_candidates()`.

JobRadar still needed the same adapter-level fallback so local Core write validation can run without a real BOSS browser session.

The fallback is intentionally placed inside `BossAdapter`, not in JobRadar or RecruitRadar business code.

## Boundary

Required call chains remain unchanged:

```text
JobRadar -> Core -> PlatformAdapter -> BossAdapter -> BossAutomation
RecruitRadar -> Core -> PlatformAdapter -> BossAdapter -> BossAutomation
```

Mock behavior lives only in:

```text
adapters/boss/adapter.py
```

JobRadar does not directly call `BossAutomation`.

RecruitRadar does not directly call `BossAutomation`.

## JobRadar Mock Jobs Example

When `BossAdapter.start()` fails, `BossAdapter.search_jobs()` is called without a running browser, or real BOSS search raises an exception, the adapter returns Core-shaped mock jobs.

Example:

```json
{
  "platform_job_id": "mock-boss-job-1",
  "external_job_id": "mock-boss-job-1",
  "source_url": "mock://boss/jobs/1",
  "url": "mock://boss/jobs/1",
  "title": "Backend Engineer",
  "company": "MockTech",
  "company_name": "MockTech",
  "city": "北京",
  "salary": "20k-35k",
  "salary_text": "20k-35k",
  "experience": "3-5年",
  "experience_text": "3-5年",
  "education": "本科",
  "education_text": "本科",
  "description": "Backend Engineer role for Python. Requires practical delivery experience.",
  "mock": true,
  "query": "Python"
}
```

After `boss_job_to_core()`, JobRadar receives fields compatible with Core `jobs`:

- `external_job_id`
- `source_url`
- `title`
- `company_name`
- `salary_text`
- `city`
- `experience_text`
- `education_text`
- `description`
- `status`
- `raw_data`

## RecruitRadar Mock Candidates Example

RecruitRadar candidate fallback already exists in `BossAdapter.search_candidates()`.

Example:

```json
{
  "external_candidate_id": "mock-boss-candidate-1",
  "source_url": "mock://boss/candidates/1",
  "name": "Mock Candidate A",
  "headline": "Backend engineer with platform experience",
  "current_company": "MockTech",
  "current_title": "Backend Engineer",
  "city": "北京",
  "location": "北京",
  "experience_text": "5年",
  "education_text": "本科",
  "skills": ["Python", "FastAPI", "PostgreSQL"],
  "resume_text": "Mock Candidate A has experience with Python Backend FastAPI.",
  "mock": true,
  "query": "Python Backend FastAPI"
}
```

After `boss_candidate_to_core()`, RecruitRadar receives fields compatible with Core `candidates`:

- `external_candidate_id`
- `source_url`
- `name`
- `headline`
- `current_company`
- `current_title`
- `city`
- `location`
- `experience_text`
- `education_text`
- `skills`
- `resume_text`
- `status`
- `raw_data`

## Mock vs Real Adapter Boundary

| Layer | Mock behavior allowed? | Notes |
|---|---:|---|
| JobRadar business code | No | Calls `BossAdapter.search_jobs()` only |
| RecruitRadar business code | No | Calls `BossAdapter.search_candidates()` only |
| PlatformAdapter contract | No | Defines neutral interface |
| BossAdapter | Yes | Owns platform fallback and normalization |
| BossAutomation | No new mock added | Existing legacy automation remains unchanged |
| Core schema | No | Receives normalized data only |

## Replacement Path For Real BOSS Search

Future real BOSS job and candidate search should replace mock fallback inside `BossAdapter`.

Recommended path:

1. Implement real BOSS recruiter-side candidate search in legacy automation or a new Boss adapter module.
2. Return raw BOSS candidate dictionaries from that platform method.
3. Normalize through `boss_candidate_to_core()`.
4. Keep RecruitRadar unchanged.
5. Keep Core schema unchanged.

For JobRadar:

1. Keep using `BossAutomation.search()` for real BOSS job search.
2. Keep mock fallback only for local validation or browser/session failure.
3. Normalize through `boss_job_to_core()`.
4. Keep JobRadar unchanged.

## Validation Result

Mock fallback coverage:

| Flow | Mock fallback | Status |
|---|---|---:|
| JobRadar search jobs | `BossAdapter.search_jobs()` | Added |
| RecruitRadar search candidates | `BossAdapter.search_candidates()` | Already present |
| JobRadar apply | No mock apply fallback | Not required in this task |
| RecruitRadar send message | No mock send fallback | Existing flow writes failed messages/logs when send fails |

Conclusion:

JobRadar and RecruitRadar now both have mock search fallback inside the platform adapter boundary. This enables local dual-run validation once Python and PostgreSQL are available.
