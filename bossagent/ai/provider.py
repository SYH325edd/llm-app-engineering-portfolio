"""AI provider abstraction and provider selection."""

from __future__ import annotations

import os
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

try:
    import yaml  # type: ignore
except ImportError:  # pragma: no cover
    yaml = None


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config" / "real_run_config.yaml"


class AIProvider(ABC):
    @abstractmethod
    def parse_resume(self, text: str) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def summarize_resume(self, parsed: dict[str, Any], raw_text: str) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def score_candidate(self, candidate: dict[str, Any], job_profile: dict[str, Any] | None = None) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def score_job(self, job: dict[str, Any], user_profile: dict[str, Any] | None = None) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def analyze_candidate_match(self, candidate: dict[str, Any], job_profile: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def analyze_job_match(self, job: dict[str, Any], user_profile: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def generate_message(self, context: dict[str, Any]) -> str:
        raise NotImplementedError

    @abstractmethod
    def generate_recruiter_message(
        self,
        candidate: dict[str, Any],
        recruiter_profile: dict[str, Any],
        match_analysis: dict[str, Any] | None = None,
    ) -> str:
        raise NotImplementedError

    @abstractmethod
    def generate_jobseeker_message(
        self,
        job: dict[str, Any],
        jobseeker_profile: dict[str, Any],
        match_analysis: dict[str, Any] | None = None,
    ) -> str:
        raise NotImplementedError

    @abstractmethod
    def health_check(self) -> dict[str, Any]:
        raise NotImplementedError


def _parse_scalar(value: str) -> Any:
    value = value.strip()
    if value.lower() == "true":
        return True
    if value.lower() == "false":
        return False
    if value.startswith("[") and value.endswith("]"):
        return [item.strip().strip("'\"") for item in value[1:-1].split(",") if item.strip()]
    try:
        return int(value)
    except ValueError:
        return value.strip("'\"")


def _load_simple_yaml(text: str) -> dict[str, Any]:
    data: dict[str, Any] = {}
    current: str | None = None
    for raw_line in text.splitlines():
        if not raw_line.strip() or raw_line.lstrip().startswith("#"):
            continue
        if not raw_line.startswith(" "):
            key, _, value = raw_line.partition(":")
            key = key.strip()
            if value.strip():
                data[key] = _parse_scalar(value)
                current = None
            else:
                data[key] = {}
                current = key
            continue
        if current and isinstance(data.get(current), dict):
            key, _, value = raw_line.strip().partition(":")
            data[current][key.strip()] = _parse_scalar(value)
    return data


def load_ai_config() -> dict[str, Any]:
    config: dict[str, Any] = {}
    if CONFIG_PATH.exists():
        text = CONFIG_PATH.read_text(encoding="utf-8")
        if yaml is not None:
            config = yaml.safe_load(text) or {}
        else:
            config = _load_simple_yaml(text)
    ai_config = dict(config.get("ai") or {})
    if os.getenv("LAKEJOB_AI_PROVIDER"):
        ai_config["provider"] = os.getenv("LAKEJOB_AI_PROVIDER")
    ai_config.setdefault("provider", "mock")
    ai_config.setdefault("model", os.getenv("DEEPSEEK_MODEL", "deepseek-chat"))
    ai_config.setdefault("base_url", os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"))
    return ai_config


def get_ai_provider(config: dict[str, Any] | None = None) -> AIProvider:
    cfg = dict(config or load_ai_config())
    provider = str(cfg.get("provider", "mock")).lower()
    if provider == "mock":
        from .mock_provider import MockAIProvider

        return MockAIProvider()
    if provider == "deepseek":
        from .deepseek_provider import DeepSeekProvider

        api_key = os.getenv("DEEPSEEK_API_KEY")
        if not api_key:
            if bool(cfg.get("mock_fallback", True)):
                from .mock_provider import MockAIProvider
                return MockAIProvider()
            raise RuntimeError("DEEPSEEK_API_KEY is required when ai.provider=deepseek")
        return DeepSeekProvider(
            api_key=api_key,
            base_url=str(cfg.get("base_url") or os.getenv("DEEPSEEK_BASE_URL") or "https://api.deepseek.com"),
            model=str(cfg.get("model") or os.getenv("DEEPSEEK_MODEL") or "deepseek-chat"),
            timeout_seconds=float(cfg.get("timeout_seconds") or 30),
            max_retries=int(cfg.get("max_retries") or 2),
        )
    raise ValueError(f"Unsupported AI provider: {provider}")
