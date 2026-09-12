# Profile Center Design

## Why Profile Center

LakeJob needs stable user-defined profiles before deeper AI matching and automation can be reliable.

Profile Center stores:

- Recruit Profile: what the recruiter is hiring for.
- Jobseeker Profile: what the job seeker wants and should avoid.

These profiles become shared inputs for later AI scoring, resume matching, automatic communication, and automatic apply decisions.

## Storage

No database schema change is required.

Profiles are saved locally:

```text
config/profiles/recruiter_profile.yaml
config/profiles/jobseeker_profile.yaml
```

## Recruit Profile Fields

- `profile_name`
- `company_name`
- `job_title`
- `city`
- `salary_range`
- `education_requirement`
- `experience_requirement`
- `core_skills`
- `bonus_skills`
- `reject_rules`
- `job_description`
- `communication_style`
- `daily_contact_limit`
- `notes`

## Jobseeker Profile Fields

- `profile_name`
- `name`
- `target_job_title`
- `target_city`
- `expected_salary`
- `education`
- `skills`
- `project_experience`
- `work_experience`
- `avoid_companies`
- `avoid_industries`
- `communication_style`
- `notes`

## Web Pages

- `/profiles`: Profile Center landing page.
- `/profiles/recruiter`: edit Recruit Profile.
- `/profiles/jobseeker`: edit Jobseeker Profile.

Forms load existing YAML if present. If no config exists, fields are empty.

## Context Conversion

`profile_center.py` exposes:

- `profile_to_job_context(profile)`
- `profile_to_candidate_context(profile)`

These functions normalize profile YAML into structured inputs for future AI matching and messaging.

## Logs

Saving a profile attempts to write Core `logs`:

```json
{
  "profile_center": true,
  "profile_type": "recruiter",
  "action": "save_profile",
  "profile_name": "",
  "success": true
}
```

If DB is unavailable, the page still succeeds and prints a warning.

## Future AI Integration

DeepSeek can later be used to:

- optimize job profiles
- extract core skills
- generate reject rules
- generate communication style examples
- improve scoring context

This step does not call AI.

## Safety Boundary

Profile Center does not:

- trigger Boss automation
- send real messages
- apply to jobs
- modify `schema.sql`
- display API keys
- read or display `.env`
