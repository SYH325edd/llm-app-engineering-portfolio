"""Dependency-free page responsibility checks for the Local MVP."""

from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    web_console = (ROOT / "web_console.py").read_text(encoding="utf-8")
    control = (ROOT / "templates" / "local_control.html").read_text(encoding="utf-8")
    job = (ROOT / "templates" / "job_flow.html").read_text(encoding="utf-8")
    recruit = (ROOT / "templates" / "recruit_flow.html").read_text(encoding="utf-8")

    assert_true('@app.get("/control")' in web_console, "/control route is missing")
    assert_true("真实投递按钮" not in control and "真实投递 Smoke" not in control, "/control exposes a real apply button")
    assert_true("真实消息按钮" not in control and "真实消息 Smoke" not in control, "/control exposes a real message button")
    assert_true("批量发送" not in control, "/control exposes batch sending")
    assert_true('name="safety_guard_enabled"' not in control, "/control allows Safety Guard to be disabled")

    allowed = {"/job", "/recruit", "/auth-center", "/config", "/scheduler", "/logs"}
    literal_links = set(re.findall(r'href="(/[^"]*)"', control))
    assert_true(literal_links == allowed, f"/control links must be exactly {sorted(allowed)}")

    assert_true('@app.get("/job")' in web_console and "搜索岗位" in job, "/job must contain 搜索岗位")
    assert_true('@app.get("/recruit")' in web_console and "搜索候选人" in recruit, "/recruit must contain 搜索候选人")
    assert_true('@app.get("/auth-center")' in web_console, "/auth-center route is missing")
    for text in ("auth_state 状态", "chromium profile 状态", "重置 auth", "重置 browser profile", "登录说明"):
        assert_true(text in control, f"/auth-center missing {text}")
    assert_true(
        "控制中心不执行搜索、投递或消息动作" in web_console,
        "Control Center action endpoint must reject execution",
    )
    assert_true('"safety_guard_enabled": True' in (ROOT / "local_control.py").read_text(encoding="utf-8"), "Safety Guard must be forced on")

    print("PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
