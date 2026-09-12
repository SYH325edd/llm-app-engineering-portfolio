"""Local profile configuration center for LakeJob."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

try:
    import yaml  # type: ignore
except ImportError:  # pragma: no cover
    yaml = None


ROOT = Path(__file__).resolve().parent
PROFILE_DIR = ROOT / "config" / "profiles"
RECRUITER_PROFILE_PATH = PROFILE_DIR / "recruiter_profile.yaml"
JOBSEEKER_PROFILE_PATH = PROFILE_DIR / "jobseeker_profile.yaml"

RECRUITER_FIELDS = [
    "profile_name",
    "company_name",
    "job_title",
    "city",
    "salary_range",
    "education_requirement",
    "experience_requirement",
    "core_skills",
    "bonus_skills",
    "reject_rules",
    "job_description",
    "communication_style",
    "daily_contact_limit",
    "notes",
]

JOBSEEKER_FIELDS = [
    "profile_name",
    "name",
    "target_job_title",
    "target_city",
    "expected_salary",
    "education",
    "skills",
    "project_experience",
    "work_experience",
    "avoid_companies",
    "avoid_industries",
    "communication_style",
    "notes",
]


def _empty(fields: list[str]) -> dict[str, Any]:
    return {field: "" for field in fields}


def _parse_scalar(value: str) -> Any:
    value = value.strip()
    if value.lower() == "true":
        return True
    if value.lower() == "false":
        return False
    try:
        return int(value)
    except ValueError:
        return value.strip("'\"")


def _load_simple_yaml(text: str) -> dict[str, Any]:
    data: dict[str, Any] = {}
    for raw_line in text.splitlines():
        if not raw_line.strip() or raw_line.lstrip().startswith("#"):
            continue
        key, _, value = raw_line.partition(":")
        if key:
            data[key.strip()] = _parse_scalar(value)
    return data


def _format_scalar(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    text = str(value or "")
    if text == "" or "\n" in text or ":" in text:
        return json.dumps(text, ensure_ascii=False)
    return text


def _dump_simple_yaml(data: dict[str, Any]) -> str:
    return "\n".join(f"{key}: {_format_scalar(value)}" for key, value in data.items()) + "\n"


def load_yaml_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    text = path.read_text(encoding="utf-8")
    if yaml is not None:
        return yaml.safe_load(text) or {}
    return _load_simple_yaml(text)


def save_yaml_file(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if yaml is not None:
        path.write_text(yaml.safe_dump(data, sort_keys=False, allow_unicode=True), encoding="utf-8")
    else:
        path.write_text(_dump_simple_yaml(data), encoding="utf-8")


def _normalize(data: dict[str, Any], fields: list[str]) -> dict[str, Any]:
    normalized = _empty(fields)
    for field in fields:
        value = data.get(field, "")
        normalized[field] = "" if value is None else value
    return normalized


def load_recruiter_profile() -> dict[str, Any]:
    return _normalize(load_yaml_file(RECRUITER_PROFILE_PATH), RECRUITER_FIELDS)


def save_recruiter_profile(data: dict[str, Any]) -> dict[str, Any]:
    profile = _normalize(data, RECRUITER_FIELDS)
    save_yaml_file(RECRUITER_PROFILE_PATH, profile)
    log_profile_save("recruiter", profile)
    return profile


def load_jobseeker_profile() -> dict[str, Any]:
    return _normalize(load_yaml_file(JOBSEEKER_PROFILE_PATH), JOBSEEKER_FIELDS)


def save_jobseeker_profile(data: dict[str, Any]) -> dict[str, Any]:
    profile = _normalize(data, JOBSEEKER_FIELDS)
    save_yaml_file(JOBSEEKER_PROFILE_PATH, profile)
    log_profile_save("jobseeker", profile)
    return profile


def _split_text(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [item.strip() for item in str(value or "").replace("，", ",").split(",") if item.strip()]


def profile_to_job_context(profile: dict[str, Any]) -> dict[str, Any]:
    return {
        "profile_name": profile.get("profile_name", ""),
        "company": profile.get("company_name", ""),
        "title": profile.get("job_title", ""),
        "city": profile.get("city", ""),
        "salary": profile.get("salary_range", ""),
        "education_requirement": profile.get("education_requirement", ""),
        "experience_requirement": profile.get("experience_requirement", ""),
        "skills": _split_text(profile.get("core_skills")),
        "bonus_skills": _split_text(profile.get("bonus_skills")),
        "reject_rules": _split_text(profile.get("reject_rules")),
        "description": profile.get("job_description", ""),
        "communication_style": profile.get("communication_style", ""),
        "daily_contact_limit": profile.get("daily_contact_limit", ""),
        "notes": profile.get("notes", ""),
    }


def profile_to_candidate_context(profile: dict[str, Any]) -> dict[str, Any]:
    return {
        "profile_name": profile.get("profile_name", ""),
        "name": profile.get("name", ""),
        "target_job_title": profile.get("target_job_title", ""),
        "target_city": profile.get("target_city", ""),
        "expected_salary": profile.get("expected_salary", ""),
        "education": profile.get("education", ""),
        "skills": _split_text(profile.get("skills")),
        "project_experience": profile.get("project_experience", ""),
        "work_experience": profile.get("work_experience", ""),
        "avoid_companies": _split_text(profile.get("avoid_companies")),
        "avoid_industries": _split_text(profile.get("avoid_industries")),
        "communication_style": profile.get("communication_style", ""),
        "notes": profile.get("notes", ""),
    }


def log_profile_save(profile_type: str, profile: dict[str, Any]) -> None:
    try:
        from jobradar_log import log_event

        log_event(
            "profile saved",
            log_type="audit",
            level="info",
            payload={
                "profile_center": True,
                "profile_type": profile_type,
                "action": "save_profile",
                "profile_name": profile.get("profile_name", ""),
                "success": True,
            },
        )
    except Exception as exc:
        print(f"WARN: failed to write profile center log: {exc}")
