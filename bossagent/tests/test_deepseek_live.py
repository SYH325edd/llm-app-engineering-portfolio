"""Minimal live DeepSeek provider test.

This script does not call Resume Center, JobRadar, RecruitRadar, Boss
automation, or PostgreSQL. It only verifies DeepSeekProvider with one safe
message-generation request when DEEPSEEK_API_KEY is configured.
"""

from __future__ import annotations

import os

from ai.deepseek_provider import DeepSeekProvider


def main() -> int:
    api_key = os.getenv("DEEPSEEK_API_KEY")
    if not api_key:
        print("SKIPPED: DEEPSEEK_API_KEY not configured")
        return 0

    provider = DeepSeekProvider(
        api_key=api_key,
        base_url=os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
        model=os.getenv("DEEPSEEK_MODEL", "deepseek-chat"),
        timeout_seconds=30.0,
    )

    try:
        health = provider.health_check()
        if not health.get("ok"):
            print(f"FAILED: {health.get('error') or 'health_check failed'}")
            return 1

        message = provider.generate_message(
            {
                "job_title": "AI视频设计师",
                "skills": ["AI视频", "剪辑", "提示词"],
                "tone": "自然、简短、礼貌",
            }
        )
        message = message.strip()
        if not message:
            print("FAILED: DeepSeek returned empty message")
            return 1
        if len(message) > 100:
            print(f"FAILED: message longer than 100 characters ({len(message)})")
            print(f"message: {message}")
            return 1

        print("PASSED DeepSeek live test")
        print(f"message: {message}")
        return 0
    except Exception as exc:
        print(f"FAILED: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
