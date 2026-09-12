"""Offline regression tests for BOSS candidate evidence handling."""

from __future__ import annotations

from lakejob.infrastructure.platforms.boss.adapter import BossAdapter


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def test_missing_detail_does_not_generate_resume() -> None:
    adapter = BossAdapter.__new__(BossAdapter)
    adapter._automation = object()
    result = adapter.get_candidate_detail({"name": "Candidate A"})
    assert_true(result["resume_text"] is None, "missing resume must remain null")
    assert_true(result["skills"] is None, "missing skills must remain null")
    assert_true(result["experience_text"] is None, "missing experience must remain null")
    assert_true("matches recruiter-side search data" not in str(result), "synthetic evidence leaked")


def main() -> int:
    test_missing_detail_does_not_generate_resume()
    print("PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
