#!/usr/bin/env python3
"""
BossAutomation — 继承 BossScraper，增加点击/输入/聊天等交互能力。
"""

import json
import hashlib
import os
import random
import re
import time
from pathlib import Path
from typing import Optional, List, Dict, Any
from urllib.parse import parse_qs, quote_plus, urljoin, urlparse

from playwright.sync_api import Locator

from auth_center import NOT_READY_MESSAGE, clear_auth_error, detect_not_ready_reason, record_error
from safety_guard import check_page_safety as evaluate_page_safety
from boss_firefox import BossScraper, pause, decode_salary
from boss_state import (
    init_db,
    add_application,
    get_application_by_url,
    update_application_status,
    get_setting,
    get_today_application_count,
    get_or_create_conversation,
    get_conversation,
    add_message,
    get_messages,
    get_recent_messages,
    replace_conversation_messages,
    message_exists,
    update_conversation_last_message,
    update_conversation_status,
    update_conversation_interest,
    update_conversation_wechat,
    increment_daily_stat,
    get_today_auto_reply_count,
    find_conversation_by_hr_name,
    get_daily_stats,
)

# ── 选择器配置（BOSS UI 改版时只改这里，也可通过设置表覆盖）──
SELECTORS = {
    "apply_button": [
        'button:has-text("立即沟通")',
        'a:has-text("立即沟通")',
        '[class*="btn-chat"]',
        '[class*="start-chat"]',
        'span:has-text("立即沟通")',
        'div:has-text("立即沟通")',
    ],
    "chat_input": [
        "#chat-input",
        'div[contenteditable="true"]',
        '[class*="chat-input"]',
        '[placeholder*="请输入"]',
    ],
    "chat_send_button": [
        'button[type="send"]',
        ".btn-send",
        'button:has-text("发送")',
        'button[class*="send"]',
    ],
    "conversation_items": [
        'li[role="listitem"]',
        ".friend-content",
        '[class*="chat-item"]',
    ],
    "message_items_in_chat": [
        "li.message-item",
        'li[class*="message-item"]',
        '[class*="message-item"]',
    ],
    "unread_badge": [
        '[class*="unread"]',
        '[class*="badge"]',
        ".red-dot",
    ],
    "greeting_dialog_close": [
        'button[class*="close"]',
        '[class*="dialog-close"]',
        'span:has-text("×")',
        '[class*="modal-close"]',
        'svg[class*="close"]',
    ],
    "resume_attach_btn": [
        'div.toolbar-btn:has-text("发简历")',
        'div:has-text("发简历")',
        'button:has-text("发简历")',
        'span:has-text("发简历")',
    ],
    "resume_confirm_btn": [
        ".btn-sure-v2.btn-confirm",
        ".choose-resume-dialog .btn-confirm",
        'button:has-text("发送")',
        '.boss-popup__content button:has-text("发送")',
    ],
    "wechat_share_btn": [
        ".btn-weixin",
        'div:has-text("换微信")',
        'span:has-text("换微信")',
        '[class*="btn-weixin"]',
    ],
    "phone_share_btn": [
        ".btn-contact",
        'div:has-text("换电话")',
        'span:has-text("换电话")',
        '[class*="btn-contact"]',
    ],
    "back_to_list": [
        '[class*="back"]',
        'span:has-text("返回")',
        'button:has-text("返回")',
        'a[href*="/chat"]',
    ],
}


def _merge_selectors():
    """合并 settings 表中的选择器覆盖。"""
    try:
        from boss_state import get_setting
        import json as _json

        raw = get_setting("selector_overrides", "")
        if raw:
            overrides = _json.loads(raw)
            for k, v in overrides.items():
                if k in SELECTORS and isinstance(v, list) and len(v) > 0:
                    SELECTORS[k] = v
    except Exception:
        pass


_merge_selectors()

# ── 绝对上限 ──
MAX_APPLY_PER_DAY = 30
LEGACY_API_DISABLED_MESSAGE = "Legacy API extraction is disabled. Use VisionSearchSkill instead."
MAX_AUTO_REPLY_PER_DAY = 200
BOSS_RECRUITER_HOME_URL = "https://www.zhipin.com/web/boss/recommend"
BOSS_RECRUITER_SEARCH_URLS = [
    "https://www.zhipin.com/web/boss/recommend?query={query}",
    "https://www.zhipin.com/web/boss/search?query={query}",
    "https://www.zhipin.com/web/boss/resume?query={query}",
]
AUTH_STATE_FILE = Path(__file__).resolve().parents[1] / "runtime" / "boss_auth_state.json"
DEBUG_JOB_SEARCH_HTML = Path(__file__).resolve().parents[1] / "runtime" / "debug_job_search.html"
DEBUG_JOB_SEARCH_SCREENSHOT = Path(__file__).resolve().parents[1] / "runtime" / "debug_job_search.png"
DEBUG_CONVERSATION_HTML = Path(__file__).resolve().parents[1] / "runtime" / "debug_conversation.html"
DEBUG_CONVERSATION_SCREENSHOT = Path(__file__).resolve().parents[1] / "runtime" / "debug_conversation.png"
DEBUG_BUTTONS_JSON = Path(__file__).resolve().parents[1] / "runtime" / "debug_buttons.json"
DEBUG_CONVERSATION_LOADING_HTML = Path(__file__).resolve().parents[1] / "runtime" / "debug_conversation_loading.html"
DEBUG_CONVERSATION_LOADING_SCREENSHOT = Path(__file__).resolve().parents[1] / "runtime" / "debug_conversation_loading.png"
DEBUG_AFTER_CLICK_CONVERSATION_HTML = Path(__file__).resolve().parents[1] / "runtime" / "debug_after_click_conversation.html"
DEBUG_AFTER_CLICK_CONVERSATION_SCREENSHOT = Path(__file__).resolve().parents[1] / "runtime" / "debug_after_click_conversation.png"
DEBUG_APPLY_HTML = Path(__file__).resolve().parents[1] / "runtime" / "debug_apply.html"
DEBUG_APPLY_SCREENSHOT = Path(__file__).resolve().parents[1] / "runtime" / "debug_apply.png"
DEBUG_POST_CHAT_MODAL_HTML = Path(__file__).resolve().parents[1] / "runtime" / "debug_post_chat_modal.html"
DEBUG_POST_CHAT_MODAL_SCREENSHOT = Path(__file__).resolve().parents[1] / "runtime" / "debug_post_chat_modal.png"
DEBUG_NOT_READY_HTML = Path(__file__).resolve().parents[1] / "runtime" / "debug_boss_not_ready.html"
DEBUG_NOT_READY_SCREENSHOT = Path(__file__).resolve().parents[1] / "runtime" / "debug_boss_not_ready.png"
JOB_CONVERSATION_BUTTON_LABELS = ("立即沟通", "立即联系", "聊一聊", "沟通", "立即咨询", "继续沟通")
JOB_CONVERSATION_BUTTON_SELECTORS = (
    'button:has-text("立即沟通")',
    'a:has-text("立即沟通")',
    'span:has-text("立即沟通")',
    'div:has-text("立即沟通")',
    'button:has-text("立即联系")',
    'a:has-text("立即联系")',
    'button:has-text("聊一聊")',
    'a:has-text("聊一聊")',
    'button:has-text("沟通")',
    'a:has-text("沟通")',
    'button:has-text("立即咨询")',
    'a:has-text("立即咨询")',
    '[class*="chat"]',
    '[class*="communicate"]',
    '[class*="btn"]',
)


