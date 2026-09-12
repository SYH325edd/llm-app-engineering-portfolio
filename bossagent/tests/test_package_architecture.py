from __future__ import annotations

import importlib
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]

CANONICAL_MODULES = (
    "lakejob.app.web",
    "lakejob.application.jobs.flow",
    "lakejob.application.recruiting.flow",
    "lakejob.application.messaging.center",
    "lakejob.application.resumes.center",
    "lakejob.application.matching.analysis",
    "lakejob.infrastructure.platforms.boss.adapter",
    "lakejob.infrastructure.vision.runtime.runner",
    "lakejob.orchestration.engine",
    "lakejob.safety.guard",
)

FORBIDDEN_ROOT_BUSINESS_MODULES = (
    "job_flow.py", "job360.py", "jobradar_search.py", "jobradar_apply.py",
    "recruit_flow.py", "recruitradar_search.py", "message_center.py",
    "message_draft.py", "profile_center.py", "resume_center.py",
    "match_analysis.py", "safety_guard.py", "quota_policy.py", "scheduler.py",
)


def test_canonical_package_modules_exist() -> None:
    for module_name in CANONICAL_MODULES:
        importlib.import_module(module_name)


def test_root_contains_no_flat_business_modules() -> None:
    present = [name for name in FORBIDDEN_ROOT_BUSINESS_MODULES if (PROJECT_ROOT / name).exists()]
    assert present == []


def test_historical_job_radar_subproject_is_removed() -> None:
    assert not (PROJECT_ROOT / "lakejobai-job-radar").exists()


def test_root_uses_two_stable_windows_entrypoints() -> None:
    assert (PROJECT_ROOT / "setup.cmd").is_file()
    assert (PROJECT_ROOT / "start.cmd").is_file()
    assert not (PROJECT_ROOT / "setup_windows.cmd").exists()
    assert not (PROJECT_ROOT / "start_closed_loop_console.cmd").exists()
    assert not (PROJECT_ROOT / "run_closed_loop_demo.cmd").exists()
    start_text = (PROJECT_ROOT / "start.cmd").read_text(encoding="utf-8")
    assert "-m lakejob.app.console" in start_text


def test_current_docs_do_not_reference_removed_legacy_tree() -> None:
    docs = [PROJECT_ROOT / "README.md", *(PROJECT_ROOT / "docs").glob("*.md")]
    stale = []
    for path in docs:
        text = path.read_text(encoding="utf-8")
        if "lakejobai-job-radar" in text or "adapters/boss/" in text:
            stale.append(path.name)
    assert stale == []


def test_boss_compatibility_code_is_named_as_current_compat_layer() -> None:
    boss_dir = PROJECT_ROOT / "lakejob" / "infrastructure" / "platforms" / "boss"
    assert (boss_dir / "compat" / "automation.py").is_file()
    assert not (boss_dir / "legacy").exists()


def test_operational_scripts_are_module_importable() -> None:
    importlib.import_module("scripts.db_migrate")
    importlib.import_module("scripts.db_seed_local")
    importlib.import_module("scripts.make_release")
    importlib.import_module("scripts.pre_push_check")


def test_compat_ai_client_has_no_undeclared_numpy_dependency() -> None:
    path = PROJECT_ROOT / "lakejob" / "infrastructure" / "platforms" / "boss" / "compat" / "llm_client.py"
    assert "import numpy" not in path.read_text(encoding="utf-8")
