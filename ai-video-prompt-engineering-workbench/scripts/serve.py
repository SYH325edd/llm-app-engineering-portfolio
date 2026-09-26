from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "apps" / "api"))
sys.path.insert(0, str(ROOT / "packages" / "prompt_foundry_v13" / "src"))

import uvicorn

from build_identity import BUILD_ID

APP_VERSION = "2.1.0"
FRAMEWORK_VERSION = "1.3-frozen"


def _browser_host(host: str) -> str:
    return "127.0.0.1" if host in {"0.0.0.0", "::"} else host


def _is_port_available(host: str, port: int) -> bool:
    bind_host = "127.0.0.1" if host in {"0.0.0.0", "::"} else host
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((bind_host, port))
        except OSError:
            return False
    return True


def _running_prompt_foundry_identity(base_url: str) -> dict[str, str] | None:
    try:
        with urllib.request.urlopen(f"{base_url.rstrip('/')}/api/health", timeout=0.8) as response:
            if response.status != 200:
                return None
            payload = json.loads(response.read().decode("utf-8"))
            return {
                "version": str(payload.get("version") or ""),
                "framework": str(payload.get("framework") or ""),
                "build_id": str(payload.get("build_id") or ""),
            }
    except Exception:
        return None


def _running_prompt_foundry_version(base_url: str) -> str | None:
    identity = _running_prompt_foundry_identity(base_url)
    if not identity or identity.get("framework") != FRAMEWORK_VERSION:
        return None
    return identity.get("version") or None

def select_startup_port(host: str, requested_port: int, *, max_tries: int = 50) -> tuple[int, bool]:
    browser_host = _browser_host(host)
    if _is_port_available(host, requested_port):
        return requested_port, False

    requested_url = f"http://{browser_host}:{requested_port}"
    identity = _running_prompt_foundry_identity(requested_url)
    if (
        identity
        and identity.get("version") == APP_VERSION
        and identity.get("framework") == FRAMEWORK_VERSION
        and identity.get("build_id") == BUILD_ID
    ):
        return requested_port, True

    for port in range(requested_port + 1, requested_port + max_tries + 1):
        if _is_port_available(host, port):
            return port, False
    raise RuntimeError(f"No free local port found in range {requested_port}-{requested_port + max_tries}")


def open_browser_url(base_url: str) -> bool:
    """Open the local UI with a Windows-native path first, then portable fallbacks."""
    if os.name == "nt":
        startfile = getattr(os, "startfile", None)
        if callable(startfile):
            try:
                startfile(base_url)
                return True
            except OSError:
                pass

    try:
        if webbrowser.open(base_url, new=2):
            return True
    except Exception:
        pass

    if os.name == "nt":
        try:
            subprocess.Popen(
                ["cmd", "/c", "start", "", base_url],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return True
        except OSError:
            pass

    return False


def open_browser_when_ready(
    base_url: str,
    *,
    timeout_seconds: float = 30.0,
    expected_version: str = APP_VERSION,
    expected_build_id: str = BUILD_ID,
) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        identity = _running_prompt_foundry_identity(base_url)
        if (
            identity
            and identity.get("version") == expected_version
            and identity.get("framework") == FRAMEWORK_VERSION
            and identity.get("build_id") == expected_build_id
        ):
            if open_browser_url(base_url):
                print(f"Opened browser: {base_url}", flush=True)
            else:
                print(f"Browser auto-open failed. Open this URL manually: {base_url}", flush=True)
            return
        time.sleep(0.25)
    print(f"Backend did not become ready in time. Check the console, then open: {base_url}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=f"Run AI Video Prompt Engineering Workbench {APP_VERSION} local web app")
    parser.add_argument("--open-browser", action="store_true", help="Open the local web UI after the correct backend version is ready")
    args = parser.parse_args()

    host = os.getenv("API_HOST", "127.0.0.1")
    requested_port = int(os.getenv("API_PORT", "8000"))
    port, reuse_existing = select_startup_port(host, requested_port)
    browser_host = _browser_host(host)
    base_url = f"http://{browser_host}:{port}"

    if reuse_existing:
        print(f"Prompt Foundry v{APP_VERSION} build {BUILD_ID} is already running at {base_url}")
        if args.open_browser:
            if not open_browser_url(base_url):
                print(f"Browser auto-open failed. Open this URL manually: {base_url}", flush=True)
        return

    if port != requested_port:
        print(f"Port {requested_port} is occupied by another/older build. Starting v{APP_VERSION} build {BUILD_ID} on {base_url} instead.")
    else:
        print(f"Starting AI Video Prompt Engineering Workbench v{APP_VERSION} build {BUILD_ID} at {base_url}")

    if args.open_browser:
        threading.Thread(target=open_browser_when_ready, args=(base_url,), daemon=True).start()

    uvicorn.run("app.main:app", host=host, port=port, reload=False)


if __name__ == "__main__":
    main()
