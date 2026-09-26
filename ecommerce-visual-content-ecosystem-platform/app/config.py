from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "app.db"
SETTINGS_PATH = DATA_DIR / "provider.json"
MASTER_KEY_PATH = DATA_DIR / ".master.key"
PROJECTS_DIR = DATA_DIR / "projects"

DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
DEFAULT_MODELS = {
    "reasoning": "deepseek-v4-pro",
    "vision": "doubao-seed-2-1-turbo-260628",
    "vision_fallback": "doubao-seed-2-1-pro-260628",
    "image": "doubao-seedream-5-0-pro-260628",
    "video": "doubao-seedance-2-5-260628",
}

OFFICIAL_LINKS = {
    "api_key": "https://ark.volcengine.com/region:cn-beijing/apikey",
    "console": "https://console.volcengine.com/ark",
    "docs": "https://docs.volcengine.com/docs/ark/2536046?lang=zh",
    "video_docs": "https://docs.volcengine.com/docs/ark/video-generation-api?lang=zh",
}

for p in (DATA_DIR, PROJECTS_DIR):
    p.mkdir(parents=True, exist_ok=True)


def to_data_relative(path: str | Path) -> str:
    p = Path(path)
    try:
        return str(p.resolve().relative_to(DATA_DIR.resolve())).replace("\\", "/")
    except Exception:
        return str(p)


def resolve_data_path(value: str | Path) -> Path:
    p = Path(value)
    if not p.is_absolute():
        return DATA_DIR / p
    if p.exists():
        return p
    # Portable recovery for a project moved from another machine/container.
    parts = list(p.parts)
    if "projects" in parts:
        idx = parts.index("projects")
        return DATA_DIR.joinpath(*parts[idx:])
    return p
