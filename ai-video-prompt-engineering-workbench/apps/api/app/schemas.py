from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class CreateRunRequest(BaseModel):
    title: str | None = Field(default=None, max_length=120)
    source_text: str = Field(min_length=1, max_length=200_000)

    @field_validator("source_text")
    @classmethod
    def source_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("source_text must not be blank")
        return value.strip()

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None


class ArkConfigRequest(BaseModel):
    api_key: str | None = Field(default=None, max_length=2000)
    model: str = Field(min_length=1, max_length=300)
    base_url: str = Field(default="https://ark.cn-beijing.volces.com/api/v3", max_length=1000)
    timeout_seconds: float = Field(default=300.0, ge=30.0, le=900.0)
    max_completion_tokens: int = Field(default=32768, ge=4096, le=131072)

    @field_validator("api_key")
    @classmethod
    def normalize_api_key(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None

    @field_validator("model", "base_url")
    @classmethod
    def normalize_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("value must not be blank")
        return value

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, value: str) -> str:
        if not (value.startswith("https://") or value.startswith("http://")):
            raise ValueError("base_url must start with http:// or https://")
        return value.rstrip("/")
