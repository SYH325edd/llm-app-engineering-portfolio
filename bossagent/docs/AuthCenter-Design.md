# BOSS Auth Center Design

## Purpose

BOSS authentication is managed independently from job search, candidate search, messaging, and application flows.

## Files

- `runtime/boss_auth_state.json`: Playwright storage state plus `_lakejob.browser_type` metadata.
- `runtime/boss_chromium_profile`: Chromium persistent user data directory.
- `runtime/boss_auth_center_status.json`: latest auth and search errors.
- `runtime/debug_auth_login.html` and `.png`: standalone login debug artifacts.

## Login

```powershell
python boss_auth_login.py --browser-type chromium
```

The script opens only `https://www.zhipin.com/`, waits for manual login confirmation, and saves storage state. It never searches, messages, or applies.

Reset options:

```powershell
python boss_auth_login.py --browser-type chromium --reset-auth
python boss_auth_login.py --browser-type chromium --reset-browser-profile
```

## States

- `AUTH_OK`: auth state is structurally valid and no later auth failure is recorded.
- `AUTH_MISSING`: auth state does not exist.
- `AUTH_EXPIRED`: a login/expiry condition was recorded.
- `AUTH_BLOCKED`: a security check, verification, or account restriction was recorded.
- `AUTH_UNKNOWN`: state is invalid or BOSS remained blank/loading.

`/auth-center` is read-only and does not launch a browser.

