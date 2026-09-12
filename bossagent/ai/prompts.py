"""Central prompts for LakeJob AI providers."""

RESUME_PARSE_PROMPT = """
Parse the resume into strict JSON.

Return fields:
name, phone, email, city, education, school, major, skills, work_years,
projects, work_experience, target_role, expected_salary.

Use "unknown" for missing scalar fields and [] for missing list fields.
Do not invent facts.
Return JSON only. Do not wrap JSON in markdown.
""".strip()

RESUME_SUMMARY_PROMPT = """
Summarize the parsed resume into strict JSON.

Return fields:
candidate_profile, strengths, risks, recommended_directions, match_tags.

Be concise, practical, and do not exaggerate the candidate.
Return JSON only. Do not wrap JSON in markdown.
""".strip()

CANDIDATE_SCORE_PROMPT = """
Score a candidate against a recruiter job profile.

Return strict JSON:
{
  "score": 0-100,
  "summary": "short reason",
  "details": {
    "matched_skills": [],
    "risks": [],
    "reason": ""
  }
}

Use only the supplied candidate and job profile.
""".strip()

JOB_SCORE_PROMPT = """
Score a job against a job seeker profile.

Return strict JSON:
{
  "score": 0-100,
  "summary": "short reason",
  "details": {
    "matched_skills": [],
    "risks": [],
    "reason": ""
  }
}

Use only the supplied job and user profile.
""".strip()

CANDIDATE_MATCH_ANALYSIS_PROMPT = """
Analyze a candidate against a recruiter job profile.

Return strict JSON:
{
  "score": 0-100,
  "level": "A/B/C",
  "reasons": [],
  "strengths": [],
  "risks": [],
  "suggested_action": "",
  "tags": []
}

Rules:
- Use only supplied data.
- Do not invent candidate experience.
- Treat null, unknown, empty strings, and missing fields as unavailable evidence.
- When candidate details are insufficient, do not invent strengths and add "候选人详情不足，评分置信度较低" to risks.
- Do not exaggerate.
- Do not suggest illegal, discriminatory, or platform-bypass actions.
- Keep each list concise.
- Return JSON only. Do not wrap JSON in markdown.
""".strip()

JOB_MATCH_ANALYSIS_PROMPT = """
Analyze a job against a job seeker profile.

Return strict JSON:
{
  "score": 0-100,
  "level": "A/B/C",
  "reasons": [],
  "strengths": [],
  "risks": [],
  "suggested_action": "",
  "tags": []
}

Rules:
- Use only supplied data.
- Do not invent job details or user experience.
- Treat null, unknown, empty strings, and missing fields as unavailable evidence.
- Do not exaggerate.
- Do not suggest illegal, risky, or platform-bypass actions.
- Keep each list concise.
- Return JSON only. Do not wrap JSON in markdown.
""".strip()

MESSAGE_PROMPT = """
Generate one short BOSS communication message.

Rules:
- Natural and human.
- Do not exaggerate experience.
- Do not mention bypassing the platform.
- Do not ask for private contact details.
- Keep it brief.
- Chinese message length must be no more than 100 Chinese characters.

Return JSON:
{"message": "..."}
""".strip()

RECRUITER_MESSAGE_DRAFT_PROMPT = """
Generate one Chinese recruiter-to-candidate first message draft.

Rules:
- Chinese.
- Polite and concise.
- No more than 100 Chinese characters.
- Do not exaggerate the candidate.
- Do not invent facts.
- Do not promise salary, offer, interview, or outcome.
- Do not harass or pressure.
- Do not ask to bypass the platform.

Return JSON:
{"message": "..."}
""".strip()

JOBSEEKER_MESSAGE_DRAFT_PROMPT = """
Generate one Chinese jobseeker-to-recruiter first message draft.

Rules:
- Chinese.
- Polite and concise.
- No more than 100 Chinese characters.
- Do not exaggerate experience.
- Do not invent facts.
- Do not promise unavailable information.
- Do not harass or pressure.
- Do not ask to bypass the platform.

Return JSON:
{"message": "..."}
""".strip()
