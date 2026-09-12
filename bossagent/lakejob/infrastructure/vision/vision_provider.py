"""Screenshot OCR, vision understanding, and UI grounding provider."""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
from typing import Any

from lakejob.infrastructure.vision.screen_observer import PageState


VISION_SYSTEM_PROMPT = """You are a UI grounding engine. Analyze only the supplied screenshot.
Perform OCR and visual layout understanding. Return one JSON object with:
- page_status: ready, captcha, account_abnormal, access_restricted, or too_frequent
- ocr_text: visible text from the screenshot
- elements: visible UI elements with kind, bbox [left, top, right, bottom], confidence, text, attributes
Allowed kinds: search_box, city_box, city_option, search_button, job_card, candidate_card.
For job_card attributes use title, company, salary, city, experience_text, education_text, description.
For candidate_card attributes use name, headline, current_company, current_title, city, experience_text,
education_text, skills, resume_text. Never invent URLs, platform IDs, security IDs, or hidden data.
Coordinates must use screenshot pixels. Return JSON only."""


class ScreenshotVisionProvider:
    """Send screenshots to an OpenAI-compatible multimodal endpoint."""

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        model: str,
        timeout_seconds: float = 60.0,
    ) -> None:
        if not api_key or not base_url or not model:
            raise ValueError("VISION_API_KEY, VISION_BASE_URL and VISION_MODEL are required")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout_seconds = timeout_seconds

    @classmethod
    def from_env(cls) -> "ScreenshotVisionProvider":
        return cls(
            api_key=os.getenv("VISION_API_KEY", ""),
            base_url=os.getenv("VISION_BASE_URL", ""),
            model=os.getenv("VISION_MODEL", ""),
            timeout_seconds=float(os.getenv("VISION_TIMEOUT_SECONDS", "60")),
        )

    def analyze(self, state: PageState) -> dict[str, Any]:
        screenshot = Path(state.screenshot_path).read_bytes()
        encoded = base64.b64encode(screenshot).decode("ascii")
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": VISION_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": f"Phase: {state.phase}. Ground all relevant visible controls and cards.",
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/png;base64,{encoded}"},
                        },
                    ],
                },
            ],
            "temperature": 0,
            "response_format": {"type": "json_object"},
        }
        try:
            import httpx
        except ImportError as exc:
            raise RuntimeError("httpx is required for screenshot vision analysis") from exc
        try:
            with httpx.Client(timeout=self.timeout_seconds) as client:
                response = client.post(
                    f"{self.base_url}/chat/completions",
                    headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                    json=payload,
                )
                response.raise_for_status()
                body = response.json()
            content = str(body["choices"][0]["message"]["content"]).strip()
            if content.startswith("```"):
                content = content.strip("`").strip()
                if content.lower().startswith("json"):
                    content = content[4:].strip()
            result = json.loads(content)
        except (httpx.HTTPError, KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
            raise RuntimeError(f"Vision screenshot analysis failed: {exc}") from exc
        if not isinstance(result, dict) or not isinstance(result.get("elements", []), list):
            raise RuntimeError("Vision response must contain an elements list")
        result["vision_model"] = self.model
        result["screenshot_path"] = state.screenshot_path
        return result
