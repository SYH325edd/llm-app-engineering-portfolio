"""Minimal AI client used only by the optional BOSS compatibility layer."""

from __future__ import annotations

from typing import Optional

import httpx


def _load_ai_config() -> dict[str, str]:
    """Load compatibility-layer AI settings from its local state store."""
    cfg = {
        "api_key": "",
        "base_url": "https://api.deepseek.com",
        "model": "deepseek-chat",
    }
    try:
        from .state import get_db, get_setting

        get_db()
        cfg["api_key"] = get_setting("ai_api_key") or cfg["api_key"]
        cfg["base_url"] = get_setting("ai_base_url") or cfg["base_url"]
        cfg["model"] = get_setting("ai_model") or cfg["model"]
    except Exception:
        # Compatibility AI remains optional; callers surface missing config.
        pass
    return cfg


def llm_chat_deepseek(
    messages: list[dict[str, str]],
    system_prompt: Optional[str] = None,
    temperature: float = 0.3,
) -> str:
    """Call the configured OpenAI-compatible chat endpoint."""
    cfg = _load_ai_config()
    if not cfg["api_key"]:
        raise RuntimeError("AI API Key未配置")

    payload_messages = list(messages)
    if system_prompt:
        payload_messages = [{"role": "system", "content": system_prompt}, *payload_messages]

    response = httpx.post(
        f"{cfg['base_url'].rstrip('/')}/chat/completions",
        json={
            "model": cfg["model"],
            "messages": payload_messages,
            "temperature": temperature,
            "stream": False,
        },
        headers={
            "Authorization": f"Bearer {cfg['api_key']}",
            "Content-Type": "application/json",
        },
        timeout=120,
    )
    response.raise_for_status()
    data = response.json()
    try:
        return str(data["choices"][0]["message"]["content"])
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("AI response missing choices[0].message.content") from exc
