from typing import Any, Literal, Optional
from pydantic import BaseModel, Field


class ProviderSettingsIn(BaseModel):
    base_url: str
    api_key: Optional[str] = None
    models: dict[str, str]


class ProjectCreate(BaseModel):
    name: str
    category: str = ""
    brand: str = ""
    price: str = ""
    selling_points: list[str] = Field(default_factory=list)
    product_params: dict[str, Any] = Field(default_factory=dict)
    mode: Literal["demo", "live"] = "demo"


class ProjectPatch(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    brand: Optional[str] = None
    price: Optional[str] = None
    selling_points: Optional[list[str]] = None
    product_params: Optional[dict[str, Any]] = None
    mode: Optional[Literal["demo", "live"]] = None
    product_profile: Optional[dict[str, Any]] = None
    creative_plan: Optional[dict[str, Any]] = None


class SourceRoleUpdate(BaseModel):
    source_role: Literal[
        "PRODUCT_TRUTH", "PRODUCT_DETAIL", "PACKAGING_TRUTH",
        "STYLE_REFERENCE", "LAYOUT_REFERENCE", "SCENE_REFERENCE"
    ]
