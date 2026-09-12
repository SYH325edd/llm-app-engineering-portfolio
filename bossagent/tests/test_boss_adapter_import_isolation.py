from __future__ import annotations

import importlib
import sys


def test_importing_boss_adapter_does_not_import_legacy_browser() -> None:
    sys.modules.pop("lakejob.infrastructure.platforms.boss.adapter", None)
    sys.modules.pop("lakejob.infrastructure.platforms.boss.compat.browser", None)
    importlib.import_module("lakejob.infrastructure.platforms.boss.adapter")
    assert "lakejob.infrastructure.platforms.boss.compat.browser" not in sys.modules
