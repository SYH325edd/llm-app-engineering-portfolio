# v1.2 Startup Fix Verification

Date: 2026-09-23

## Concrete startup defects found in v1.1

1. `start.bat` skipped dependency verification whenever `.venv\Scripts\python.exe` existed. A partially installed or stale virtual environment could therefore reach `run_local.py` with missing packages.
2. If `run_local.py` exited (for example because port 8000 was occupied or an import failed), the old batch file immediately reached EOF and the double-click console disappeared. This directly matches the reported “start flashes and closes” symptom.
3. Runtime was hard-bound to port 8000 with no fallback.
4. Distributed Windows batch files used LF-only line endings rather than CRLF. Modern Windows often tolerates this, but it is unnecessary compatibility risk for a double-click launcher.

## v1.2 fixes

- `start.bat` now verifies Python >= 3.10.
- Existing `.venv` is health-checked; broken environments are rebuilt.
- Required imports are checked on every start; missing dependencies trigger repair/install.
- All launcher failures remain visible and end with `pause`; unexpected server exit no longer silently closes.
- `run_local.py` writes `data/startup.log`.
- If 8000 is already occupied, runtime selects the next available local port (up to 8019).
- Browser opens only after `/api/health` returns 200.
- `repair.bat` rebuilds only `.venv`, preserving projects and API settings.
- `diagnose.bat` prints Python, dependency, port and startup-log diagnostics.
- `.bat` files are packaged with CRLF line endings.

## Verification performed

- Python compile check: PASS.
- Automated regression tests: 8/8 PASS.
- Existing business-chain tests: PASS.
- Launcher-specific tests: CRLF/error-pause/dependency-check PASS.
- Occupied-port runtime smoke test: with port 8000 pre-occupied, app selected 8001 and `/api/health` returned version 1.2.0.

## Boundary

The current execution environment is Linux, so native Windows `cmd.exe` double-click execution cannot be run here. The Windows launcher itself was therefore verified structurally (CRLF and command paths) and the Python runtime/bootstrap behavior was exercised independently. The real Windows machine is still the final environment check.