class BossAutomation(BossScraper):
    """在 BossScraper 基础上增加交互能力"""

    def __init__(self, headless=False):
        super().__init__(headless)
        init_db()

    def start(self):
        super().start()
        self._load_auth_state()

    # ══════════════════════════════════════
    #  底层交互 helpers
    # ══════════════════════════════════════

    def _find_element(self, selector_list: List[str], timeout_ms: int = 5000) -> Optional[Locator]:
        """逐个尝试选择器，返回第一个可见匹配。"""
        deadline = time.time() + timeout_ms / 1000
        while time.time() < deadline:
            for sel in selector_list:
                try:
                    loc = self.page.locator(sel).first
                    if loc.is_visible():
                        return loc
                except Exception:
                    continue
            time.sleep(0.3)
        return None

    def _find_all_elements(self, selector_list: List[str]) -> List[Locator]:
        """返回所有匹配的可见元素。"""
        for sel in selector_list:
            try:
                locs = self.page.locator(sel)
                count = locs.count()
                if count > 0:
                    return [locs.nth(i) for i in range(count)]
            except Exception:
                continue
        return []

    def _human_type(self, locator: Locator, text: str):
        """逐字输入，模拟真人打字。"""
        try:
            locator.click()
            time.sleep(random.uniform(0.1, 0.3))
        except Exception:
            pass
        for ch in text:
            self.page.keyboard.type(ch, delay=random.randint(50, 150))
        time.sleep(random.uniform(0.3, 0.8))

    def _safe_click(self, locator: Locator):
        """带随机延迟的点击。"""
        time.sleep(random.uniform(0.2, 0.6))
        try:
            locator.hover()
            time.sleep(random.uniform(0.1, 0.3))
        except Exception:
            pass
        locator.click()

    def _has_text(self, *texts: str) -> bool:
        """检查页面是否包含任意关键词。"""
        try:
            body = self.page.inner_text("body").lower()
            return any(t.lower() in body for t in texts)
        except Exception:
            return False

    # ══════════════════════════════════════
    #  安全检查
    # ══════════════════════════════════════

    def check_page_safety(self) -> bool:
        """所有自动化操作前检查页面安全状态。"""
        try:
            screenshot_dir = Path(__file__).resolve().parents[1] / "runtime" / "safety"
            screenshot_dir.mkdir(parents=True, exist_ok=True)
            screenshot_path = screenshot_dir / f"page_{int(time.time() * 1000)}.png"
            self.page.screenshot(path=str(screenshot_path), full_page=True)
            page_title = self.page.title()
            url = self.page.url
            ocr_text = self.page.inner_text("body")
            vision_page_state = {
                "page_status": "unknown",
                "ocr_text": ocr_text,
                "source": "dom_text_fallback",
            }
            result = evaluate_page_safety(
                account_id=getattr(self, "_safety_account_id", None) or os.getenv("LAKEJOB_ACCOUNT_ID") or None,
                source=getattr(self, "_safety_source", "boss_automation"),
                page_title=page_title,
                url=url,
                screenshot_path=str(screenshot_path),
                ocr_text=ocr_text,
                vision_page_state=vision_page_state,
            )
            if result.get("blocked"):
                print(f"  ⚠️ 安全检查阻断: {result.get('reason')}")
                return False
            return True
        except Exception as exc:
            print(f"  ⚠️ 安全检查异常，已阻断: {exc}")
            return False

    def _save_not_ready_debug(self, reason: str, *, kind: str = "auth") -> None:
        try:
            DEBUG_NOT_READY_HTML.parent.mkdir(parents=True, exist_ok=True)
            DEBUG_NOT_READY_HTML.write_text(self.page.content(), encoding="utf-8")
            self.page.screenshot(path=str(DEBUG_NOT_READY_SCREENSHOT), full_page=True)
        except Exception as exc:
            print(f"  BOSS not-ready debug save failed: {exc}")
        record_error(kind, NOT_READY_MESSAGE, reason=reason)
        print(NOT_READY_MESSAGE)

    # ══════════════════════════════════════
    #  Session 保活 & 心跳
    # ══════════════════════════════════════

    def check_logged_in(self) -> bool:
        """快速检查当前是否已登录；未知空白页不直接当作过期。"""
        try:
            return self.is_logged_in_page()
        except Exception:
            return False

    def heartbeat(self) -> bool:
        """心跳: 只检查当前页面登录状态，不主动跳转。"""
        try:
            return self.check_logged_in()
        except Exception:
            return False

    def keep_alive(self):
        """主动保活: 在聊天页保持 BOSS session 活跃。已登录时用轻量操作代替完整刷新。"""
        try:
            if not self.check_logged_in():
                return False
            current_url = self.page.url
            need_navigate = "/web/geek/chat" not in current_url
            try:
                if need_navigate:
                    self.page.goto("https://www.zhipin.com/web/geek/chat", wait_until="load", timeout=30000)
                    pause(2, 4)
                else:
                    # 已在聊天页，轻量滚动模拟用户活动，避免频繁 reload 被检测
                    try:
                        self.page.mouse.move(random.randint(200, 600), random.randint(300, 500))
                        pause(0.5, 1.0)
                        self.page.evaluate("window.scrollBy(0, %d)" % random.randint(-100, 100))
                    except Exception:
                        pass
            except Exception:
                pass
            return self.check_logged_in()
        except Exception:
            return False

    def _load_auth_state(self) -> None:
        """Load saved BOSS cookies into the persistent browser context."""
        if not AUTH_STATE_FILE.exists() or not self._ctx:
            return
        try:
            state = json.loads(AUTH_STATE_FILE.read_text(encoding="utf-8"))
            cookies = state.get("cookies") or []
            if cookies:
                self._ctx.add_cookies(cookies)
                print(f"  BOSS auth state loaded: {AUTH_STATE_FILE}")
        except Exception as exc:
            print(f"  BOSS auth state load skipped: {exc}")

    def reset_auth_state(self) -> None:
        """Delete saved BOSS auth state so the next run asks for QR login again."""
        try:
            if AUTH_STATE_FILE.exists():
                AUTH_STATE_FILE.unlink()
                print(f"  BOSS auth state deleted: {AUTH_STATE_FILE}")
        except Exception as exc:
            print(f"  BOSS auth state delete failed: {exc}")

    def _save_state(self):
        """Save current browser auth state to runtime/boss_auth_state.json."""
        try:
            state = self._ctx.storage_state()
            AUTH_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
            AUTH_STATE_FILE.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
            print(f"  BOSS auth state saved: {AUTH_STATE_FILE}")
        except Exception as exc:
            print(f"  BOSS auth state save failed: {exc}")

    def _ensure_logged_in_once(self, target_url: str, label: str) -> bool:
        """Navigate once and require auth to have been prepared independently."""
        try:
            self.page.goto(target_url, wait_until="load", timeout=45000)
            self.page.bring_to_front()
            pause(2, 4)
            body = self._body_text(5000)
            reason = detect_not_ready_reason(self.page.url, body)
            if reason or self._login_prompt_visible():
                self._save_not_ready_debug(reason or "login")
                return False
            clear_auth_error()
            return True
        except Exception as exc:
            record_error("auth", str(exc), reason="navigation")
            print(f"  {label}: login check failed: {exc}")
            return False

    # ────────────────────────────────────────────────────────────
    # JobRadar real-mode job search
    # ────────────────────────────────────────────────────────────

    def ensure_jobseeker_logged_in(self) -> bool:
        """Open BOSS job-seeker pages and wait for a usable logged-in session."""
        return self._ensure_logged_in_once("https://www.zhipin.com/web/geek/job", "JobRadar")

    def search_jobs_real(self, keyword: str, city_code: str = "100010000", limit: int = 10) -> List[dict]:
        """Search real BOSS job-seeker job results and return raw BOSS job dictionaries."""
        if not self.ensure_jobseeker_logged_in():
            raise RuntimeError("BOSS job-seeker login is required for real job search")
        search_url = "https://www.zhipin.com/web/geek/job?query=%s&city=%s" % (
            quote_plus(keyword),
            city_code,
        )
        wait_seconds = 5
        self.page.goto(search_url, wait_until="load", timeout=45000)
        pause(wait_seconds, wait_seconds + 1)
        body = self._body_text(5000)
        reason = detect_not_ready_reason(self.page.url, body)
        if reason:
            self._save_not_ready_debug(reason, kind="search")
            raise RuntimeError(NOT_READY_MESSAGE)
        self._scroll_all(max_scrolls=8, stable_rounds=2)
        jobs = self._extract_job_cards_real(keyword)
        candidate_count = self._count_job_card_candidates()
        page_url = ""
        page_title = ""
        try:
            page_url = self.page.url
            page_title = self.page.title()
        except Exception:
            pass
        print(
            "  JobRadar search debug: "
            f"url={page_url} title={page_title!r} keyword={keyword!r} "
            f"wait={wait_seconds}s candidate_cards={candidate_count} parsed_jobs={len(jobs)}"
        )
        if not jobs:
            body = self._body_text(3000)
            if candidate_count == 0 and self._page_has_job_like_text(body):
                print("  JobRadar search debug: page has job-like text but candidate card selectors matched 0")
            self._save_job_search_debug()
        normalized = []
        for job in jobs[: max(0, limit)]:
            url = job.get("url") or job.get("source_url") or ""
            normalized.append(
                {
                    **job,
                    "platform_job_id": job.get("platform_job_id") or job.get("external_job_id") or url,
                    "external_job_id": job.get("external_job_id") or job.get("platform_job_id") or url,
                    "source_url": url,
                    "search_debug_url": page_url,
                    "debug_html_path": str(DEBUG_JOB_SEARCH_HTML),
                    "debug_screenshot_path": str(DEBUG_JOB_SEARCH_SCREENSHOT),
                    "raw_payload": {**job, "search_debug_url": page_url},
                }
            )
        return normalized

    def _count_job_card_candidates(self) -> int:
        try:
            return int(
                self.page.evaluate(
                    """() => document.querySelectorAll([
                        '.job-card-wrapper',
                        '.job-list-box li',
                        '.job-primary',
                        '.job-card-body',
                        '[class*="job-card"]',
                        '[class*="job-list"] li'
                    ].join(',')).length"""
                )
            )
        except Exception:
            return 0

    def _page_has_job_like_text(self, body: str) -> bool:
        return bool(re.search(r"Python|AI|设计师|工程师|开发|招聘|经验|本科|薪|K|k", body or ""))

    def _save_job_search_debug(self) -> None:
        try:
            DEBUG_JOB_SEARCH_HTML.parent.mkdir(parents=True, exist_ok=True)
            DEBUG_JOB_SEARCH_HTML.write_text(self.page.content(), encoding="utf-8")
            self.page.screenshot(path=str(DEBUG_JOB_SEARCH_SCREENSHOT), full_page=True)
            print(f"  JobRadar search debug HTML saved: {DEBUG_JOB_SEARCH_HTML}")
            print(f"  JobRadar search debug screenshot saved: {DEBUG_JOB_SEARCH_SCREENSHOT}")
        except Exception as exc:
            print(f"  JobRadar search debug save failed: {exc}")

    def _extract_job_cards_real(self, keyword: str = "") -> List[dict]:
        try:
            rows = self.page.evaluate(
                """() => {
                    const selectors = [
                        '.job-card-wrapper',
                        '.job-list-box li',
                        '.job-primary',
                        '.job-card-body',
                        '[class*="job-card"]',
                        '[class*="job-list"] li'
                    ];
                    const visible = (el) => {
                        if (!el) return false;
                        const style = getComputedStyle(el);
                        const rect = el.getBoundingClientRect();
                        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
                    };
                    const linesOf = (root) => (root.innerText || '')
                        .split('\\n')
                        .map(s => s.trim())
                        .filter(Boolean);
                    const pickText = (root, sels) => {
                        for (const sel of sels) {
                            const el = root.querySelector(sel);
                            const text = (el && (el.innerText || el.textContent) || '').trim();
                            if (text) return text;
                        }
                        return '';
                    };
                    const absolutize = (href) => {
                        if (!href) return '';
                        try { return new URL(href, 'https://www.zhipin.com').href; } catch(e) { return href; }
                    };
                    const roots = Array.from(document.querySelectorAll(selectors.join(','))).filter(visible);
                    const cards = [];
                    const seen = new Set();
                    for (const root of roots) {
                        const text = (root.innerText || '').trim();
                        if (!text || text.length < 4) continue;
                        const link = root.querySelector('a[href*="/job_detail/"], a[href*="job_detail"], a[href]');
                        const href = absolutize(link ? (link.href || link.getAttribute('href') || '') : '');
                        const lines = linesOf(root);
                        let title = pickText(root, [
                            '.job-name',
                            '.job-title',
                            '[class*="job-name"]',
                            '[class*="job-title"]',
                            '[class*="position-name"]',
                            '[class*="name"]'
                        ]) || (link && (link.innerText || link.textContent) || '').trim().split('\\n')[0] || '';
                        let salary = pickText(root, ['.salary', '.red', '[class*="salary"]'])
                            || lines.find(x => /\\d+\\s*[-~至]\\s*\\d+\\s*[Kk]|\\d+\\s*[Kk]/.test(x)) || '';
                        let company = pickText(root, [
                            '.company-name',
                            '.brand-name',
                            '.company-text',
                            '[class*="company-name"]',
                            '[class*="brand-name"]',
                            '[class*="company"]'
                        ]);
                        let city = pickText(root, ['.job-area', '[class*="job-area"]', '[class*="area"]'])
                            || lines.find(x => /北京|上海|深圳|广州|杭州|成都|武汉|南京|苏州|西安|重庆|天津|青岛|厦门|长沙|郑州|合肥|全国|远程/.test(x) && x.length <= 40) || '';
                        let experience = lines.find(x => /经验|应届|在校|不限|\\d+年/.test(x) && x.length <= 40) || '';
                        let education = lines.find(x => /本科|硕士|博士|大专|学历|中专|高中/.test(x) && x.length <= 40) || '';
                        if (!title) {
                            title = lines.find(x =>
                                x !== salary && x !== city &&
                                !/经验|本科|硕士|博士|大专|学历|薪|公司|招聘者|在线/.test(x) &&
                                x.length >= 2 && x.length <= 60
                            ) || '';
                        }
                        if (!company) {
                            company = lines.find(x =>
                                x !== title && x !== salary && x !== city &&
                                !/经验|本科|硕士|博士|大专|学历|不限|\\d+[-~至]\\d+[Kk]/.test(x) &&
                                x.length >= 2 && x.length <= 60
                            ) || '';
                        }
                        title = (title || '').replace(/\\s+/g, ' ').trim();
                        const key = href || `${title}-${company}-${salary}-${city}-${cards.length}`;
                        if (!title || seen.has(key)) continue;
                        seen.add(key);
                        cards.push({
                            title,
                            company,
                            city,
                            salary,
                            experience,
                            education,
                            source_url: href,
                            url: href,
                            raw_text: text
                        });
                    }
                    return cards;
                }"""
            )
        except Exception as exc:
            print(f"  JobRadar job card extraction failed: {exc}")
            return []

        jobs: List[dict] = []
        current_url = ""
        try:
            current_url = self.page.url
        except Exception:
            pass
        for index, row in enumerate(rows or [], start=1):
            title = (row.get("title") or "").strip()
            if not title:
                continue
            source_url = self._normalize_job_url(row.get("source_url") or row.get("url") or "")
            platform_job_id = self._extract_platform_job_id(source_url, title, index)
            if not source_url:
                source_url = f"{current_url}#job-{platform_job_id}" if current_url else f"mockless://boss/job/{platform_job_id}"
            jobs.append(
                {
                    "platform_job_id": platform_job_id,
                    "external_job_id": platform_job_id,
                    "source_url": source_url,
                    "url": source_url,
                    "title": title,
                    "company": (row.get("company") or "").strip(),
                    "city": (row.get("city") or "").strip(),
                    "salary": decode_salary((row.get("salary") or "").strip()),
                    "experience": (row.get("experience") or "").strip(),
                    "education": (row.get("education") or "").strip(),
                    "description": "",
                    "raw_payload": row,
                    "query": keyword,
                }
            )
        return jobs

    def _normalize_job_url(self, url: str) -> str:
        url = (url or "").strip()
        if not url:
            return ""
        return urljoin("https://www.zhipin.com", url)

    def _extract_platform_job_id(self, source_url: str, title: str, index: int) -> str:
        if source_url:
            parsed = urlparse(source_url)
            query = parse_qs(parsed.query)
            for key in ("jobId", "jobid", "lid", "ka"):
                if query.get(key):
                    return str(query[key][0])
            match = re.search(r"/job_detail/([^/?#]+)", parsed.path)
            if match:
                return match.group(1)
        raw = f"{source_url}|{title}|{index}"
        return "boss-job-" + hashlib.sha1(raw.encode("utf-8", errors="ignore")).hexdigest()[:16]

    def fetch_job_detail(self, job_url: str) -> dict:
        """Fetch real BOSS job detail using the job-seeker detail page."""
        detail = self.fetch_detail(job_url)
        try:
            page_data = self.page.evaluate(
                """() => {
                    const text = (document.body && document.body.innerText || '').trim();
                    const lines = text.split('\\n').map(s => s.trim()).filter(Boolean);
                    const pick = (selectors) => {
                        for (const sel of selectors) {
                            const el = document.querySelector(sel);
                            const value = (el && (el.innerText || el.textContent) || '').trim();
                            if (value) return value;
                        }
                        return '';
                    };
                    const title = pick(['.job-name', '.name', '[class*="job-name"]', '[class*="job-title"]'])
                        || lines.find(x => /工程师|开发|设计师|产品|运营|算法|经理|主管|专家|架构|测试|前端|后端|全栈|数据|AI|Python|Java|Go/.test(x) && x.length <= 80) || '';
                    const salary = pick(['.salary', '.job-salary', '[class*="salary"]'])
                        || lines.find(x => /\\d+\\s*[-~至]\\s*\\d+\\s*[Kk]|\\d+\\s*[Kk]/.test(x)) || '';
                    const company = pick(['.company-name', '.brand-name', '[class*="company-name"]', '[class*="brand-name"]'])
                        || lines.find(x => x !== title && x.length >= 2 && x.length <= 60 && /公司|科技|信息|网络|智能|传媒|文化|教育|咨询/.test(x)) || '';
                    const city = pick(['.job-area', '[class*="job-area"]'])
                        || lines.find(x => /北京|上海|深圳|广州|杭州|成都|武汉|南京|苏州|西安|重庆|天津|青岛|厦门|长沙|郑州|合肥|全国|远程/.test(x) && x.length <= 40) || '';
                    const experience = lines.find(x => /经验|应届|在校|不限|\\d+年/.test(x) && x.length <= 40) || '';
                    const education = lines.find(x => /本科|硕士|博士|大专|学历|中专|高中/.test(x) && x.length <= 40) || '';
                    return {title, salary, company, city, experience, education};
                }"""
            )
            for key, value in (page_data or {}).items():
                if value and not detail.get(key):
                    detail[key] = value
        except Exception:
            pass
        detail["source_url"] = job_url
        detail["url"] = job_url
        detail["raw_payload"] = detail.copy()
        return detail

    def open_job_conversation(self, job: dict) -> bool:
        """Open the BOSS communication entry for one job without sending text."""
        raise RuntimeError(LEGACY_API_DISABLED_MESSAGE)
        job_url = job.get("source_url") or job.get("url") or ""
        if not job_url:
            return False
        try:
            self.page.goto(job_url, wait_until="load", timeout=45000)
            pause(1, 2)
            if not self.check_page_safety():
                return False
            if self._has_text("已沟通", "继续沟通"):
                return True
            apply_btn = self._find_element(SELECTORS["apply_button"])
            if not apply_btn:
                return False
            self._safe_click(apply_btn)
            pause(2, 3)
            return True
        except Exception as exc:
            print(f"  JobRadar open job conversation failed: {exc}")
            return False

    def open_job_conversation(self, job: dict) -> bool:
        """Open the BOSS communication entry for one job with debug artifacts on failure."""
        raise RuntimeError(LEGACY_API_DISABLED_MESSAGE)
        job_url = job.get("source_url") or job.get("url") or ""
        if not job_url:
            print("  JobRadar conversation debug: missing job_url")
            raise RuntimeError("missing job_url")

        def opened_result(**overrides) -> dict:
            result = {"opened": True, "real_message_sent": False, "modal_handled": False, "reason": "chat_opened"}
            result.update(overrides)
            return result

        def save_debug(reason: str) -> None:
            try:
                DEBUG_CONVERSATION_HTML.parent.mkdir(parents=True, exist_ok=True)
                DEBUG_CONVERSATION_HTML.write_text(self.page.content(), encoding="utf-8")
                self.page.screenshot(path=str(DEBUG_CONVERSATION_SCREENSHOT), full_page=True)
                print(f"  JobRadar conversation debug saved: reason={reason}")
                print(f"  JobRadar conversation debug html: {DEBUG_CONVERSATION_HTML}")
                print(f"  JobRadar conversation debug screenshot: {DEBUG_CONVERSATION_SCREENSHOT}")
            except Exception as debug_exc:
                print(f"  JobRadar conversation debug save failed: {debug_exc}")

        def save_page_artifact(html_path: Path, screenshot_path: Path, reason: str) -> None:
            try:
                html_path.parent.mkdir(parents=True, exist_ok=True)
                html_path.write_text(self.page.content(), encoding="utf-8")
                self.page.screenshot(path=str(screenshot_path), full_page=True)
                print(f"  [CONVERSATION] debug saved: reason={reason}")
                print(f"  [CONVERSATION] debug html: {html_path}")
                print(f"  [CONVERSATION] debug screenshot: {screenshot_path}")
            except Exception as debug_exc:
                print(f"  [CONVERSATION] debug save failed: {debug_exc}")

        def page_snapshot(label: str, candidate_count: int = 0) -> None:
            try:
                print(
                    "  JobRadar conversation debug: "
                    f"{label} current_url={self.page.url} title={self.page.title()!r} "
                    f"job_url={job_url} candidate_buttons={candidate_count}"
                )
            except Exception as snap_exc:
                print(f"  JobRadar conversation debug snapshot failed: {snap_exc}")

        def page_has_any_text(*texts: str) -> bool:
            try:
                body = self.page.inner_text("body")
                return any(text in body for text in texts)
            except Exception:
                return False

        def detect_blocking_state() -> str:
            if self._login_prompt_visible() or page_has_any_text("登录失效", "请登录", "扫码登录"):
                return "login expired or login required"
            if page_has_any_text("验证码", "滑块", "拼图", "captcha", "verify"):
                return "captcha or verification required"
            if page_has_any_text("风控", "账号异常", "限制使用", "操作太频繁", "稍后再试"):
                return "risk control or frequency limit"
            return ""

        def wait_until_job_detail_loaded() -> bool:
            for attempt in range(1, 11):
                print(f"[CONVERSATION] waiting job detail loaded: attempt {attempt}")
                try:
                    loaded = bool(
                        self.page.evaluate(
                            """() => {
                                const body = (document.body && document.body.innerText || '');
                                if (body.includes('立即沟通')) return true;
                                if (body.includes('职位描述')) return true;
                                if (body.includes('岗位职责')) return true;
                                if (body.includes('公司基本信息')) return true;
                                if (document.querySelector('.job-sec-text')) return true;
                                if (document.querySelector('.job-detail')) return true;
                                if (document.querySelector('.job-banner')) return true;
                                if (document.querySelector('[class*="job"]')) return true;
                                return false;
                            }"""
                        )
                    )
                except Exception:
                    loaded = False
                if loaded:
                    return True
                time.sleep(2)
            save_page_artifact(
                DEBUG_CONVERSATION_LOADING_HTML,
                DEBUG_CONVERSATION_LOADING_SCREENSHOT,
                "BOSS job detail page did not finish loading",
            )
            raise RuntimeError("BOSS job detail page did not finish loading")

        def scan_button_and_link_debug() -> list[dict]:
            try:
                items = self.page.evaluate(
                    """() => {
                        const clean = (value) => ((value || '') + '').trim().replace(/\\s+/g, ' ');
                        const read = (el, tag) => ({
                            tag,
                            text: clean(el.innerText || el.textContent),
                            class: clean(el.getAttribute('class')),
                            id: clean(el.getAttribute('id')),
                            href: clean(el.getAttribute('href')),
                            role: clean(el.getAttribute('role')),
                        });
                        const items = [];
                        document.querySelectorAll('button').forEach(el => items.push(read(el, 'button')));
                        document.querySelectorAll('a').forEach(el => items.push(read(el, 'a')));
                        document.querySelectorAll('div[role="button"]').forEach(el => items.push(read(el, 'div[role=button]')));
                        document.querySelectorAll('span').forEach(el => items.push(read(el, 'span')));
                        document.querySelectorAll('div').forEach(el => items.push(read(el, 'div')));
                        return items;
                    }"""
                )
            except Exception as exc:
                print(f"  [CONVERSATION] failed to scan buttons: {exc}")
                items = []
            for item in items:
                if item.get("tag") == "button":
                    print(
                        "[CONVERSATION] button: "
                        f"inner_text={item.get('text', '')!r} class={item.get('class', '')!r} id={item.get('id', '')!r}"
                    )
                elif item.get("tag") == "a":
                    print(
                        "[CONVERSATION] a: "
                        f"inner_text={item.get('text', '')!r} class={item.get('class', '')!r} href={item.get('href', '')!r}"
                    )
                elif item.get("tag") in ("div[role=button]", "span", "div"):
                    print(
                        "[CONVERSATION] candidate: "
                        f"tag={item.get('tag', '')!r} inner_text={item.get('text', '')!r} "
                        f"class={item.get('class', '')!r} id={item.get('id', '')!r}"
                    )
            try:
                DEBUG_BUTTONS_JSON.parent.mkdir(parents=True, exist_ok=True)
                DEBUG_BUTTONS_JSON.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
                print(f"  [CONVERSATION] debug buttons saved: {DEBUG_BUTTONS_JSON}")
            except Exception as exc:
                print(f"  [CONVERSATION] failed to save debug buttons: {exc}")
            return items

        def click_text_button_from_scan(items: list[dict]) -> bool:
            labels = ("立即沟通", "立即联系", "聊一聊", "沟通", "立即咨询", "继续沟通")
            try:
                direct = self.page.locator("text=立即沟通").first
                if direct.is_visible(timeout=1500):
                    before_pages = set(self._ctx.pages) if self._ctx else set()
                    direct.scroll_into_view_if_needed()
                    time.sleep(0.5)
                    direct.click(force=True)
                    if self._ctx:
                        new_pages = [p for p in self._ctx.pages if p not in before_pages]
                        if new_pages:
                            self.page = new_pages[-1]
                            self.page.bring_to_front()
                            print(f"  [CONVERSATION] switched to new tab url={self.page.url}")
                    try:
                        self.page.wait_for_load_state("networkidle", timeout=10000)
                    except Exception:
                        pass
                    print("[CONVERSATION] clicked button: 立即沟通")
                    return True
            except Exception as exc:
                print(f"  [CONVERSATION] direct text=立即沟通 click failed: {exc}")
            for item in items:
                text = (item.get("text") or "").strip()
                tag = item.get("tag") or ""
                if tag not in ("button", "a", "div[role=button]", "span", "div"):
                    continue
                if not any(label in text for label in labels):
                    continue
                try:
                    selector = 'div[role="button"]' if tag == "div[role=button]" else tag
                    loc = self.page.locator(selector).filter(has_text=text).first
                    before_pages = set(self._ctx.pages) if self._ctx else set()
                    loc.scroll_into_view_if_needed()
                    time.sleep(0.5)
                    loc.click(force=True)
                    if self._ctx:
                        new_pages = [p for p in self._ctx.pages if p not in before_pages]
                        if new_pages:
                            self.page = new_pages[-1]
                            self.page.bring_to_front()
                            print(f"  [CONVERSATION] switched to new tab url={self.page.url}")
                    try:
                        self.page.wait_for_load_state("networkidle", timeout=10000)
                    except Exception:
                        pass
                    print(f"[CONVERSATION] clicked button: {text}")
                    return True
                except Exception as exc:
                    print(f"  [CONVERSATION] click failed: tag={tag} text={text!r} error={exc}")
                    save_debug(f"click failed: {text}")
                    raise
            save_debug("no direct text communication button")
            raise RuntimeError("no direct text communication button found")

        def collect_buttons() -> list[dict]:
            try:
                return self.page.evaluate(
                    """({selectors, labels}) => {
                        const visible = (el) => {
                            const style = getComputedStyle(el);
                            const rect = el.getBoundingClientRect();
                            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
                        };
                        const seen = new Set();
                        const items = [];
                        const push = (el, selector) => {
                            if (!el || !visible(el)) return;
                            const text = ((el.innerText || el.textContent || '') + '').trim();
                            const cls = (el.getAttribute('class') || '').trim();
                            const href = (el.getAttribute('href') || '').trim();
                            const key = `${selector}|${text}|${cls}|${href}`;
                            if (seen.has(key)) return;
                            seen.add(key);
                            const textMatch = labels.some(label => text.includes(label));
                            const classMatch = /chat|communicate|btn/i.test(cls);
                            if (textMatch || classMatch) items.push({text, className: cls, href, selector});
                        };
                        selectors.forEach(selector => {
                            document.querySelectorAll(selector).forEach(el => push(el, selector));
                        });
                        document.querySelectorAll('button,a,span,div').forEach(el => {
                            const text = ((el.innerText || el.textContent || '') + '').trim();
                            if (labels.some(label => text.includes(label))) push(el, 'text-scan');
                        });
                        return items.slice(0, 80);
                    }""",
                    {"selectors": list(JOB_CONVERSATION_BUTTON_SELECTORS), "labels": list(JOB_CONVERSATION_BUTTON_LABELS)},
                )
            except Exception as exc:
                print(f"  JobRadar conversation debug collect buttons failed: {exc}")
                return []

        def click_candidate_button() -> bool:
            candidates = collect_buttons()
            page_snapshot("after-load", len(candidates))
            for idx, item in enumerate(candidates):
                text = (item.get("text") or "").strip()
                cls = (item.get("className") or "").strip()
                selector = item.get("selector") or ""
                print(f"  JobRadar conversation debug button[{idx}]: text={text!r} class={cls!r} selector={selector!r}")
            for item in candidates:
                text = (item.get("text") or "").strip()
                selector = item.get("selector") or ""
                try:
                    before_pages = set(self._ctx.pages) if self._ctx else set()
                    if selector == "text-scan":
                        handle = self.page.evaluate_handle(
                            """({labels}) => {
                                const visible = (el) => {
                                    const style = getComputedStyle(el);
                                    const rect = el.getBoundingClientRect();
                                    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
                                };
                                for (const el of document.querySelectorAll('button,a,span,div')) {
                                    const text = ((el.innerText || el.textContent || '') + '').trim();
                                    if (visible(el) && labels.some(label => text.includes(label))) return el;
                                }
                                return null;
                            }""",
                            {"labels": list(JOB_CONVERSATION_BUTTON_LABELS)},
                        )
                        element = handle.as_element() if handle else None
                        if not element:
                            continue
                        print(f"  JobRadar conversation debug: clicking button text={text!r}")
                        element.click()
                    else:
                        loc = self.page.locator(selector).filter(has_text=text).first if text else self.page.locator(selector).first
                        print(f"  JobRadar conversation debug: clicking button text={text!r}")
                        loc.click()
                    time.sleep(1)
                    if self._ctx:
                        new_pages = [p for p in self._ctx.pages if p not in before_pages]
                        if new_pages:
                            self.page = new_pages[-1]
                            self.page.bring_to_front()
                            print(f"  JobRadar conversation debug: switched to new tab url={self.page.url}")
                    try:
                        self.page.wait_for_load_state("networkidle", timeout=10000)
                    except Exception:
                        pass
                    return True
                except Exception as click_exc:
                    print(f"  JobRadar conversation debug click failed: text={text!r} error={click_exc}")
            return False

        def is_chat_open() -> bool:
            try:
                if "/chat" in self.page.url:
                    return True
                if self._find_element(SELECTORS["chat_input"], timeout_ms=2000):
                    return True
                return bool(
                    self.page.evaluate(
                        """() => {
                            const body = (document.body && document.body.innerText || '');
                            if (body.includes('发送')) return true;
                            if (body.includes('新开聊')) return true;
                            if (body.includes('已沟通')) return true;
                            if (body.includes('继续沟通')) return true;
                            if (document.querySelector('textarea')) return true;
                            if (document.querySelector('[contenteditable="true"]')) return true;
                            return false;
                        }"""
                    )
                )
            except Exception:
                return False

        try:
            self.page.goto(job_url, wait_until="load", timeout=45000)
            pause(1, 2)
            page_snapshot("loaded")
            wait_until_job_detail_loaded()
            block_reason = detect_blocking_state()
            if block_reason:
                print(f"  JobRadar conversation error: {block_reason}")
                save_debug(block_reason)
                raise RuntimeError(block_reason)
            if not self.check_page_safety():
                save_debug("page safety check failed")
                raise RuntimeError("page safety check failed")
            if is_chat_open():
                page_snapshot("already-open")
                return opened_result(reason="already_open")

            scanned_buttons = scan_button_and_link_debug()
            try:
                before_click_url = self.page.url
                if click_text_button_from_scan(scanned_buttons):
                    time.sleep(3)
                    block_reason = detect_blocking_state()
                    if block_reason:
                        print(f"  JobRadar conversation error after click: {block_reason}")
                        save_debug(block_reason)
                        raise RuntimeError(block_reason)
                    modal_result = self.handle_boss_post_chat_modal()
                    if modal_result.get("modal_handled") or modal_result.get("real_message_sent"):
                        return modal_result
                    if self.page.url != before_click_url:
                        page_snapshot("opened-url-changed")
                        return opened_result(reason="url_changed")
                    if is_chat_open():
                        page_snapshot("opened")
                        return opened_result()
                    save_page_artifact(
                        DEBUG_AFTER_CLICK_CONVERSATION_HTML,
                        DEBUG_AFTER_CLICK_CONVERSATION_SCREENSHOT,
                        "clicked communicate button but chat did not open",
                    )
                    raise RuntimeError("clicked communicate button but chat did not open")
            except Exception as exc:
                print(f"  JobRadar conversation error: direct text button click failed: {exc}")
                raise

            if not click_candidate_button():
                print("  JobRadar conversation error: no matching communication button found")
                save_debug("no matching communication button")
                raise RuntimeError("no matching communication button found")

            pause(2, 3)
            block_reason = detect_blocking_state()
            if block_reason:
                print(f"  JobRadar conversation error after click: {block_reason}")
                save_debug(block_reason)
                raise RuntimeError(block_reason)
            modal_result = self.handle_boss_post_chat_modal()
            if modal_result.get("modal_handled") or modal_result.get("real_message_sent"):
                return modal_result
            if is_chat_open():
                page_snapshot("opened")
                return opened_result()

            print("  JobRadar conversation error: clicked candidate button but chat did not open")
            save_page_artifact(
                DEBUG_AFTER_CLICK_CONVERSATION_HTML,
                DEBUG_AFTER_CLICK_CONVERSATION_SCREENSHOT,
                "clicked communicate button but chat did not open",
            )
            raise RuntimeError("clicked communicate button but chat did not open")
        except Exception as exc:
            print(f"  JobRadar open job conversation failed: {exc}")
            save_debug(str(exc))
            raise RuntimeError(str(exc)) from exc

    def handle_boss_post_chat_modal(self) -> dict:
        raise RuntimeError(LEGACY_API_DISABLED_MESSAGE)
        """Handle BOSS post-chat modal that appears after clicking communicate."""
        def save_modal_debug(reason: str) -> None:
            try:
                DEBUG_POST_CHAT_MODAL_HTML.parent.mkdir(parents=True, exist_ok=True)
                DEBUG_POST_CHAT_MODAL_HTML.write_text(self.page.content(), encoding="utf-8")
                self.page.screenshot(path=str(DEBUG_POST_CHAT_MODAL_SCREENSHOT), full_page=True)
                print(f"  [MODAL] debug saved: reason={reason}")
                print(f"  [MODAL] debug html: {DEBUG_POST_CHAT_MODAL_HTML}")
                print(f"  [MODAL] debug screenshot: {DEBUG_POST_CHAT_MODAL_SCREENSHOT}")
            except Exception as exc:
                print(f"  [MODAL] debug save failed: {exc}")

        try:
            state = self.page.evaluate(
                """() => {
                    const body = (document.body && document.body.innerText || '');
                    const has = (text) => body.includes(text);
                    const visible = (el) => {
                        if (!el) return false;
                        const style = getComputedStyle(el);
                        const rect = el.getBoundingClientRect();
                        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
                    };
                    const controls = Array.from(document.querySelectorAll('button,a,span,div[role="button"],div'));
                    const pickText = (labels) => {
                        for (const el of controls) {
                            const text = ((el.innerText || el.textContent || '') + '').trim();
                            if (visible(el) && labels.some(label => text.includes(label))) return text;
                        }
                        return '';
                    };
                    const hasInput = !!document.querySelector('textarea,[contenteditable="true"],#chat-input,[class*="chat-input"]');
                    return {
                        detected: has('已发送') || has('已开启消息订阅') || has('小程序也能继续回复BOSS信息') ||
                            has('使用微信扫码') || has('请简短描述您的问题') || has('发送') ||
                            has('继续沟通') || has('关闭') || has('×') || hasInput,
                        alreadySent: has('已发送'),
                        subscription: has('已开启消息订阅') || has('小程序也能继续回复BOSS信息') || has('使用微信扫码'),
                        questionPrompt: has('请简短描述您的问题'),
                        hasInput,
                        continueText: pickText(['继续沟通']),
                        closeText: pickText(['关闭', '×']),
                        body: body.slice(0, 1200),
                    };
                }"""
            ) or {}
        except Exception as exc:
            save_modal_debug(str(exc))
            return {"opened": False, "real_message_sent": False, "modal_handled": False, "reason": str(exc)}

        if not state.get("detected"):
            return {"opened": False, "real_message_sent": False, "modal_handled": False, "reason": "no_post_chat_modal"}

        print("[MODAL] BOSS post-chat modal detected")
        real_message_sent = bool(state.get("alreadySent") or state.get("hasInput") or state.get("questionPrompt"))
        if state.get("alreadySent"):
            print("[MODAL] detected already sent message")

        handled = False
        try:
            if state.get("continueText"):
                self.page.locator("text=继续沟通").first.click(force=True)
                time.sleep(1)
                try:
                    self.page.wait_for_load_state("networkidle", timeout=5000)
                except Exception:
                    pass
                print("[MODAL] clicked continue communication")
                handled = True
            elif state.get("subscription") or state.get("closeText"):
                clicked = self.page.evaluate(
                    """() => {
                        const labels = ['关闭', '×'];
                        const visible = (el) => {
                            const style = getComputedStyle(el);
                            const rect = el.getBoundingClientRect();
                            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
                        };
                        for (const el of document.querySelectorAll('button,a,span,div[role="button"],div')) {
                            const text = ((el.innerText || el.textContent || '') + '').trim();
                            const cls = (el.getAttribute('class') || '').toLowerCase();
                            if (visible(el) && (labels.some(label => text.includes(label)) || cls.includes('close'))) {
                                el.click();
                                return true;
                            }
                        }
                        return false;
                    }"""
                )
                if clicked:
                    print("[MODAL] closed subscription QR modal")
                    handled = True
            elif state.get("hasInput") or state.get("alreadySent"):
                handled = True
        except Exception as exc:
            save_modal_debug(str(exc))
            return {"opened": False, "real_message_sent": real_message_sent, "modal_handled": False, "reason": str(exc)}

        if not handled:
            save_modal_debug("post-chat modal detected but not handled")
            return {
                "opened": False,
                "real_message_sent": real_message_sent,
                "modal_handled": False,
                "reason": "post-chat modal detected but not handled",
            }

        print("[MODAL] handled successfully")
        return {
            "opened": True,
            "real_message_sent": real_message_sent,
            "modal_handled": True,
            "reason": "boss_auto_sent_message_modal" if real_message_sent else "boss_post_chat_modal",
        }

    def send_job_apply_message(self, job: dict, message: str) -> dict:
        """Open one job conversation and send the first application message."""
        raise RuntimeError(LEGACY_API_DISABLED_MESSAGE)
        def save_apply_debug(reason: str) -> None:
            try:
                DEBUG_APPLY_HTML.parent.mkdir(parents=True, exist_ok=True)
                DEBUG_APPLY_HTML.write_text(self.page.content(), encoding="utf-8")
                self.page.screenshot(path=str(DEBUG_APPLY_SCREENSHOT), full_page=True)
                print(f"  [APPLY_SMOKE] debug saved: reason={reason}")
                print(f"  [APPLY_SMOKE] debug html: {DEBUG_APPLY_HTML}")
                print(f"  [APPLY_SMOKE] debug screenshot: {DEBUG_APPLY_SCREENSHOT}")
            except Exception as exc:
                print(f"  [APPLY_SMOKE] debug save failed: {exc}")

        try:
            if self._login_prompt_visible():
                save_apply_debug("login expired or login required")
                return {"success": False, "message": "login expired or login required"}
            if not self.check_page_safety():
                save_apply_debug("page safety check failed")
                return {"success": False, "message": "page safety check failed"}
            open_result = self.open_job_conversation(job)
            if not open_result.get("opened"):
                save_apply_debug("failed to open BOSS job conversation")
                return {"success": False, "message": "failed to open BOSS job conversation"}
            if open_result.get("real_message_sent"):
                return {
                    "success": True,
                    "message": "boss auto sent message modal handled",
                    "source_url": job.get("source_url") or job.get("url") or "",
                    "opened": True,
                    "real_message_sent": True,
                    "modal_handled": bool(open_result.get("modal_handled")),
                    "reason": open_result.get("reason") or "boss_auto_sent_message_modal",
                }
            if not self.check_page_safety():
                save_apply_debug("page safety check failed after opening conversation")
                return {"success": False, "message": "page safety check failed after opening conversation"}
            sent = self.send_message(message) if message else False
            if not sent:
                save_apply_debug("application message failed")
            return {
                "success": bool(sent),
                "message": "application message sent" if sent else "application message failed",
                "source_url": job.get("source_url") or job.get("url") or "",
                "opened": True,
                "real_message_sent": bool(sent),
                "modal_handled": bool(open_result.get("modal_handled")),
                "reason": open_result.get("reason") or "manual_message_sent",
            }
        except Exception as exc:
            save_apply_debug(str(exc))
            return {"success": False, "message": str(exc), "source_url": job.get("source_url") or job.get("url") or ""}

    # ────────────────────────────────────────────────────────────
    # RecruitRadar real-mode candidate search
    # ────────────────────────────────────────────────────────────

    def ensure_recruiter_logged_in(self) -> bool:
        """Open BOSS recruiter-side pages and wait for a usable logged-in session."""
        return self._ensure_logged_in_once(BOSS_RECRUITER_HOME_URL, "RecruitRadar")

    def search_candidates(self, keyword: str, limit: int = 20) -> List[dict]:
        """Search BOSS recruiter-side candidate pages and return raw candidate dictionaries."""
        if not self.ensure_recruiter_logged_in():
            return []

        candidates: List[dict] = []
        seen = set()
        encoded = quote_plus(keyword or "")
        for url_template in BOSS_RECRUITER_SEARCH_URLS:
            if len(candidates) >= limit:
                break
            url = url_template.format(query=encoded)
            try:
                self.page.goto(url, wait_until="load", timeout=45000)
                pause(3, 5)
                if self._login_prompt_visible() or not self.check_page_safety():
                    continue
                self._try_recruiter_search_box(keyword)
                self._scroll_all(max_scrolls=10, stable_rounds=2)
                for candidate in self._extract_candidate_cards(keyword):
                    key = candidate.get("source_url") or candidate.get("external_candidate_id") or candidate.get("name")
                    if key and key not in seen:
                        seen.add(key)
                        candidates.append(candidate)
                        if len(candidates) >= limit:
                            break
            except Exception as exc:
                print(f"  RecruitRadar candidate search URL failed: {url} ({exc})")
                continue
        return candidates[: max(0, limit)]

    def _try_recruiter_search_box(self, keyword: str) -> None:
        if not keyword:
            return
        selectors = [
            'input[placeholder*="搜索"]',
            'input[placeholder*="候选"]',
            'input[placeholder*="人才"]',
            'input[placeholder*="简历"]',
            'input[type="search"]',
            ".search-box input",
            '[class*="search"] input',
        ]
        for selector in selectors:
            try:
                box = self.page.locator(selector).first
                if not box.is_visible():
                    continue
                box.click()
                self.page.keyboard.press("Control+a")
                self.page.keyboard.type(keyword, delay=20)
                self.page.keyboard.press("Enter")
                pause(2, 4)
                return
            except Exception:
                continue

    def _extract_candidate_cards(self, keyword: str = "") -> List[dict]:
        try:
            rows = self.page.evaluate(
                """(keyword) => {
                    const visible = (el) => {
                        if (!el) return false;
                        const style = getComputedStyle(el);
                        const rect = el.getBoundingClientRect();
                        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
                    };
                    const linesOf = (el) => (el.innerText || '')
                        .split('\\n')
                        .map(s => s.trim())
                        .filter(Boolean);
                    const pick = (root, selectors) => {
                        for (const sel of selectors) {
                            const el = root.querySelector(sel);
                            const text = (el && el.innerText || '').trim();
                            if (text) return text;
                        }
                        return '';
                    };
                    const roots = Array.from(document.querySelectorAll([
                        '[class*="geek-card"]',
                        '[class*="candidate"]',
                        '[class*="resume"]',
                        '[class*="recommend-card"]',
                        '[class*="card"]',
                        'li'
                    ].join(','))).filter(visible);
                    const cards = [];
                    const seen = new Set();
                    for (const root of roots) {
                        const text = (root.innerText || '').trim();
                        if (!text || text.length < 8 || text.length > 1800) continue;
                        if (/职位描述|岗位职责|公司介绍|薪资|BOSS安全提示/.test(text)) continue;
                        const link = root.querySelector('a[href]');
                        const href = link ? (link.href || link.getAttribute('href') || '') : '';
                        const lines = linesOf(root);
                        const joined = lines.join(' ');
                        const name = pick(root, [
                            '[class*="geek-name"]',
                            '[class*="candidate-name"]',
                            '[class*="resume-name"]',
                            '[class*="name"]'
                        ]) || lines.find(x => x.length >= 2 && x.length <= 12 && !/[0-9]|K|经验|学历|本科|硕士|博士|大专|职位|公司/.test(x)) || '';
                        const currentTitle = pick(root, [
                            '[class*="position"]',
                            '[class*="title"]',
                            '[class*="job"]'
                        ]) || lines.find(x => /工程师|开发|产品|运营|设计|算法|经理|主管|专家|架构|测试|前端|后端|全栈|数据|AI|Java|Python|Go/.test(x) && x.length <= 40) || '';
                        const city = lines.find(x => /北京|上海|深圳|广州|杭州|成都|武汉|南京|苏州|西安|重庆|天津|青岛|厦门|长沙|郑州|合肥|Remote|远程/.test(x) && x.length <= 30) || '';
                        const experience = lines.find(x => /经验|年|应届|在校|不限/.test(x) && x.length <= 30) || '';
                        const education = lines.find(x => /本科|硕士|博士|大专|学历|高中|中专/.test(x) && x.length <= 30) || '';
                        const skills = Array.from(new Set((joined.match(/[A-Za-z][A-Za-z0-9.+#-]{1,24}|[\u4e00-\u9fa5]{2,12}/g) || [])
                            .filter(x => /Python|Java|Go|Golang|React|Vue|TypeScript|JavaScript|FastAPI|Django|Flask|PostgreSQL|MySQL|Redis|Docker|Kubernetes|LLM|AI|算法|后端|前端|全栈|数据|产品|运营|测试/.test(x))
                            .slice(0, 16)));
                        const idSource = href || `${name}-${currentTitle}-${city}-${experience}`;
                        if (!name || seen.has(idSource)) continue;
                        seen.add(idSource);
                        cards.push({
                            external_candidate_id: idSource,
                            source_url: href,
                            name,
                            headline: currentTitle || lines.slice(0, 3).join(' / '),
                            current_company: '',
                            current_title: currentTitle,
                            city,
                            location: city,
                            experience_text: experience,
                            education_text: education,
                            skills,
                            resume_text: lines.slice(0, 24).join('\\n'),
                            raw_text: text,
                            query: keyword
                        });
                    }
                    return cards;
                }""",
                keyword,
            )
        except Exception as exc:
            print(f"  RecruitRadar candidate DOM extraction failed: {exc}")
            return []

        candidates: List[dict] = []
        for row in rows or []:
            name = (row.get("name") or "").strip()
            if not name:
                continue
            candidates.append(
                {
                    "external_candidate_id": (row.get("external_candidate_id") or name).strip(),
                    "source_url": (row.get("source_url") or "").strip(),
                    "name": name,
                    "headline": (row.get("headline") or "").strip(),
                    "current_company": (row.get("current_company") or "").strip(),
                    "current_title": (row.get("current_title") or "").strip(),
                    "city": (row.get("city") or "").strip(),
                    "location": (row.get("location") or row.get("city") or "").strip(),
                    "experience_text": (row.get("experience_text") or "").strip(),
                    "education_text": (row.get("education_text") or "").strip(),
                    "skills": row.get("skills") or [],
                    "resume_text": (row.get("resume_text") or "").strip(),
                    "query": keyword,
                }
            )
        return candidates

    def fetch_candidate_detail(self, candidate_url: str) -> dict:
        """Open one recruiter-side candidate page and extract detail text."""
        result = {"source_url": candidate_url, "resume_text": ""}
        if not candidate_url:
            return result
        try:
            self.page.goto(candidate_url, wait_until="load", timeout=45000)
            pause(2, 4)
            if self._login_prompt_visible() or not self.check_page_safety():
                return result
            detail = self.page.evaluate(
                """() => {
                    const body = (document.body && document.body.innerText || '').trim();
                    const lines = body.split('\\n').map(s => s.trim()).filter(Boolean);
                    const find = (re) => lines.find(x => re.test(x) && x.length <= 60) || '';
                    const name = lines.find(x => x.length >= 2 && x.length <= 12 && !/[0-9]|经验|学历|本科|硕士|博士|大专|职位|公司/.test(x)) || '';
                    return {
                        name,
                        headline: find(/工程师|开发|产品|运营|设计|算法|经理|主管|专家|架构|测试|前端|后端|全栈|数据|AI|Java|Python|Go/),
                        city: find(/北京|上海|深圳|广州|杭州|成都|武汉|南京|苏州|西安|重庆|天津|青岛|厦门|长沙|郑州|合肥|Remote|远程/),
                        experience_text: find(/经验|年|应届|在校|不限/),
                        education_text: find(/本科|硕士|博士|大专|学历|高中|中专/),
                        resume_text: lines.slice(0, 80).join('\\n')
                    };
                }"""
            )
            result.update({k: v for k, v in (detail or {}).items() if v})
        except Exception as exc:
            print(f"  RecruitRadar candidate detail failed: {exc}")
        return result

    def open_candidate_conversation(self, candidate: dict) -> bool:
        """Open or start a recruiter-side conversation for a candidate."""
        raise RuntimeError(LEGACY_API_DISABLED_MESSAGE)
        candidate_url = candidate.get("source_url") or candidate.get("url") or ""
        if candidate_url:
            try:
                self.page.goto(candidate_url, wait_until="load", timeout=45000)
                pause(2, 4)
                if self._login_prompt_visible() or not self.check_page_safety():
                    return False
                if self._click_candidate_chat_button():
                    pause(2, 3)
                    return True
            except Exception as exc:
                print(f"  RecruitRadar open candidate detail failed: {exc}")
        name = candidate.get("name") or candidate.get("counterparty_name") or ""
        return self.open_conversation_by_name(name) if name else False

    def _click_candidate_chat_button(self) -> bool:
        raise RuntimeError(LEGACY_API_DISABLED_MESSAGE)
        labels = ("打招呼", "立即沟通", "沟通", "聊一聊", "发消息", "继续沟通")
        selectors = ["button", "a", "span", '[class*="chat"]', '[class*="greet"]', '[class*="contact"]']
        try:
            return bool(
                self.page.evaluate(
                    """({selectors, labels}) => {
                        const visible = (el) => {
                            const style = getComputedStyle(el);
                            const rect = el.getBoundingClientRect();
                            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
                        };
                        for (const sel of selectors) {
                            for (const el of document.querySelectorAll(sel)) {
                                const text = (el.innerText || el.textContent || '').trim();
                                if (!visible(el) || !text) continue;
                                if (labels.some(label => text.includes(label))) {
                                    el.scrollIntoView({block: 'center'});
                                    el.click();
                                    return true;
                                }
                            }
                        }
                        return false;
                    }""",
                    {"selectors": selectors, "labels": labels},
                )
            )
        except Exception:
            return False

    # ══════════════════════════════════════
    #  自动投递
    # ══════════════════════════════════════

    def apply_to_job(self, job_url: str, greeting: Optional[str] = None) -> dict:
        """
        对单个岗位执行投递流程:
        1. 打开详情页
        2. 点击"立即沟通"
        3. 发送招呼语
        返回 {success, message, application_id}
        """
        raise RuntimeError(LEGACY_API_DISABLED_MESSAGE)
        if not job_url:
            return {"success": False, "message": "缺少岗位链接"}

        # 日限检查
        today_count = get_today_application_count()
        daily_limit = int(get_setting("daily_apply_limit", "15"))
        if today_count >= min(daily_limit, MAX_APPLY_PER_DAY):
            return {"success": False, "message": f"已达今日上限({today_count}条)"}

        print(f"  🚀 投递: {job_url[:60]}...")

        try:
            self.page.goto(job_url, wait_until="load", timeout=45000)
            pause(1, 2)

            if not self.check_page_safety():
                return {"success": False, "message": "安全检查未通过"}

            # 检查是否已投递
            if self._has_text("已沟通", "继续沟通"):
                existing = get_application_by_url(job_url)
                if existing and existing["status"] == "pending":
                    update_application_status(existing["id"], "applied")
                return {"success": True, "message": "已投递过", "already_applied": True}

            # 查找"立即沟通"按钮
            apply_btn = self._find_element(SELECTORS["apply_button"])
            if not apply_btn:
                try:
                    apply_btn = self.page.locator("text=立即沟通").first
                    if not apply_btn.is_visible():
                        apply_btn = None
                except Exception:
                    apply_btn = None

            if not apply_btn:
                return {"success": False, "message": "未找到投递按钮"}

            self._safe_click(apply_btn)
            pause(2, 3)

            # 检查限制消息
            if self._has_text("已达上限", "沟通人数已用完", "今日次数已用完", "今日沟通次数已用完"):
                return {"success": False, "message": "BOSS直聘今日沟通次数已用完"}

            # 等待聊天窗口加载
            chat_input = self._find_element(SELECTORS["chat_input"], timeout_ms=5000)

            # 发送招呼语
            greeting_text = greeting or get_setting(
                "greeting_template",
                "您好，我对贵公司的{job_title}岗位很感兴趣，请问可以详细了解一下吗？",
            )
            greeting_sent = False
            if chat_input and greeting_text:
                greeting_sent = self.send_message(greeting_text)
                if greeting_sent:
                    print(f"  ✅ 招呼语已发送")
                else:
                    print(f"  ⚠️ 招招呼语发送失败")

            # 记录到 SQLite
            existing = get_application_by_url(job_url)
            if existing:
                if greeting_sent:
                    update_application_status(existing["id"], "applied", greeting_text)
                else:
                    update_application_status(existing["id"], "applied")
                app_id = existing["id"]
            else:
                app_id = add_application({"title": "", "company": "", "url": job_url})
                if greeting_sent:
                    update_application_status(app_id, "applied", greeting_text)
                else:
                    update_application_status(app_id, "applied")

            # 从详情页提取 HR 真实姓名和岗位信息
            hr_name = ""
            hr_company = ""
            job_title = ""
            try:
                from boss_firefox import BossScraper

                hr_info = self.page.evaluate("""() => {
                    const body = (document.body || {}).innerText || '';
                    const lines = body.split('\\n').map(l => l.trim()).filter(Boolean);
                    let hrName = '', hrTitle = '';
                    for (let i = 0; i < lines.length; i++) {
                        const l = lines[i];
                        if (l.includes('HR') || l.includes('招聘者') || l.includes('招聘经理') ||
                            l.includes('人事') || l.includes('HRBP') || l.includes('猎头')) {
                            if (i > 0 && lines[i-1].length <= 6 && !/\\d|省|市|区|路|号|招聘|公司|BOSS/.test(lines[i-1])) {
                                hrName = lines[i-1];
                            }
                            hrTitle = l;
                            break;
                        }
                    }
                    return {hrName, hrTitle};
                }""")
                hr_name = (hr_info.get("hrName") or "").strip()
                if not hr_name:
                    hr_name = ""
            except Exception:
                pass

            app_record = get_application_by_url(job_url) or {}
            hr_name = hr_name or app_record.get("hr_name", "")
            hr_company = app_record.get("company", "")
            job_title = app_record.get("job_title", "")

            # 只创建有 HR 名字的会话，避免"未知HR"垃圾数据
            if hr_name and len(hr_name) >= 2:
                get_or_create_conversation(app_id, hr_name, hr_company, job_title)

            increment_daily_stat("applications_sent")
            print(f"  ✅ 投递成功")
            return {"success": True, "message": "投递成功", "application_id": app_id}

        except Exception as e:
            print(f"  ❌ 投递失败: {e}")
            return {"success": False, "message": str(e)}

    def apply_batch(self, job_urls: List[str], greeting_template: Optional[str] = None) -> List[dict]:
        """批量投递，带间隔延迟。可通过设置 batch_delay_sec 控制间隔。"""
        raise RuntimeError(LEGACY_API_DISABLED_MESSAGE)
        results = []
        min_delay = int(get_setting("batch_delay_min_sec", "30"))
        max_delay = int(get_setting("batch_delay_max_sec", "90"))
        for i, url in enumerate(job_urls):
            if i > 0:
                delay = random.uniform(min_delay, max_delay)
                print(f"  ⏳ 等待 {delay:.0f}s 后投递下一条...")
                time.sleep(delay)

            result = self.apply_to_job(url, greeting_template)
            results.append(result)

            if not result["success"] and "上限" in result.get("message", ""):
                break
        return results

    # ══════════════════════════════════════
    #  聊天监控
    # ══════════════════════════════════════

    def navigate_to_chat(self) -> bool:
        """导航到 BOSS 聊天页，切到「未读」标签，只显示有未读消息的会话。"""
        try:
            self.page.goto("https://www.zhipin.com/web/geek/chat", wait_until="load", timeout=45000)
            pause(2, 3)
            # 点击「未读」标签，只显示有未读的会话
            for sel in ['span.label-name:has-text("未读")', 'li:has-text("未读")', '.label-name:has-text("未读")']:
                try:
                    unread_tab = self.page.locator(sel).first
                    if unread_tab.is_visible():
                        unread_tab.click()
                        pause(1, 2)
                        break
                except Exception:
                    pass
            return self.check_page_safety()
        except Exception:
            return False

    def poll_conversation_list(self) -> List[dict]:
        """从 BOSS 聊天页 DOM 获取会话列表。DOM 失败用 body text 正则兜底。"""
        conversations = []

        # 方式1: DOM 选择器
        conv_els = self._find_all_elements(SELECTORS["conversation_items"])
        if conv_els:
            for el in conv_els:
                try:
                    text = el.inner_text().strip()
                    if not text or len(text) < 3:
                        continue
                    # 从 BOSS 真实结构提取 HR 名字: .name-text
                    try:
                        hr_name = el.locator(".name-text").first.inner_text().strip()
                    except Exception:
                        hr_name = ""
                    if not hr_name:
                        # 兜底：从 body_text 行中提取
                        hr_name = (
                            el.evaluate("""(el) => {
                            const lines = (el.innerText||'').split('\\n').map(l=>l.trim()).filter(Boolean);
                            for (const l of lines) {
                                if (/^\\d{1,2}:\\d{2}$/.test(l)) continue;
                                if (/^\\[.+\\]$/.test(l)) continue;
                                const ch = l.replace(/[^\\u4e00-\\u9fff]/g,'');
                                if (ch.length>=2 && ch.length<=5) return l.split(/[\\s|·]/)[0].trim();
                            }
                            return '';
                        }""")
                            or ""
                        )
                    has_unread = False
                    try:
                        badge = el.locator('.red-dot, [class*="unread"]').first
                        has_unread = badge.is_visible()
                    except Exception:
                        pass
                    conversations.append(
                        {
                            "text": text,
                            "has_unread": has_unread,
                            "element": el,
                            "hr_name": hr_name,
                        }
                    )
                except Exception:
                    continue

        # 方式2: body text 正则兜底
        if not conversations:
            try:
                body = self.page.inner_text("body") or ""
                pattern = r"(\d{1,2}:\d{2})\s+([\u4e00-\u9fff\w·]+?)\s+(\[\s*\S+\s*\])\s+(.+?)(?=\s*\d{1,2}:\d{2}\s+|没有更多了|\Z)"
                for m in re.findall(pattern, body):
                    time_str, name_block, status, msg = m
                    # 提取纯名字：从 name_block 中去掉公司后缀
                    hr_name = re.sub(
                        r"[\u4e00-\u9fff]{2,}(?:有限|集团|科技|网络|信息|文化|教育|医疗|能源|贸易|实业|发展|控股|投资).*|经理.*|主管.*|专员.*|总监.*|[\[\]].*",
                        "",
                        name_block,
                    ).strip()
                    if not hr_name or len(hr_name) < 2:
                        m2 = re.match(r"^[\u4e00-\u9fff]{2,4}", name_block)
                        hr_name = m2.group(0) if m2 else name_block[:6]
                    hr_name = hr_name.strip()
                    if not hr_name or len(hr_name) < 2:
                        continue
                    conversations.append(
                        {
                            "text": f"{time_str}\n{name_block}\n{status}\n{msg}".strip(),
                            "has_unread": "未读" in status,
                            "element": None,
                            "hr_name": hr_name,
                        }
                    )
            except Exception:
                pass

        return conversations

    def read_visible_messages(self) -> List[dict]:
        """读取当前右侧聊天窗口中的可见消息，避免把左侧会话列表误当聊天内容。"""
        try:
            raw = self.page.evaluate("""() => {
                const result = [];
                const vw = window.innerWidth || 1200;
                const visible = el => {
                    const r = el.getBoundingClientRect();
                    const style = getComputedStyle(el);
                    return r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
                };
                const clean = text => (text || '')
                    .replace(/^(已读|未读|送达|发送失败|已发送)\\s*/g, '')
                    .replace(/\\n?(已读|未读|送达|发送失败|已发送)$/g, '')
                    .trim();
                const pickStatus = text => {
                    const m = (text || '').match(/(^|\\n)\\s*(已读|未读|送达|发送失败|已发送)\\s*(\\n|$)/);
                    return m ? m[2] : '';
                };
                const push = (el, contentEl) => {
                    if (!visible(el)) return;
                    const r = el.getBoundingClientRect();
                    if (r.left + r.width / 2 < vw * 0.35) return;
                    const textNode = contentEl || el.querySelector('.text p, .text span:last-child, .text, [class*="bubble"], [class*="content"]');
                    const fullText = el.innerText || '';
                    const content = clean(textNode ? textNode.innerText : el.innerText);
                    if (!content || /^(已读|未读|送达|发送失败|已发送)$/.test(content)) return;
                    if (content.length > 1000) return;
                    const cls = el.className || '';
                    const sender = cls.includes('item-myself') || cls.includes('myself') || cls.includes('self') || r.left > vw * 0.52 ? 'me' : 'hr';
                    const status = sender === 'me' ? pickStatus(fullText) : '';
                    result.push({sender: sender, content: content, status: status});
                };

                document.querySelectorAll('li.message-item, li[class*="message-item"]').forEach(el => push(el));
                if (result.length === 0) {
                    document.querySelectorAll('[class*="message"] [class*="bubble"], [class*="msg"] [class*="bubble"], [class*="chat"] [class*="text"]').forEach(el => push(el, el));
                }
                return result;
            }""")
            return raw or []
        except Exception:
            return []

    def open_conversation_by_name(self, hr_name: str) -> bool:
        """在聊天页中按 HR 名字定位并打开对应会话。"""
        try:
            current_url = self.page.url
            if "/web/geek/chat" not in current_url:
                self.page.goto("https://www.zhipin.com/web/geek/chat", wait_until="load", timeout=45000)
                pause(2, 3)

            # 优先用 Playwright 文本选择器点击列表项。BOSS 的左栏布局会随宽度变化，
            # 不能强依赖元素在屏幕左半边。
            for sel in [
                f'li[role="listitem"]:has-text("{hr_name}")',
                f'.user-list li:has-text("{hr_name}")',
                f'[class*="friend"]:has-text("{hr_name}")',
                f'text="{hr_name}"',
            ]:
                try:
                    loc = self.page.locator(sel).first
                    if loc.count() > 0 and loc.is_visible():
                        loc.click(force=True, timeout=3000)
                        pause(1, 2)
                        return True
                except Exception:
                    pass

            # 兜底：在 DOM 中找包含 HR 名的最小可点击会话容器并触发点击。
            clicked = self.page.evaluate(
                """(name) => {
                    const visible = el => {
                        const r = el.getBoundingClientRect();
                        const s = getComputedStyle(el);
                        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
                    };
                    const candidates = [];
                    const selectors = [
                        '.user-list li', 'li[role="listitem"]', '.friend-content',
                        '[class*="friend"]', '[class*="conversation"]', '[class*="chat-item"]'
                    ];
                    document.querySelectorAll(selectors.join(',')).forEach(el => {
                        const text = (el.innerText || '');
                        if (text.length < 3 || text.length > 200) return;
                        if (!text.includes(name)) return;
                        if (!visible(el)) return;
                        const rect = el.getBoundingClientRect();
                        const nameEl = el.querySelector('.name-text, [class*="name"]');
                        const nameText = (nameEl && nameEl.innerText || '').trim();
                        const exact = nameText === name || text.split('\\n').some(line => line.trim() === name);
                        candidates.push({el: el, exact: exact ? 1 : 0, area: rect.width * rect.height, top: rect.top});
                    });
                    candidates.sort((a,b) => b.exact - a.exact || a.area - b.area || a.top - b.top);
                    for (const c of candidates) {
                        try {
                            c.el.scrollIntoView({block: 'center'});
                            const r = c.el.getBoundingClientRect();
                            const opts = {bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2};
                            c.el.dispatchEvent(new MouseEvent('mousedown', opts));
                            c.el.dispatchEvent(new MouseEvent('mouseup', opts));
                            c.el.dispatchEvent(new MouseEvent('click', opts));
                            return true;
                        } catch(e) {}
                    }
                    return false;
                }""",
                hr_name,
            )
            if clicked:
                pause(1, 2)
                return True
            return False
        except Exception as e:
            print(f"  ⚠️ 打开会话失败 ({hr_name}): {e}")
            return False

    def send_message(self, text: str, fast: bool = True) -> bool:
        """逐字模拟键盘输入 + Enter 发送，确保 BOSS 检测到输入事件。"""
        raise RuntimeError(LEGACY_API_DISABLED_MESSAGE)
        try:
            # 点击输入框激活
            try:
                self.page.locator("#chat-input").first.click()
                time.sleep(0.15)
            except Exception:
                try:
                    self.page.locator('[contenteditable="true"]').first.click()
                    time.sleep(0.15)
                except Exception:
                    pass

            # 清除已有内容
            try:
                self.page.keyboard.press("Control+a")
                time.sleep(0.05)
                self.page.keyboard.press("Backspace")
                time.sleep(0.05)
            except Exception:
                pass

            # 逐字键入，模拟真人打字
            delay = 20 if fast else 40
            self.page.keyboard.type(text, delay=delay)
            pause(0.3, 0.6)

            # 按 Enter 发送
            self.page.keyboard.press("Enter")
            pause(0.5, 1)

            # 验证：消息区出现了刚发的文本
            body = self.page.inner_text("body")
            check = text[:8] if len(text) >= 8 else text[:4]
            if check in body:
                return True

            # 再试一次 Enter
            try:
                self.page.keyboard.press("Enter")
                pause(0.3, 0.5)
                return True
            except Exception:
                pass

            return False
        except Exception as e:
            print(f"  ⚠️ send_message 失败: {e}")
            return False

    def _get_chat_security_id(self, hr_name: str = "") -> str:
        """Disabled legacy identifier extraction entry point."""
        raise RuntimeError(LEGACY_API_DISABLED_MESSAGE)

    def send_wechat(self, hr_name: str = "") -> bool:
        """通过 BOSS API 发起交换，等弹窗出现后点「确定」。"""
        raise RuntimeError(LEGACY_API_DISABLED_MESSAGE)
        try:
            sid = self._get_chat_security_id(hr_name)

            if sid:
                raise RuntimeError(LEGACY_API_DISABLED_MESSAGE)
            else:
                btn = self._find_element(SELECTORS["wechat_share_btn"], timeout_ms=5000)
                if not btn:
                    print("  ⚠️ send_wechat: legacy contact exchange is disabled")
                    return False
                btn.click()
                print("  [换微信] 已点击换微信按钮")

            # 等弹窗 → 点「确定」
            confirm_clicked = self.page.evaluate("""() => {
                return new Promise((resolve) => {
                    let tries = 0;
                    const check = () => {
                        // 先找「确定与对方交换微信吗？」弹窗里的确定按钮
                        const btns = document.querySelectorAll('span');
                        for (const b of btns) {
                            if (b.innerText.trim() === '确定' && b.offsetParent !== null) {
                                const parent = b.closest('.secure-exchange, .sentence-popover, [class*="exchange"], [class*="popover"]');
                                if (parent) {
                                    b.click();
                                    resolve(true);
                                    return;
                                }
                            }
                        }
                        // 兜底：任何可见的"确定"按钮
                        const all = document.querySelectorAll('.btn-sure-v2, span');
                        for (const el of all) {
                            if (el.innerText.trim() === '确定' && el.offsetParent !== null && !el.closest('.btn-outline-v2')) {
                                el.click();
                                resolve(true);
                                return;
                            }
                        }
                        if (++tries < 30) setTimeout(check, 300);
                        else resolve(false);
                    };
                    check();
                });
            }""")
            if confirm_clicked:
                pause(0.5, 1)
                print("  [换微信] 已点确定按钮")
                return True

            print("  [换微信] 超时: 未找到确定按钮")
            return False

        except Exception as e:
            print(f"  ⚠️ send_wechat 失败: {e}")
            return False

    def send_phone(self, hr_name: str = "") -> bool:
        """通过 BOSS API 交换手机号（type=1），等弹窗出现后点「确定」。"""
        raise RuntimeError(LEGACY_API_DISABLED_MESSAGE)
        try:
            sid = self._get_chat_security_id(hr_name)

            if sid:
                raise RuntimeError(LEGACY_API_DISABLED_MESSAGE)
            else:
                btn = self._find_element(SELECTORS["phone_share_btn"], timeout_ms=5000)
                if not btn:
                    print("  ⚠️ send_phone: legacy contact exchange is disabled")
                    return False
                btn.click()
                print("  [换电话] 已点击换电话按钮")

            # 等弹窗 → 点「确定」
            confirm_clicked = self.page.evaluate("""() => {
                return new Promise((resolve) => {
                    let tries = 0;
                    const check = () => {
                        const btns = document.querySelectorAll('span');
                        for (const b of btns) {
                            if (b.innerText.trim() === '确定' && b.offsetParent !== null) {
                                const parent = b.closest('.secure-exchange, .sentence-popover, .panel-contact, [class*="exchange"], [class*="popover"]');
                                if (parent) {
                                    b.click();
                                    resolve(true);
                                    return;
                                }
                            }
                        }
                        const all = document.querySelectorAll('.btn-sure-v2, span');
                        for (const el of all) {
                            if (el.innerText.trim() === '确定' && el.offsetParent !== null && !el.closest('.btn-outline-v2')) {
                                el.click();
                                resolve(true);
                                return;
                            }
                        }
                        if (++tries < 30) setTimeout(check, 300);
                        else resolve(false);
                    };
                    check();
                });
            }""")
            if confirm_clicked:
                pause(0.5, 1)
                print("  [换电话] 已点确定按钮")
                return True

            print("  [换电话] 超时: 未找到确定按钮")
            return False

        except Exception as e:
            print(f"  ⚠️ send_phone 失败: {e}")
            return False

    def send_resume(self) -> bool:
        """点击「发简历」按钮，等弹窗后点「发送」确认。"""
        raise RuntimeError(LEGACY_API_DISABLED_MESSAGE)
        try:
            btn = self._find_element(SELECTORS["resume_attach_btn"], timeout_ms=5000)
            if not btn:
                print("  ⚠️ send_resume: 未找到发简历按钮")
                return False
            btn.click()
            print("  [发简历] 已点击发简历按钮")
            pause(1, 2)

            # 等弹窗出现 → 点「发送」按钮
            confirm = self._find_element(SELECTORS["resume_confirm_btn"], timeout_ms=5000)
            if confirm:
                confirm.click()
                pause(0.5, 1)
                print("  [发简历] 已点发送按钮")
                return True

            # 兜底：无弹窗但已点击
            print("  [发简历] 无弹窗，直接完成")
            return True
        except Exception as e:
            print(f"  ⚠️ send_resume 失败: {e}")
            return False

    # ══════════════════════════════════════
    #  页面扫描 & 一键投递
    # ══════════════════════════════════════

    def scan_current_page(self) -> List[dict]:
        """扫描当前BOSS搜索结果页，提取所有可见岗位卡片。不跳转，只读当前页。"""
        print(f"  [扫描] 开始扫描当前页面...")
        self._scroll_all()
        jobs = self._extract_job_cards()
        if not jobs:
            lines = [l.strip() for l in self.page.inner_text("body").split("\n") if l.strip()]
            sal_idx = [i for i, l in enumerate(lines) if re.search(r"\d+[-~]\d+K", decode_salary(l), re.I)]
            for n, si in enumerate(sal_idx):
                if n > 0 and si - sal_idx[n - 1] < 3:
                    continue
                if si == 0:
                    continue
                title = lines[si - 1]
                if not (2 < len(title) < 60):
                    continue
                salary = decode_salary(lines[si])
                company = exp = edu = city = ""
                end = sal_idx[n + 1] if n + 1 < len(sal_idx) else min(si + 10, len(lines))
                for j in range(si + 1, min(end, len(lines))):
                    ln = lines[j]
                    if "经验" in ln or "应届" in ln:
                        exp = ln
                    elif re.search(r"本科|硕士|博士|大专|学历不限", ln):
                        edu = ln
                    elif "·" in ln and len(ln) < 30:
                        city = ln
                    elif (
                        not company
                        and len(ln) > 2
                        and len(ln) < 40
                        and not re.search(r"年|学历|大专|本科|硕士|博士|不限|应届|·", ln)
                    ):
                        company = ln
                jobs.append(
                    {
                        "title": title,
                        "salary": salary,
                        "company": company,
                        "experience": exp,
                        "education": edu,
                        "city": city,
                        "url": "",
                        "description": "",
                        "hr_name": "",
                        "hr_title": "",
                    }
                )
            links = self._extract_links()
            if links:
                lm = {l["title"][:12]: l["href"] for l in links if l["title"][:12]}
                for j in jobs:
                    if not j["url"] and j["title"][:12] in lm:
                        j["url"] = lm[j["title"][:12]]
        print(f"  [扫描] 从当前页面提取到 {len(jobs)} 个岗位")
        return jobs

    def scan_and_apply_current_page(self, greeting_template: Optional[str] = None) -> dict:
        """扫描当前页面全部岗位 → 一键批量投递。"""
        raise RuntimeError(LEGACY_API_DISABLED_MESSAGE)
        jobs = self.scan_current_page()
        if not jobs:
            return {"success": False, "message": "当前页面未找到任何岗位", "scanned": 0, "applied": 0}
        urls = [j["url"] for j in jobs if j.get("url")]
        if not urls:
            return {"success": False, "message": "扫描到的岗位没有有效URL", "scanned": len(jobs), "applied": 0}
        results = self.apply_batch(urls, greeting_template)
        success_count = sum(1 for r in results if r.get("success"))
        return {
            "success": success_count > 0,
            "message": f"扫描 {len(jobs)} 个岗位，投递 {success_count}/{len(urls)}",
            "scanned": len(jobs),
            "applied": success_count,
            "results": results,
        }

    # ══════════════════════════════════════
    #  监控周期（供后台循环调用）
    # ══════════════════════════════════════

    def run_chat_monitor_cycle(self) -> dict:
        """
        一个完整的监控周期:
        1. 导航到聊天页
        2. 扫描未读会话
        3. 对每个未读会话: 打开→读消息→存库→AI回复
        """
        raise RuntimeError(LEGACY_API_DISABLED_MESSAGE)
        result = {"checked": 0, "new_messages": 0, "replies_sent": 0}

        if not self.check_logged_in():
            print("  [监控] 未登录，暂停聊天监控")
            return result

        # 只在不在聊天页时才导航（避免每轮刷新页面，触发 BOSS 登录检查）
        current_url = self.page.url
        need_nav = "/web/geek/chat" not in current_url
        if need_nav:
            if not self.navigate_to_chat():
                print("  [监控] 导航到聊天页失败")
                return result
        else:
            # 已在聊天页，轻量点击「未读」Tab 即可
            for sel in ['span.label-name:has-text("未读")', '.label-name:has-text("未读")']:
                try:
                    tab = self.page.locator(sel).first
                    if tab.is_visible():
                        tab.click()
                        pause(0.5, 1)
                        break
                except Exception:
                    pass

        if not self.check_page_safety():
            print("  [监控] 安全检查未通过（登录过期/验证码等）")
            return result

        conversations = self.poll_conversation_list()
        result["checked"] = len(conversations)
        print(f"  [监控] 扫描到 {len(conversations)} 个会话")
        # 始终打印 body 内容用于调试
        try:
            preview = (self.page.inner_text("body") or "")[:800].replace("\n", " | ")
            print(f"  [监控] Body: {preview}")
        except Exception:
            pass

        from boss_state import list_active_conversations

        known_convs = list_active_conversations()
        print(f"  [监控] 数据库已知活跃会话: {len(known_convs)}")

        # 已在导航时切到「未读」Tab，当前列表都是未读。每轮上限 3 个
        if not conversations:
            print(f"  [监控] 无未读消息，跳过本轮")
            return result
        if len(conversations) > 3:
            print(f"  [监控] 未读会话: {len(conversations)} 个，本轮只处理前3个")
            conversations = conversations[:3]

        for conv_data in conversations:
            text = conv_data.get("text", "")
            has_unread = conv_data.get("has_unread", False)
            element = conv_data.get("element")

            if not text:
                continue

            # 尝试匹配已知会话：用提取的 HR 名字精确匹配
            matched_conv = None
            extracted_name = conv_data.get("hr_name", "")
            for kc in known_convs:
                kc_name = kc.get("hr_name", "")
                if kc_name and extracted_name and kc_name == extracted_name:
                    matched_conv = kc
                    break

            if not matched_conv:
                for kc in known_convs:
                    kc_name = kc.get("hr_name", "")
                    if kc_name and len(kc_name) >= 3 and kc_name in text:
                        matched_conv = kc
                        break

            if not matched_conv:
                lines = [l.strip() for l in text.split("\n") if l.strip()]
                hr_name = conv_data.get("hr_name", "") or lines[0] if lines else ""
                hr_name = hr_name[:20] if len(hr_name) > 20 else hr_name

                # 过滤无效名称
                skip_keywords = [
                    "消息",
                    "联系人",
                    "沟通",
                    "设置",
                    "搜索",
                    "我的",
                    "首页",
                    "已沟通",
                    "继续沟通",
                    "新对话",
                    "系统",
                    "通知",
                    "BOSS",
                    "在线",
                    "离线",
                    "刚刚",
                    "分钟",
                    "小时",
                    "昨天",
                    "简历",
                    "附件",
                    "上传",
                    "制作",
                    "更新",
                    "AI",
                ]
                is_valid = (
                    hr_name
                    and len(hr_name) >= 2
                    and not hr_name.isdigit()
                    and not any(kw == hr_name for kw in skip_keywords)
                    and not any(kw in hr_name and len(hr_name) <= len(kw) + 1 for kw in skip_keywords)
                )
                if not is_valid:
                    print(f"  [监控] 跳过无效会话名: '{hr_name}' (原文: {text[:50]})")
                    continue

                conv_id = get_or_create_conversation(
                    None, hr_name, conv_data.get("company", ""), conv_data.get("job_title", "")
                )
                known_convs = list_active_conversations()
                matched_conv = get_conversation(conv_id)
                if not matched_conv:
                    continue
                print(f"  [监控] 新建会话: {hr_name}")
                # 标记用于 WebSocket 广播
                result.setdefault("new_conversations", []).append(hr_name)
            else:
                conv_id = matched_conv["id"]
                # 提取的名字比 DB 更精确时自动修正
                if extracted_name and len(extracted_name) >= 2:
                    old_name = matched_conv.get("hr_name", "")
                    if old_name != extracted_name and (
                        old_name in extracted_name or extracted_name in old_name or len(extracted_name) < len(old_name)
                    ):
                        try:
                            from boss_state import get_db as _gdb2

                            _gdb2().execute("UPDATE conversations SET hr_name=? WHERE id=?", (extracted_name, conv_id))
                            _gdb2().commit()
                            matched_conv["hr_name"] = extracted_name
                        except Exception:
                            pass

            # 从会话文本里提取公司名（格式：HR名+公司名+岗位）
            if not matched_conv.get("hr_company"):
                company_info = text.split("\n")[0] if "\n" in text else text
                import re as _re3

                hr_name_part = matched_conv.get("hr_name", "")
                if hr_name_part and len(hr_name_part) >= 2:
                    company_info = company_info.replace(hr_name_part, "", 1)
                # 去掉时间/状态/括号等
                company_info = _re3.sub(r"\d{1,2}:\d{2}|\[.*?\]|送达|已读|未读", "", company_info)
                # 提取公司名（纯中文 4-12字）
                m = _re3.search(r"[\u4e00-\u9fa5]{4,12}", company_info)
                if m:
                    company = m.group()
                    try:
                        from boss_state import get_db as _gdb3

                        _gdb3().execute("UPDATE conversations SET hr_company=? WHERE id=?", (company, conv_id))
                        _gdb3().commit()
                        matched_conv["hr_company"] = company
                        print(f"  [监控] 提取公司名: {company}")
                    except Exception:
                        pass

            if matched_conv.get("status") != "active":
                continue
            if not matched_conv.get("auto_reply_enabled"):
                continue

            # 读取消息：打开会话从 DOM 提取
            hr_name_to_open = matched_conv["hr_name"]
            opened = self.open_conversation_by_name(hr_name_to_open)
            if not opened and len(hr_name_to_open) > 4:
                short = re.match(r"^[\u4e00-\u9fff]{2,3}", hr_name_to_open)
                if short:
                    opened = self.open_conversation_by_name(short.group(0))
            if not opened:
                print(f"  [监控] 无法打开会话: {hr_name_to_open}")
                continue
            pause(1, 2)
            msgs = self.read_visible_messages()
            print(f"  [监控] 会话 {matched_conv.get('hr_name')}: 读到 {len(msgs)} 条消息")

            new_count = 0
            clean_msgs = []
            for msg in msgs:
                sender = msg.get("sender", "hr")
                content = (msg.get("content") or "").strip()
                if not content:
                    continue
                clean_msgs.append({"sender": sender, "content": content, "status": msg.get("status", "")})

            if clean_msgs:
                replace_conversation_messages(conv_id, clean_msgs)
                last_msg = clean_msgs[-1]
                update_conversation_last_message(conv_id, last_msg["content"], last_msg["sender"], 0)

                # 从 HR 消息里提取微信号
                if not matched_conv.get("hr_wechat"):
                    import re as _re

                    for m in clean_msgs:
                        if m["sender"] == "hr":
                            patterns = [
                                # wxid_xxxxxxxx 格式
                                r"(?:wxid|WXID)[_\-]?\s*[:：]?\s*([a-zA-Z0-9_-]{6,30})",
                                # 微信/VX/WeChat：xxx 格式
                                r"(?:微信|VX|vx|wechat|WeChat)[号：:]*\s*[:：]?\s*([a-zA-Z0-9_-]{4,30})",
                                # 加我/加V -> xxx
                                r"(?:加我|加V|找V|加个V)\s*[:：]?\s*([a-zA-Z0-9_-]{4,30})",
                                # 微信号 xxx（纯中文前缀）
                                r"\u5fae\u4fe1\u53f7\s+([a-zA-Z0-9_-]{4,30})",
                            ]
                            for pat in patterns:
                                match = _re.search(pat, m["content"])
                                if match:
                                    wx_id = match.group(1).strip()
                                    if wx_id and len(wx_id) >= 5:
                                        update_conversation_wechat(conv_id, wx_id)
                                        matched_conv["hr_wechat"] = wx_id
                                        result["wechat_exchanged"] = True
                                        print(f"  [监控] 提取HR微信: {wx_id}")
                                        break

            # 检测需要回复的 HR 消息：仅跳过纯 BOSS 系统通知（<80字且以系统模式开头）
            def _is_system_notification(content):
                content = content.strip()
                if len(content) > 80:
                    return False
                patterns = (
                    "你与该职位竞争者PK情况",
                    "竞争力分析",
                    "BOSS安全提示",
                    "系统消息",
                    "沟通分析",
                    "今日推荐",
                    "该Boss已查看了你的简历",
                )
                return any(content.startswith(p) for p in patterns)

            unreplied_hr_msg = None
            for i in range(len(clean_msgs) - 1, -1, -1):
                m = clean_msgs[i]
                if m["sender"] == "me":
                    continue
                if _is_system_notification(m["content"]):
                    continue
                # HR 消息
                has_reply_after = any(clean_msgs[j]["sender"] == "me" for j in range(i + 1, len(clean_msgs)))
                if not has_reply_after:
                    unreplied_hr_msg = m["content"]
                    new_count = 1
                    print(f"  [监控] 待回复HR消息: {m['content'][:60]}...")
                break

            if unreplied_hr_msg:
                result["new_messages"] += 1

            # 自动回复
            auto_reply_enabled = get_setting("auto_reply_enabled", "false") == "true"
            if unreplied_hr_msg and auto_reply_enabled:
                today_replies = get_today_auto_reply_count()
                if today_replies >= MAX_AUTO_REPLY_PER_DAY:
                    continue

                try:
                    from boss_replier import generate_reply

                    job_title = matched_conv.get("job_title", "")
                    job_company = matched_conv.get("hr_company", "")
                    job_desc = ""
                    app_id = matched_conv.get("application_id")
                    if app_id:
                        from boss_state import get_application

                        app = get_application(app_id)
                        if app:
                            job_desc = app.get("description") or ""
                            job_title = job_title or app.get("job_title", "")
                            job_company = job_company or app.get("company", "")

                    job_info = {
                        "title": job_title,
                        "company": job_company,
                        "description": job_desc,
                    }
                    style = get_setting("ai_reply_style", "professional")
                    resume = get_setting("resume_summary", "")
                    wechat = get_setting("wechat_id", "")

                    reply, interest = generate_reply(conv_id, unreplied_hr_msg, job_info, style, resume, wechat)
                    if reply:
                        # 先执行发送操作（简历/微信/电话），确保AI说"已发送"时东西已经发出去了
                        msg_lower = unreplied_hr_msg.lower()

                        # 发简历：HR明确要求简历时，且未发送过
                        if any(kw in msg_lower for kw in ("简历", "cv", "resume")):
                            if not matched_conv.get("resume_sent"):
                                print(f"  [监控] HR要简历，正在发送...")
                                if self.send_resume():
                                    from boss_state import mark_resume_sent

                                    mark_resume_sent(conv_id)
                                    pause(1, 2)

                        # 换微信：HR主动要联系方式时（排除"保持联系"等模糊表达）
                        wechat_keywords = (
                            "加微信",
                            "加个微信",
                            "微信聊",
                            "vx",
                            "加v",
                            "v我",
                            "加个v",
                            "微信号",
                            "换微信",
                        )
                        if any(kw in msg_lower for kw in wechat_keywords):
                            if not matched_conv.get("hr_wechat"):
                                print(f"  [监控] HR要微信，正在发送...")
                                self.send_wechat(hr_name_to_open)
                                pause(1, 2)

                        # 换电话：HR明确要电话时，且未发送过
                        if any(kw in msg_lower for kw in ("电话", "手机号")):
                            if not matched_conv.get("phone_shared"):
                                print(f"  [监控] HR要电话，正在发送...")
                                if self.send_phone(hr_name_to_open):
                                    from boss_state import mark_phone_shared

                                    mark_phone_shared(conv_id)
                                    pause(1, 2)

                        # 然后再发送AI回复
                        print(f"  [监控] AI回复: {reply[:60]}...")
                        if self.send_message(reply):
                            add_message(conv_id, "me", reply, ai_generated=True)
                            update_conversation_last_message(conv_id, reply, "me", 0)
                            increment_daily_stat("auto_replies_sent")
                            result["replies_sent"] += 1
                            if interest:
                                update_conversation_interest(conv_id, interest)
                                print(f"  [监控] HR兴趣度: {interest}")
                            print(f"  [监控] 回复已发送")
                        else:
                            print(f"  [监控] 回复发送失败!")
                        pause(5, 15)
                except Exception as e:
                    print(f"  ⚠️ AI回复生成失败: {e}")
            elif unreplied_hr_msg and not auto_reply_enabled:
                print(f"  [监控] 自动回复已关闭，跳过")

            # 下一个会话前确保输入框已清空，避免残留文字
            try:
                input_el = self.page.locator("#chat-input").first
                text = input_el.inner_text().strip()
                if text:
                    print(f"  [监控] 输入框残留文字「{text[:30]}...」，正在清空")
                    input_el.click()
                    self.page.keyboard.press("Control+a")
                    self.page.keyboard.press("Backspace")
                    pause(0.3, 0.5)
            except Exception:
                pass
            # 重新切「未读」Tab，刷新侧边栏列表（BOSS 可能已把刚才的会话标记为已读移出列表）
            for sel in ['span.label-name:has-text("未读")', '.label-name:has-text("未读")']:
                try:
                    tab = self.page.locator(sel).first
                    if tab.is_visible():
                        tab.click()
                        pause(0.5, 1)
                        break
                except Exception:
                    pass
            pause(0.5, 1)

        print(f"  [监控] 本轮完成: 消息 {result['new_messages']}, 回复 {result['replies_sent']}")
        return result
