# Resume Center Design

## Goal

LakeJob AI Resume Center adds a Web Console flow for uploading resumes, parsing text, generating a candidate profile, scoring the resume, syncing the result into the Core talent pool, and writing audit logs.

This step does not connect DeepSeek or any real AI provider. It uses rule parsing plus Mock AI summary generation so the full product chain is available before model integration.

## Upload Flow

1. User opens `/resumes/upload`.
2. User uploads one `pdf`, `docx`, or `txt` file.
3. Web Console validates file type and size.
4. File is saved under `uploads/resumes/`.
5. Duplicate file names are automatically renamed.
6. Parsing starts immediately.
7. Parsed result is synced into `candidates`.
8. User is redirected to `/resumes/{id}`.

## File Handling

- `.txt` is read directly as UTF-8 with error ignoring.
- `.docx` uses `python-docx`.
- `.pdf` uses `pypdf`.
- If an optional parser dependency is missing, the upload fails with a clear error.
- File names are sanitized with `Path(filename).name` and a strict character allowlist to avoid path traversal.
- Maximum upload size is 20MB.

## Parsing Flow

`resume_parser.py` extracts:

- name
- phone
- email
- city
- education
- school
- major
- skills
- work years
- project experience
- work experience
- target role
- expected salary

Missing fields are stored as `unknown`.

## Mock AI Summary

`generate_resume_summary()` returns:

- candidate profile
- strengths
- risks
- recommended directions
- match tags

This is deterministic rule-based output. It is the replacement point for DeepSeek in the next step.

## Scoring Logic

The initial score is 0-100:

- education: up to 20
- work years: up to 25
- skill count: up to 25
- project experience exists: 15
- work experience exists: 15

The score is intentionally simple and auditable for MVP validation.

## Candidate Sync

Resume Center does not change `schema.sql`.

It writes to existing `candidates` fields:

- `name`
- `city`
- `current_title`
- `experience_text`
- `education_text`
- `skills`
- `resume_text`
- `raw_data`

Resume-specific structured data is stored under:

```json
{
  "source": "resume",
  "resume_center": {
    "file_name": "",
    "stored_path": "",
    "uploaded_at": "",
    "parsed": {},
    "summary": {},
    "score": 0,
    "status": "parsed"
  }
}
```

## Logs

Every successful upload writes Core `logs` with:

```json
{
  "resume_center": true,
  "action": "upload_resume",
  "file_name": "",
  "candidate_name": "",
  "score": 0,
  "source": "resume"
}
```

## Safety Limits

Resume Center does not:

- execute uploaded files
- read `.env`
- display AI keys
- call DeepSeek
- call real AI
- trigger Boss automation
- send real messages
- apply to real jobs

Uploaded resume files are ignored by Git except `uploads/resumes/.gitkeep`.

## DeepSeek Replacement Point

Step 37 can replace `generate_resume_summary()` with a DeepSeek-backed implementation while keeping the same return shape. The upload, parse, candidate sync, logs, and Web Console pages can remain unchanged.
