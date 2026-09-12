"""Evidence-based keyword extraction and resume/JD gap analysis."""

from __future__ import annotations

import json
import re
from typing import Any


SKILL_FIELDS = (
    "skills",
    "core_skills",
    "required_skills",
    "must_have_skills",
    "bonus_skills",
    "keywords",
    "keyword",
)

TECH_KEYWORDS = (
    "python", "java", "javascript", "typescript", "golang", "go", "c++", "c#",
    "react", "vue", "angular", "node.js", "nodejs", "fastapi", "django", "flask",
    "spring", "sql", "mysql", "postgresql", "redis", "mongodb", "elasticsearch",
    "docker", "kubernetes", "linux", "git", "aws", "azure", "gcp", "terraform",
    "pytorch", "tensorflow", "llm", "nlp", "prompt", "rag", "langchain",
    "excel", "powerbi", "tableau", "figma", "photoshop", "seo", "sem",
    "剪辑", "运营", "招聘", "销售", "数据分析", "机器学习", "深度学习",
    "人工智能", "大模型", "提示词", "项目管理", "产品经理", "用户增长",
)

ALIASES = {
    "js": "javascript",
    "ts": "typescript",
    "nodejs": "node.js",
    "postgres": "postgresql",
    "k8s": "kubernetes",
    "large language model": "llm",
    "大型语言模型": "大模型",
}


def keyword_gap(job: dict[str, Any], resume: dict[str, Any]) -> dict[str, Any]:
    """Compare JD keywords with resume evidence without inferring missing facts."""
    required = extract_keywords(job, include_text=True)
    resume_keywords = extract_keywords(resume, include_text=True)
    resume_text = searchable_text(resume)
    explicit_resume = set(extract_keywords(resume, include_text=False))

    matched = [item for item in required if contains_keyword(resume_text, item)]
    missing = [item for item in required if item not in matched]
    strong = [
        item for item in matched
        if item in explicit_resume or keyword_occurrences(resume_text, item) >= 2
    ]
    coverage = 0.0 if not required else 100.0 * len(matched) / len(required)
    return {
        "coverage": round(coverage, 3),
        "required_keywords": required,
        "resume_keywords": resume_keywords,
        "matched_keywords": matched,
        "missing_keywords": missing,
        "strong_matches": strong,
        "evidence": {
            item: "explicit skill field" if item in explicit_resume else "resume text"
            for item in matched
        },
    }


def extract_keywords(data: dict[str, Any], *, include_text: bool = True) -> list[str]:
    values: list[str] = []
    for field in SKILL_FIELDS:
        values.extend(split_values(data.get(field)))

    if include_text:
        text = searchable_text(data)
        values.extend(item for item in TECH_KEYWORDS if contains_keyword(text, item))

    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = normalize_keyword(value)
        if normalized and normalized not in seen and normalized not in {"unknown", "none", "n/a"}:
            seen.add(normalized)
            result.append(normalized)
    return result


def split_values(value: Any) -> list[str]:
    if isinstance(value, (list, tuple, set)):
        result: list[str] = []
        for item in value:
            result.extend(split_values(item))
        return result
    if isinstance(value, dict):
        return split_values(list(value.values()))
    text = str(value or "").strip()
    if not text:
        return []
    return [item.strip() for item in re.split(r"[,，;；|/\n]+", text) if item.strip()]


def normalize_keyword(value: Any) -> str:
    text = re.sub(r"\s+", " ", str(value or "").strip().lower())
    return ALIASES.get(text, text)


def searchable_text(data: dict[str, Any]) -> str:
    return json.dumps(data or {}, ensure_ascii=False, default=str).lower()


def contains_keyword(text: str, keyword: str) -> bool:
    keyword = normalize_keyword(keyword)
    if not keyword:
        return False
    if re.fullmatch(r"[a-z0-9+#. -]+", keyword):
        pattern = rf"(?<![a-z0-9]){re.escape(keyword)}(?![a-z0-9])"
        return re.search(pattern, text, re.IGNORECASE) is not None
    return keyword in text


def keyword_occurrences(text: str, keyword: str) -> int:
    keyword = normalize_keyword(keyword)
    if re.fullmatch(r"[a-z0-9+#. -]+", keyword):
        pattern = rf"(?<![a-z0-9]){re.escape(keyword)}(?![a-z0-9])"
        return len(re.findall(pattern, text, re.IGNORECASE))
    return text.count(keyword)


calculate_keyword_gap = keyword_gap
