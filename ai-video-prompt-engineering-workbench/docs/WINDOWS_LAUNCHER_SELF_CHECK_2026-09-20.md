# Windows launcher self-check — 2026-09-20

## Symptom
Double-clicking the Windows launcher could start the backend without opening the browser, or close too quickly to expose startup errors.

## Root causes
- `webbrowser.open()` was the only browser-launch path and its return value was ignored.
- Browser-ready timeout failed silently.
- The batch launcher did not keep the window open for Python/venv/server startup failures.
- There was no canonical `start.bat` alias for a normal Windows double-click workflow.

## Fix
- Added `start.bat` as the canonical Windows double-click entry.
- Browser opening now prefers Windows `os.startfile(URL)`, falls back to Python `webbrowser`, then `cmd /c start`.
- Browser-ready timeout prints the exact local URL instead of failing silently.
- `start_windows.bat` checks Python, venv creation/activation, pip installation and server exit codes, and pauses on failure.
- The launcher prints the manual URL path if automatic opening fails.

## Invariants
No runtime stage, Prompt, contract, Ark configuration, checkpoint, token telemetry or final prompt compiler behavior was changed.
