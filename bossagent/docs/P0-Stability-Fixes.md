# P0 Stability Fixes

This release hardens the Local MVP boundary:

- Python subprocesses launched by `local_control.py` use `sys.executable`.
- RecruitRadar real-message smoke is disabled and cannot fall through to JobRadar.
- Control Center is limited to safe configuration, status, and six explicit destinations.
- Runtime state, uploads, virtual environments, browser profiles, auth state, and build output are ignored by Git.
- Page-responsibility and release-safety checks run fully offline.

Real BOSS Mode remains experimental and is outside the stable Local MVP guarantee.
