from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIR = PROJECT_ROOT / "config"
MIGRATIONS_DIR = PROJECT_ROOT / "migrations"
RUNTIME_DIR = PROJECT_ROOT / "runtime"
TEMPLATES_DIR = PROJECT_ROOT / "templates"
STATIC_DIR = PROJECT_ROOT / "static"
