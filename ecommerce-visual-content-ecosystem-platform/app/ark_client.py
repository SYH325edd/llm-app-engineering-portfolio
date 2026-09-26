import base64
import json
import mimetypes
import time
from pathlib import Path
from typing import Any

import httpx

from .security import load_provider_settings


class ArkError(RuntimeError):
    pass


class ArkClient:
    def __init__(self):
        settings = load_provider_settings(include_secret=True)
        if not settings.get("api_key"):
            raise ArkError("尚未配置火山方舟 API Key")
        self.base_url = settings["base_url"].rstrip("/")
        self.api_key = settings["api_key"]
        self.models = settings["models"]
        self.timeout = httpx.Timeout(180.0, connect=20.0)

    @property
    def headers(self):
        return {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

    def capabilities(self, role: str) -> dict[str, bool]:
        """Conservative adapter capability declaration.

        Keep this aligned with the payloads actually sent by this client. A
        capability must not be advertised merely because the prompt mentions it.
        """
        if role == "image":
            return {"referenceImage": True, "multiReference": True, "mask": False, "seed": False}
        if role == "video":
            return {"referenceImage": True, "multiReference": True, "timestampControl": False}
        return {}

    def resolve_capabilities(self, role: str, requested: dict | None) -> dict:
        requested = requested or {}
        supported = self.capabilities(role)
        unsupported = [k for k, v in requested.items() if v is True and supported.get(k) is not True]
        return {"role": role, "requested": requested, "supported": supported, "unsupported": unsupported, "ok": not unsupported}

    def require_capabilities(self, role: str, requested: dict | None) -> dict:
        result = self.resolve_capabilities(role, requested)
        if not result["ok"]:
            raise ArkError("模型适配器不支持当前 PromptPackage 请求的能力：" + ", ".join(result["unsupported"]))
        return result

    def _post(self, path: str, payload: dict, timeout: float | None = None) -> dict:
        with httpx.Client(timeout=timeout or self.timeout, follow_redirects=True) as client:
            r = client.post(self.base_url + path, headers=self.headers, json=payload)
        if r.status_code >= 400:
            raise ArkError(f"HTTP {r.status_code}: {r.text[:600]}")
        return r.json()

    def _get(self, path: str, timeout: float | None = None) -> dict:
        with httpx.Client(timeout=timeout or self.timeout, follow_redirects=True) as client:
            r = client.get(self.base_url + path, headers=self.headers)
        if r.status_code >= 400:
            raise ArkError(f"HTTP {r.status_code}: {r.text[:600]}")
        return r.json()

    def text(self, prompt: str, system: str = "你是严谨的电商AI应用助手。", model: str | None = None) -> dict:
        payload = {
            "model": model or self.models["reasoning"],
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.2,
        }
        started = time.perf_counter()
        data = self._post("/chat/completions", payload)
        latency_ms = round((time.perf_counter() - started) * 1000)
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        return {"text": content, "raw": data, "latency_ms": latency_ms}

    def vision(self, prompt: str, image_inputs: list[str], model: str | None = None) -> dict:
        content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
        for image in image_inputs:
            content.append({"type": "image_url", "image_url": {"url": image, "detail": "high"}})
        payload = {
            "model": model or self.models["vision"],
            "messages": [{"role": "user", "content": content}],
            "temperature": 0.1,
        }
        started = time.perf_counter()
        data = self._post("/chat/completions", payload)
        latency_ms = round((time.perf_counter() - started) * 1000)
        text = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        return {"text": text, "raw": data, "latency_ms": latency_ms}

    def image(self, prompt: str, reference_images: list[str] | None = None, size: str = "2K") -> dict:
        payload: dict[str, Any] = {
            "model": self.models["image"],
            "prompt": prompt,
            "size": size,
            "sequential_image_generation": "disabled",
            "stream": False,
            "response_format": "url",
            "watermark": False,
        }
        if reference_images:
            payload["image"] = reference_images[0] if len(reference_images) == 1 else reference_images[:4]
        started = time.perf_counter()
        data = self._post("/images/generations", payload, timeout=300.0)
        latency_ms = round((time.perf_counter() - started) * 1000)
        items = data.get("data") or []
        url = items[0].get("url") if items else None
        if not url:
            raise ArkError("Seedream 返回中未找到图片 URL")
        return {"url": url, "raw": data, "latency_ms": latency_ms}

    def video_create(self, prompt: str, image_url: str | list[str] | None = None, duration: int = 10, ratio: str = "9:16") -> dict:
        content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
        refs = image_url if isinstance(image_url, list) else ([image_url] if image_url else [])
        for ref in refs[:8]:
            content.append({"type": "image_url", "role": "reference_image", "image_url": {"url": ref}})
        payload = {
            "model": self.models["video"],
            "content": content,
            "duration": duration,
            "resolution": "720p",
            "ratio": ratio,
            "return_last_frame": False,
        }
        return self._post("/contents/generations/tasks", payload, timeout=120.0)

    def video_get(self, task_id: str) -> dict:
        return self._get(f"/contents/generations/tasks/{task_id}", timeout=60.0)


def file_to_data_url(path: Path) -> str:
    mime = mimetypes.guess_type(str(path))[0] or "image/png"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def parse_jsonish(text: str) -> dict:
    text = (text or "").strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    try:
        return json.loads(text)
    except Exception:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start:end+1])
        raise ArkError("模型输出不是有效 JSON")
