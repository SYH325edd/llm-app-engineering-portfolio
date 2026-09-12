from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

import lakejob.infrastructure.platforms.boss.adapter as adapter_module
from lakejob.infrastructure.platforms.boss.adapter import BossAdapter


class FakeInput:
    def __init__(self) -> None:
        self.events: list[tuple] = []

    def click(self, x: float, y: float) -> None:
        self.events.append(("click", x, y))

    def press(self, value: str) -> None:
        self.events.append(("press", value))

    def type(self, value: str) -> None:
        self.events.append(("type", value))


class FakePage:
    def __init__(self, screenshot_dir: Path) -> None:
        self.url = "about:blank"
        self.mouse = FakeInput()
        self.keyboard = FakeInput()
        self.screenshot_dir = screenshot_dir

    def goto(self, url: str, **kwargs) -> None:
        self.url = url

    def title(self) -> str:
        return "BOSS Vision Test"

    def screenshot(self, *, path: str, full_page: bool = False) -> None:
        Path(path).write_bytes(b"png")

    def wait_for_timeout(self, timeout: float) -> None:
        return None


class FakeBrowser:
    def __init__(self, page: FakePage) -> None:
        self.page = page
        self.started = False

    def start(self) -> None:
        self.started = True

    def close(self) -> None:
        self.started = False


class FakeVisionProvider:
    def analyze(self, state) -> dict:
        controls = {
            "elements": [
                {"kind": "search_box", "bbox": [100, 80, 500, 130], "confidence": 0.99},
                {"kind": "city_box", "bbox": [520, 80, 700, 130], "confidence": 0.98},
                {"kind": "search_button", "bbox": [720, 80, 840, 130], "confidence": 0.99},
            ]
        }
        if state.phase == "city_options":
            return {"elements": [{"kind": "city_option", "bbox": [520, 140, 700, 180], "confidence": 0.95}]}
        if state.phase == "results":
            return {
                "ocr_text": "AI Engineer Vision Corp 25-40K Shanghai",
                "elements": [
                    {
                        "kind": "job_card",
                        "bbox": [80, 220, 820, 380],
                        "confidence": 0.97,
                        "text": "AI Engineer Vision Corp 25-40K",
                        "attributes": {
                            "title": "AI Engineer",
                            "company": "Vision Corp",
                            "salary": "25-40K",
                            "city": "Shanghai",
                        },
                    }
                ],
            }
        return controls


class BrokenVisionProvider:
    def analyze(self, state) -> dict:
        raise RuntimeError("vision unavailable")


class CandidateVisionProvider(FakeVisionProvider):
    def analyze(self, state) -> dict:
        if state.phase == "results":
            return {
                "ocr_text": "Alex AI Platform Engineer Shanghai",
                "elements": [
                    {
                        "kind": "candidate_card",
                        "bbox": [90, 210, 830, 390],
                        "confidence": 0.96,
                        "text": "Alex AI Platform Engineer",
                        "attributes": {
                            "name": "Alex",
                            "headline": "AI Platform Engineer",
                            "current_company": "Vision Labs",
                            "current_title": "Platform Engineer",
                            "city": "Shanghai",
                            "skills": ["Python", "LLM"],
                        },
                    }
                ],
            }
        return super().analyze(state)


def legacy_must_not_start():
    raise AssertionError("legacy BossAutomation must not be instantiated by vision search")


def test_adapter_uses_vision_and_preserves_evidence(temp_dir: Path) -> None:
    page = FakePage(temp_dir)
    browser = FakeBrowser(page)
    adapter = BossAdapter(
        vision_provider=FakeVisionProvider(),
        vision_browser_factory=lambda: browser,
        legacy_automation_factory=legacy_must_not_start,
        allow_mock=False,
    )
    adapter.start()
    jobs = adapter.search_jobs("AI Engineer", city="Shanghai", limit=1, daily_limit=9999, per_run_limit=1)
    adapter.close()

    assert len(jobs) == 1
    assert jobs[0]["source_url"].startswith("vision://boss/jobs/")
    metadata = jobs[0]["raw_data"]["vision_metadata"]
    assert metadata["bbox"] == [80.0, 220.0, 820.0, 380.0]
    assert Path(metadata["screenshot_path"]).is_file()
    assert ("type", "AI Engineer") in page.keyboard.events
    assert adapter.last_search_result is not None


def test_adapter_fails_closed_without_legacy(temp_dir: Path) -> None:
    original_record_error = adapter_module.record_error
    adapter_module.record_error = lambda *args, **kwargs: None
    try:
        page = FakePage(temp_dir)
        adapter = BossAdapter(
            vision_provider=BrokenVisionProvider(),
            vision_browser_factory=lambda: FakeBrowser(page),
            legacy_automation_factory=legacy_must_not_start,
            allow_mock=True,
        )
        adapter.start()
        try:
            adapter.search_jobs("Python", city="", limit=1, daily_limit=9999, per_run_limit=1)
        except RuntimeError as exc:
            assert "failed closed" in str(exc)
        else:
            raise AssertionError("vision failure must fail closed")
        finally:
            adapter.close()
    finally:
        adapter_module.record_error = original_record_error


def test_candidate_search_uses_vision(temp_dir: Path) -> None:
    page = FakePage(temp_dir)
    adapter = BossAdapter(
        vision_provider=CandidateVisionProvider(),
        vision_browser_factory=lambda: FakeBrowser(page),
        legacy_automation_factory=legacy_must_not_start,
        allow_mock=False,
    )
    adapter.start()
    candidates = adapter.search_candidates(
        "AI Platform", city="Shanghai", limit=1, daily_limit=9999, per_run_limit=1
    )
    adapter.close()
    assert len(candidates) == 1
    assert candidates[0]["name"] == "Alex"
    assert candidates[0]["source_url"].startswith("vision://boss/candidates/")
    metadata = candidates[0]["raw_data"]["vision_metadata"]
    assert metadata["bbox"] == [90.0, 210.0, 830.0, 390.0]
    assert Path(metadata["screenshot_path"]).is_file()


def run_all() -> None:
    old_use_vision = os.environ.get("USE_VISION_SEARCH")
    old_allow_legacy = os.environ.get("ALLOW_LEGACY_DOM_SEARCH")
    os.environ["USE_VISION_SEARCH"] = "true"
    os.environ["ALLOW_LEGACY_DOM_SEARCH"] = "false"
    try:
        with tempfile.TemporaryDirectory() as value:
            test_adapter_uses_vision_and_preserves_evidence(Path(value))
        with tempfile.TemporaryDirectory() as value:
            test_adapter_fails_closed_without_legacy(Path(value))
        with tempfile.TemporaryDirectory() as value:
            test_candidate_search_uses_vision(Path(value))
    finally:
        if old_use_vision is None:
            os.environ.pop("USE_VISION_SEARCH", None)
        else:
            os.environ["USE_VISION_SEARCH"] = old_use_vision
        if old_allow_legacy is None:
            os.environ.pop("ALLOW_LEGACY_DOM_SEARCH", None)
        else:
            os.environ["ALLOW_LEGACY_DOM_SEARCH"] = old_allow_legacy
    print("BossAdapter vision integration tests passed")


if __name__ == "__main__":
    run_all()
