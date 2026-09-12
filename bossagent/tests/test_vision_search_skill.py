from __future__ import annotations

import json
import tempfile
from pathlib import Path

from lakejob.infrastructure.platforms.boss.search.boss_page_parser import BossPageParser
from lakejob.infrastructure.platforms.boss.search.vision_search_skill import DailyQuota, SearchConfig, VisionSearchPaused, VisionSearchSkill
import lakejob.infrastructure.platforms.boss.search.vision_search_skill as vision_search_module
from lakejob.infrastructure.vision.screen_observer import ScreenObserver


class _Input:
    def __init__(self):
        self.events = []

    def click(self, x, y):
        self.events.append(("click", x, y))

    def press(self, value):
        self.events.append(("press", value))

    def type(self, value):
        self.events.append(("type", value))


class FakePage:
    def __init__(self):
        self.url = "about:blank"
        self.mouse = _Input()
        self.keyboard = _Input()

    def goto(self, url, **kwargs):
        self.url = url

    def title(self):
        return "BOSS"

    def screenshot(self, *, path, full_page=False):
        Path(path).write_bytes(b"png")

    def wait_for_timeout(self, timeout):
        return None


class Provider:
    def __init__(self, results):
        self.results = results

    def analyze(self, state):
        return self.results[state.phase]


def _element(kind, bbox, **attributes):
    return {"kind": kind, "bbox": bbox, "confidence": 0.9, "attributes": attributes}


def test_parser_returns_existing_job_shape():
    result = {"elements": [_element("job_card", [0, 0, 100, 80], title="AI Engineer", company="Lake")]} 
    job = BossPageParser().parse_jobs(result, keyword="AI", city="上海")[0]
    assert job["title"] == "AI Engineer"
    assert job["company_name"] == "Lake"
    assert job["external_job_id"].startswith("vision-job-")


def test_confirmed_recommendation_requires_explicit_match():
    config = SearchConfig("Python", "北京", 5, 10, 3, True, recommended_keywords=("FastAPI",))
    assert config.effective_keyword == "Python"
    confirmed = SearchConfig(
        "Python", "北京", 5, 10, 3, True, recommended_keywords=("FastAPI",), confirmed_keywords=("FastAPI",)
    )
    assert confirmed.effective_keyword == "Python FastAPI"
    try:
        SearchConfig("Python", "北京", 5, 10, 3, True, confirmed_keywords=("unapproved",))
    except ValueError:
        pass
    else:
        raise AssertionError("unrecommended keyword must not be accepted")


def test_search_uses_coordinates_and_exact_keyword(tmp_path):
    page = FakePage()
    common = {
        "elements": [
            _element("search_box", [10, 10, 110, 40]),
            _element("search_button", [120, 10, 180, 40]),
        ]
    }
    provider = Provider(
        {
            "initial": common,
            "before_search": common,
            "results": {"elements": [_element("job_card", [0, 50, 200, 150], title="Python Engineer")]},
        }
    )
    skill = VisionSearchSkill(
        page,
        provider,
        observer=ScreenObserver(page, tmp_path / "screens"),
        quota=DailyQuota(tmp_path / "quota.json"),
        log_path=tmp_path / "logs" / "vision.jsonl",
    )
    result = skill.run(SearchConfig("Python", "", 5, 10, 2, False))
    assert len(result["items"]) == 1
    assert ("type", "Python") in page.keyboard.events
    assert all("securityId" not in json.dumps(item) for item in result["items"])


def test_risk_page_pauses_and_logs(tmp_path):
    page = FakePage()
    provider = Provider({"initial": {"page_status": "captcha", "text": "验证码"}})
    original_record_error = vision_search_module.record_error
    vision_search_module.record_error = lambda *args, **kwargs: None
    log_path = tmp_path / "logs" / "vision.jsonl"
    skill = VisionSearchSkill(
        page,
        provider,
        observer=ScreenObserver(page, tmp_path / "screens"),
        quota=DailyQuota(tmp_path / "quota.json"),
        log_path=log_path,
    )
    try:
        try:
            skill.run(SearchConfig("Python", "北京", 1, 5, 1, False))
        except VisionSearchPaused:
            pass
        else:
            raise AssertionError("risk page must pause the task")
        assert '"event": "paused"' in log_path.read_text(encoding="utf-8")
    finally:
        vision_search_module.record_error = original_record_error


def run_all() -> None:
    test_parser_returns_existing_job_shape()
    test_confirmed_recommendation_requires_explicit_match()
    with tempfile.TemporaryDirectory() as temp_dir:
        test_search_uses_coordinates_and_exact_keyword(Path(temp_dir))
    with tempfile.TemporaryDirectory() as temp_dir:
        test_risk_page_pauses_and_logs(Path(temp_dir))
    print("Vision-first search skill tests passed")


if __name__ == "__main__":
    run_all()
