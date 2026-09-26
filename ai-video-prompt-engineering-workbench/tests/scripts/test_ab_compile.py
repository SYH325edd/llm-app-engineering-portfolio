from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_ab_compile_cli_writes_three_stage0_artifacts(tmp_path):
    command = [
        sys.executable, str(ROOT / 'scripts' / 'ab_compile.py'),
        '--run-id', 'run_75ba9d49f638',
        '--run-file', str(ROOT / 'tests' / 'fixtures' / 'consumption_regression_run.json'),
        '--shots', 'SH008,SH017,SH034,SH041,SH043,SH049',
        '--output-dir', str(tmp_path),
    ]
    completed = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
    assert completed.returncode == 0, completed.stderr
    for name in ['A_legacy.md', 'B_consumption.md', 'diff_record.md']:
        assert (tmp_path / name).exists()
    text = (tmp_path / 'B_consumption.md').read_text(encoding='utf-8')
    assert 'SH008' in text and 'SH049' in text
    assert 'E001_ENTITY_MISBIND' in text
