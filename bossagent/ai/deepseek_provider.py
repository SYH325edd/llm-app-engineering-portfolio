"""DeepSeek-backed AI provider."""

from __future__ import annotations

import json
import time
from typing import Any

from . import prompts
from .provider import AIProvider


def _strip_json_fence(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`").strip()
        if text.lower().startswith("json"):
            text = text[4:].strip()
    return text


class DeepSeekProvider(AIProvider):
    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str = "https://api.deepseek.com",
        model: str = "deepseek-chat",
        timeout_seconds: float = 30.0,
        max_retries: int = 2,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.max_retries = max(0, max_retries)

    def _require_key(self) -> str:
        if not self.api_key:
            raise RuntimeError("DEEPSEEK_API_KEY is required")
        return self.api_key

    def _chat(self, system_prompt: str, user_payload: dict[str, Any]) -> str:
        api_key = self._require_key()
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False, default=str)},
            ],
            "temperature": 0.2,
            "stream": False,
        }
        try:
            import httpx
        except ImportError as exc:
            raise RuntimeError("httpx is required to use DeepSeekProvider") from exc
        body = None
        last_error: Exception | None = None
        for attempt in range(self.max_retries + 1):
            try:
                with httpx.Client(timeout=self.timeout_seconds) as client:
                    response = client.post(
                        f"{self.base_url}/chat/completions",
                        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                        json=payload,
                    )
                    response.raise_for_status()
                    body = response.json()
                    break
            except (httpx.HTTPError, ValueError) as exc:
                last_error = exc
                if attempt < self.max_retries:
                    time.sleep(min(0.25 * (2 ** attempt), 1.0))
        if body is None:
            raise RuntimeError(f"DeepSeek request failed after retries: {last_error}") from last_error
        try:
            return str(body["choices"][0]["message"]["content"]).strip()
        except (KeyError, IndexError, TypeError) as exc:
            raise RuntimeError("DeepSeek response missing choices[0].message.content") from exc

    def _json_chat(self, system_prompt: str, user_payload: dict[str, Any]) -> dict[str, Any]:
        content = _strip_json_fence(self._chat(system_prompt, user_payload))
        try:
            return json.loads(content)
        except json.JSONDecodeError as exc:
            raise RuntimeError("DeepSeek response was not valid JSON") from exc

    def parse_resume(self, text: str) -> dict[str, Any]:
        return self._json_chat(prompts.RESUME_PARSE_PROMPT, {"resume_text": text[:12000]})

    def summarize_resume(self, parsed: dict[str, Any], raw_text: str) -> dict[str, Any]:
        return self._json_chat(prompts.RESUME_SUMMARY_PROMPT, {"parsed": parsed, "resume_text": raw_text[:8000]})

    def score_candidate(self, candidate: dict[str, Any], job_profile: dict[str, Any] | None = None) -> dict[str, Any]:
        data = self._json_chat(prompts.CANDIDATE_SCORE_PROMPT, {"candidate": candidate, "job_profile": job_profile or {}})
        return self._normalize_score(data, "ai")

    def score_job(self, job: dict[str, Any], user_profile: dict[str, Any] | None = None) -> dict[str, Any]:
        data = self._json_chat(prompts.JOB_SCORE_PROMPT, {"job": job, "user_profile": user_profile or {}})
        return self._normalize_score(data, "ai")

    def analyze_candidate_match(self, candidate: dict[str, Any], job_profile: dict[str, Any]) -> dict[str, Any]:
        data = self._json_chat(
            prompts.CANDIDATE_MATCH_ANALYSIS_PROMPT,
            {"candidate": candidate, "job_profile": job_profile},
        )
        return self._normalize_analysis(data)

    def analyze_job_match(self, job: dict[str, Any], user_profile: dict[str, Any]) -> dict[str, Any]:
        data = self._json_chat(prompts.JOB_MATCH_ANALYSIS_PROMPT, {"job": job, "user_profile": user_profile})
        return self._normalize_analysis(data)

    def generate_message(self, context: dict[str, Any]) -> str:
        data = self._json_chat(prompts.MESSAGE_PROMPT, context)
        message = str(data.get("message") or "").strip()
        if not message:
            raise RuntimeError("DeepSeek message response missing message")
        return message.replace("\n", " ")[:160]

    def generate_recruiter_message(
        self,
        candidate: dict[str, Any],
        recruiter_profile: dict[str, Any],
        match_analysis: dict[str, Any] | None = None,
    ) -> str:
        data = self._json_chat(
            prompts.RECRUITER_MESSAGE_DRAFT_PROMPT,
            {
                "candidate": candidate,
                "recruiter_profile": recruiter_profile,
                "match_analysis": match_analysis or {},
            },
        )
        message = str(data.get("message") or "").strip()
        if not message:
            raise RuntimeError("DeepSeek recruiter message response missing message")
        return message.replace("\n", " ")[:100]

    def generate_jobseeker_message(
        self,
        job: dict[str, Any],
        jobseeker_profile: dict[str, Any],
        match_analysis: dict[str, Any] | None = None,
    ) -> str:
        data = self._json_chat(
            prompts.JOBSEEKER_MESSAGE_DRAFT_PROMPT,
            {
                "job": job,
                "jobseeker_profile": jobseeker_profile,
                "match_analysis": match_analysis or {},
            },
        )
        message = str(data.get("message") or "").strip()
        if not message:
            raise RuntimeError("DeepSeek jobseeker message response missing message")
        return message.replace("\n", " ")[:100]

    def health_check(self) -> dict[str, Any]:
        if not self.api_key:
            return {"ok": False, "provider": "deepseek", "error": "DEEPSEEK_API_KEY is required"}
        return {"ok": True, "provider": "deepseek", "base_url": self.base_url, "model": self.model}

    def _normalize_score(self, data: dict[str, Any], score_type: str) -> dict[str, Any]:
        try:
            score = max(0.0, min(100.0, float(data.get("score", 0))))
        except (TypeError, ValueError):
            score = 0.0
        details = data.get("details") if isinstance(data.get("details"), dict) else {}
        details["provider"] = "deepseek"
        details["model"] = self.model
        return {
            "score": round(score, 3),
            "score_type": score_type,
            "summary": str(data.get("summary") or "DeepSeek score"),
            "details": details,
        }

    def _normalize_analysis(self, data: dict[str, Any]) -> dict[str, Any]:
        if "score" not in data:
            raise RuntimeError("DeepSeek match response missing score")
        try:
            score = float(data["score"])
        except (TypeError, ValueError) as exc:
            raise RuntimeError("DeepSeek match response has invalid score") from exc
        if not 0 <= score <= 100:
            raise RuntimeError("DeepSeek match response score is out of range")
        level = str(data.get("level") or "").upper()
        if level not in {"A", "B", "C"}:
            level = "A" if score >= 85 else "B" if score >= 70 else "C"
        return {
            "score": round(score, 3),
            "level": level,
            "reasons": _list_text(data.get("reasons")),
            "strengths": _list_text(data.get("strengths")),
            "risks": _list_text(data.get("risks")),
            "suggested_action": str(data.get("suggested_action") or "").strip(),
            "tags": _list_text(data.get("tags")),
            "ai_provider": "deepseek",
            "fallback_used": False,
        }


def _list_text(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    text = str(value or "").strip()
    return [text] if text else []
