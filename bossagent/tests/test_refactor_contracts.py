from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZipFile

import pytest

import lakejob.application.control.service as local_control
import lakejob.application.recruiting.search as recruitradar_search
from lakejob.shared.logging import redact
from lakejob.domain.platform_targets import platform_target_from_record
from lakejob.domain.schemas import ActionState, PlatformTarget
from lakejob.domain.state_machine import transition
from scripts import db_migrate
from scripts.make_release import make_release
from lakejob.infrastructure.vision.ui_grounder import GroundedElement, UIGrounder


def test_recruitradar_local_control_command_matches_parser():
    config = local_control.load_config()
    config["recruitradar"].update({"mode": "real", "dry_run": True, "keyword": "Python", "limit": 1})
    command = local_control.build_recruitradar_command("search", config)
    assert command[:3] == [local_control.sys.executable, "-m", "lakejob.application.recruiting.search"]
    args = recruitradar_search.build_parser().parse_args(command[3:])
    assert args.keyword == "Python"
    assert args.real is True
    assert args.dry_run is True


def test_jobradar_local_control_uses_module_entrypoint():
    config = local_control.load_config()
    config["jobradar"].update({"mode": "real", "keyword": "AI", "limit": 1})
    command = local_control.build_jobradar_command("search", config)
    assert command[:3] == [local_control.sys.executable, "-m", "scripts.run_real_mode_smoke_test"]
    assert "--mode" in command and "jobradar" in command


def test_state_machine_rejects_premature_success():
    assert transition("draft", "pending_confirmation", kind="message") == ActionState.pending_confirmation
    with pytest.raises(ValueError):
        transition("draft", "sent", kind="message")
    with pytest.raises(ValueError):
        transition("draft", "applied", kind="application")


def test_visual_target_is_never_actionable():
    target = platform_target_from_record({
        "platform": "boss", "source_url": "vision://job/1",
        "can_real_apply": True, "details_confirmed_at": datetime.now(timezone.utc),
        "confirmation_evidence": {"title": "Engineer"},
    })
    assert target.can_real_apply is False
    with pytest.raises(PermissionError):
        target.require("apply")


def test_confirmed_target_can_allow_one_action():
    target = PlatformTarget(
        platform="boss", source_url="https://www.zhipin.com/job/1",
        details_confirmed_at=datetime.now(timezone.utc),
        confirmation_evidence={"url": "https://www.zhipin.com/job/1", "title": "Engineer"},
        can_real_apply=True,
    )
    target.require("apply")
    with pytest.raises(PermissionError):
        target.require("message")


def test_click_validation_blocks_low_confidence_and_outside_viewport():
    low = GroundedElement("search_button", 10, 10, (0, 0, 20, 20), confidence=0.2)
    with pytest.raises(ValueError):
        UIGrounder.validate_click(low, viewport_width=100, viewport_height=100)
    outside = GroundedElement("search_button", 105, 10, (90, 0, 120, 20), confidence=0.9)
    with pytest.raises(ValueError):
        UIGrounder.validate_click(outside, viewport_width=100, viewport_height=100)


def test_migrations_are_ordered_and_exclude_verification_sql():
    names = [path.name for path in db_migrate.migration_files()]
    assert names == sorted(names)
    assert "verify_saas_admin.sql" not in names
    assert "20260611_001_action_states_targets.sql" in names


def test_release_archive_excludes_local_artifacts(tmp_path: Path):
    output = make_release(tmp_path / "release.zip")
    with ZipFile(output) as archive:
        names = archive.namelist()
    assert "README.md" in names
    assert not any(name.startswith(("runtime/", "uploads/", "logs/", ".venv/", "venv/")) for name in names)
    assert not any(name.endswith((".db", ".sqlite", ".pyc")) for name in names)


def test_release_archive_keeps_visual_runtime_source(tmp_path: Path):
    output = make_release(tmp_path / "release.zip")
    with ZipFile(output) as archive:
        names = archive.namelist()
    assert "lakejob/infrastructure/vision/runtime/__init__.py" in names
    assert "lakejob/infrastructure/vision/runtime/runner.py" in names


def test_redaction_removes_private_values():
    value = redact("email=a@example.com phone=13800138000 token=secret screenshot=C:/tmp/private.png")
    assert "a@example.com" not in value
    assert "13800138000" not in value
    assert "secret" not in value
