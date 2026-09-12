"""Minimal i18n helpers for LakeJob Web Console."""

from __future__ import annotations

from typing import Any


DEFAULT_LOCALE = "zh"
SUPPORTED_LOCALES = {"zh", "en"}
LANG_COOKIE = "lakejob_lang"

TRANSLATIONS: dict[str, dict[str, str]] = {
    "zh": {
        "app_title": "LakeJob Web 控制台",
        "app_subtitle": "本地运营控制台",
        "nav.dashboard": "首页",
        "nav.jobs": "岗位池",
        "nav.job": "求职助手",
        "nav.candidates": "候选人",
        "nav.messages": "消息中心",
        "nav.message_drafts": "话术草稿",
        "nav.resumes": "简历中心",
        "nav.talent_pool": "人才库",
        "nav.profiles": "画像中心",
        "nav.recruit": "招聘助手",
        "nav.control": "控制中心",
        "nav.auth_center": "BOSS登录",
        "nav.ai_settings": "AI设置",
        "nav.logs": "日志",
        "nav.scheduler": "定时任务",
        "nav.config": "系统配置",
        "button.save": "保存",
        "button.search": "搜索",
        "button.start_search": "开始搜索候选人",
        "button.view_detail": "查看详情",
        "status.yes": "是",
        "status.no": "否",
        "status.mock": "Mock",
        "status.real": "Real",
        "status.dry_run": "Dry Run",
        "recruit.title": "招聘助手",
        "recruit.subtitle": "从招聘画像出发，搜索候选人、AI评分、分级并进入人才库。",
        "recruit.profile_summary": "招聘画像摘要",
        "recruit.keyword": "搜索关键词",
        "recruit.city": "城市",
        "recruit.skills": "技能",
        "recruit.limit": "数量限制",
        "recruit.mode": "运行模式",
        "recruit.results_title": "招聘搜索结果",
        "recruit.found": "搜索数量",
        "recruit.saved": "入库数量",
        "recruit.grade_a": "A级候选人",
        "recruit.grade_b": "B级候选人",
        "recruit.grade_c": "C级候选人",
        "recruit.candidate_list": "候选人列表",
        "recruit.to_talent_pool": "查看人才库详情",
        "control.title": "控制中心",
        "auth.title": "BOSS 登录",
        "job.title": "求职助手",
        "job.subtitle": "从求职画像出发，搜索岗位、评分、分级并进入岗位池。",
        "job.profile_summary": "求职画像摘要",
        "job.keyword": "搜索关键词",
        "job.city": "城市",
        "job.skills": "技能",
        "job.limit": "数量限制",
        "job.mode": "运行模式",
        "job.results_title": "岗位搜索结果",
        "job.found": "搜索岗位数",
        "job.saved": "入库岗位数",
        "job.grade_a": "A级岗位",
        "job.grade_b": "B级岗位",
        "job.grade_c": "C级岗位",
        "job.job_list": "岗位列表",
        "fallback.zh_only": "仅中文",
    },
    "en": {
        "app_title": "LakeJob Web Console",
        "app_subtitle": "Local operations console",
        "nav.dashboard": "Dashboard",
        "nav.jobs": "Jobs",
        "nav.job": "Job",
        "nav.candidates": "Candidates",
        "nav.messages": "Message Center",
        "nav.message_drafts": "Message Drafts",
        "nav.resumes": "Resumes",
        "nav.talent_pool": "Talent Pool",
        "nav.profiles": "Profiles",
        "nav.recruit": "Recruit",
        "nav.control": "Control Center",
        "nav.auth_center": "BOSS Login",
        "nav.ai_settings": "AI Settings",
        "nav.logs": "Logs",
        "nav.scheduler": "Scheduler",
        "nav.config": "Config",
        "button.save": "Save",
        "button.search": "Search",
        "button.start_search": "Start Candidate Search",
        "button.view_detail": "View Detail",
        "status.yes": "Yes",
        "status.no": "No",
        "status.mock": "Mock",
        "status.real": "Real",
        "status.dry_run": "Dry Run",
        "recruit.title": "Recruit",
        "recruit.subtitle": "Search, score, grade, and move candidates into Talent Pool from a recruiter profile.",
        "recruit.profile_summary": "Recruit Profile Summary",
        "recruit.keyword": "Keyword",
        "recruit.city": "City",
        "recruit.skills": "Skills",
        "recruit.limit": "Limit",
        "recruit.mode": "Mode",
        "recruit.results_title": "Recruit Search Results",
        "recruit.found": "Candidates Found",
        "recruit.saved": "Candidates Saved",
        "recruit.grade_a": "Grade A",
        "recruit.grade_b": "Grade B",
        "recruit.grade_c": "Grade C",
        "recruit.candidate_list": "Candidates",
        "recruit.to_talent_pool": "Talent Pool Detail",
        "control.title": "Control Center",
        "auth.title": "BOSS Login",
        "job.title": "Job",
        "job.subtitle": "Search, score, grade, and save jobs into Job Pool from a jobseeker profile.",
        "job.profile_summary": "Jobseeker Profile Summary",
        "job.keyword": "Keyword",
        "job.city": "City",
        "job.skills": "Skills",
        "job.limit": "Limit",
        "job.mode": "Mode",
        "job.results_title": "Job Search Results",
        "job.found": "Jobs Found",
        "job.saved": "Jobs Saved",
        "job.grade_a": "Grade A",
        "job.grade_b": "Grade B",
        "job.grade_c": "Grade C",
        "job.job_list": "Jobs",
    },
}


def _normalize_locale(value: Any) -> str | None:
    locale = str(value or "").strip().lower()
    return locale if locale in SUPPORTED_LOCALES else None


def get_locale(request: Any | None = None) -> str:
    if request is not None:
        query_locale = _normalize_locale(getattr(request, "query_params", {}).get("lang"))
        if query_locale:
            return query_locale
        cookie_locale = _normalize_locale(getattr(request, "cookies", {}).get(LANG_COOKIE))
        if cookie_locale:
            return cookie_locale
    return DEFAULT_LOCALE


def t(key: str, locale: str = DEFAULT_LOCALE) -> str:
    normalized = _normalize_locale(locale) or DEFAULT_LOCALE
    return TRANSLATIONS.get(normalized, {}).get(key) or TRANSLATIONS[DEFAULT_LOCALE].get(key) or key
