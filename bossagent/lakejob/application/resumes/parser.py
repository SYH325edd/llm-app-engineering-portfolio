"""Rule-based resume parsing and mock analysis for LakeJob Resume Center."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any


UNKNOWN = "unknown"
COMMON_SKILLS = [
    "Python",
    "Java",
    "JavaScript",
    "TypeScript",
    "React",
    "Vue",
    "FastAPI",
    "Django",
    "Flask",
    "SQL",
    "PostgreSQL",
    "MySQL",
    "Docker",
    "Kubernetes",
    "Linux",
    "Git",
    "AI",
    "LLM",
    "Prompt",
    "剪辑",
    "AI视频",
    "提示词",
    "运营",
    "销售",
    "招聘",
]


def extract_text_from_file(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".txt":
        return path.read_text(encoding="utf-8", errors="ignore")
    if suffix == ".docx":
        try:
            from docx import Document  # type: ignore
        except ImportError as exc:
            raise RuntimeError("python-docx is required to parse docx resumes") from exc
        document = Document(str(path))
        paragraphs = [paragraph.text for paragraph in document.paragraphs if paragraph.text.strip()]
        return "\n".join(paragraphs)
    if suffix == ".pdf":
        try:
            from pypdf import PdfReader  # type: ignore
        except ImportError as exc:
            raise RuntimeError("pypdf is required to parse pdf resumes") from exc
        reader = PdfReader(str(path))
        pages = [page.extract_text() or "" for page in reader.pages]
        return "\n".join(page for page in pages if page.strip())
    raise ValueError("unsupported resume file type")


def _first_match(patterns: list[str], text: str, flags: int = re.IGNORECASE) -> str:
    for pattern in patterns:
        match = re.search(pattern, text, flags)
        if match:
            value = next((group for group in match.groups() if group), match.group(0))
            value = re.sub(r"\s+", " ", value).strip(" :：,，;；")
            if value:
                return value
    return UNKNOWN


def _extract_name(text: str) -> str:
    explicit = _first_match(
        [
            r"(?:姓名|Name)\s*[:：]\s*([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z\s]{1,30})",
            r"(?:我叫|本人)\s*([\u4e00-\u9fa5]{2,4})",
        ],
        text,
    )
    if explicit != UNKNOWN:
        return explicit.split()[0]
    for line in text.splitlines()[:8]:
        line = line.strip()
        if re.fullmatch(r"[\u4e00-\u9fa5]{2,4}", line) or re.fullmatch(r"[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}", line):
            return line
    return UNKNOWN


def _extract_list_section(text: str, headings: list[str]) -> str:
    joined = "|".join(re.escape(item) for item in headings)
    pattern = rf"({joined})\s*[:：]?\s*(.+?)(?:\n\s*(?:教育经历|工作经历|项目经历|技能|自我评价|求职意向|期望薪资|$))"
    match = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
    if not match:
        return UNKNOWN
    value = re.sub(r"\n{3,}", "\n\n", match.group(2).strip())
    return value[:2000] if value else UNKNOWN


def parse_resume_text(text: str) -> dict[str, Any]:
    cleaned = re.sub(r"\r\n?", "\n", text or "").strip()
    skills = []
    for skill in COMMON_SKILLS:
        if re.search(re.escape(skill), cleaned, re.IGNORECASE):
            skills.append(skill)
    skills = sorted(set(skills), key=str.lower)

    years = _first_match(
        [
            r"(\d{1,2})\s*(?:年|\+)?\s*(?:工作经验|经验|工作年限)",
            r"(?:工作经验|工作年限)\s*[:：]?\s*(\d{1,2})\s*年",
        ],
        cleaned,
    )
    if years != UNKNOWN:
        years = f"{years}年"

    parsed = {
        "name": _extract_name(cleaned),
        "phone": _first_match([r"(1[3-9]\d{9})", r"(\+\d{1,3}\s?\d{6,14})"], cleaned),
        "email": _first_match([r"([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})"], cleaned),
        "city": _first_match([r"(?:城市|现居地|所在地|期望城市)\s*[:：]\s*([\u4e00-\u9fa5A-Za-z]{2,20})"], cleaned),
        "education": _first_match([r"(博士|硕士|研究生|本科|大专|高中|中专)", r"(Bachelor|Master|PhD|MBA)"], cleaned),
        "school": _first_match([r"(?:学校|毕业院校)\s*[:：]\s*([^\n,，;；]{2,50})", r"([\u4e00-\u9fa5A-Za-z]{2,30}(?:大学|学院|University|College))"], cleaned),
        "major": _first_match([r"(?:专业)\s*[:：]\s*([^\n,，;；]{2,50})"], cleaned),
        "skills": skills or [UNKNOWN],
        "work_years": years,
        "projects": _extract_list_section(cleaned, ["项目经历", "项目经验", "Projects"]),
        "work_experience": _extract_list_section(cleaned, ["工作经历", "工作经验", "Work Experience", "Experience"]),
        "target_role": _first_match([r"(?:目标岗位|求职意向|期望职位)\s*[:：]\s*([^\n,，;；]{2,60})"], cleaned),
        "expected_salary": _first_match([r"(?:期望薪资|薪资要求)\s*[:：]\s*([^\n,，;；]{2,40})", r"(\d{1,3}k\s*[-~]\s*\d{1,3}k)"], cleaned),
    }
    return parsed


def score_resume(parsed: dict[str, Any]) -> int:
    score = 0
    if parsed.get("education") not in (None, UNKNOWN):
        education = str(parsed["education"])
        score += 20 if education in {"博士", "硕士", "研究生", "Master", "PhD", "MBA"} else 14
    years_text = str(parsed.get("work_years") or "")
    years_match = re.search(r"\d+", years_text)
    if years_match:
        years = int(years_match.group(0))
        score += min(25, years * 5)
    skills = [item for item in parsed.get("skills", []) if item != UNKNOWN]
    score += min(25, len(skills) * 4)
    if parsed.get("projects") not in (None, UNKNOWN):
        score += 15
    if parsed.get("work_experience") not in (None, UNKNOWN):
        score += 15
    return max(0, min(100, score))


def generate_resume_summary(parsed: dict[str, Any], score: int) -> dict[str, Any]:
    skills = [item for item in parsed.get("skills", []) if item != UNKNOWN]
    target_role = parsed.get("target_role") if parsed.get("target_role") != UNKNOWN else "待确认岗位"
    profile = f"{parsed.get('name', UNKNOWN)}，目标方向为{target_role}，技能覆盖{', '.join(skills[:5]) if skills else '待补充'}。"
    strengths = []
    risks = []
    if skills:
        strengths.append("技能标签清晰，便于后续岗位匹配。")
    else:
        risks.append("技能信息不足，需要补充技术栈或能力关键词。")
    if parsed.get("projects") != UNKNOWN:
        strengths.append("简历包含项目经历，可用于生成面试追问。")
    else:
        risks.append("项目经历缺失，难以判断实操能力。")
    if parsed.get("work_experience") != UNKNOWN:
        strengths.append("简历包含工作经历，可支持经验年限判断。")
    else:
        risks.append("工作经历缺失，候选人画像可信度有限。")
    if score < 50:
        risks.append("规则评分偏低，建议人工复核简历完整度。")

    recommendations = []
    if parsed.get("target_role") != UNKNOWN:
        recommendations.append(str(parsed["target_role"]))
    if skills:
        recommendations.append(f"{skills[0]}相关岗位")
    if not recommendations:
        recommendations.append("通用候选人池")

    tags = skills[:8]
    if parsed.get("education") != UNKNOWN:
        tags.append(str(parsed["education"]))
    if parsed.get("city") != UNKNOWN:
        tags.append(str(parsed["city"]))

    return {
        "candidate_profile": profile,
        "strengths": strengths or ["暂无明确优势，需补充简历信息。"],
        "risks": risks or ["暂无明显风险。"],
        "recommended_directions": recommendations,
        "match_tags": tags or ["unknown"],
    }
