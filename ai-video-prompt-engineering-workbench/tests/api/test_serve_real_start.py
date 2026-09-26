from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def test_scripts_serve_starts_real_runtime20_app():
    port = _free_port()
    env = os.environ.copy()
    env["API_HOST"] = "127.0.0.1"
    env["API_PORT"] = str(port)
    proc = subprocess.Popen(
        [sys.executable, "scripts/serve.py"],
        cwd=ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        deadline = time.monotonic() + 8.0
        last_error = None
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                output = proc.stdout.read() if proc.stdout else ""
                raise AssertionError(f"serve.py exited early with {proc.returncode}: {output}")
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=0.5) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                    assert response.status == 200
                    assert payload["version"] == "2.1.0"
                    assert payload["runtime"] == "2.1"
                    assert payload["framework"] == "1.3-frozen"
                    return
            except Exception as exc:  # startup polling
                last_error = exc
                time.sleep(0.1)
        raise AssertionError(f"serve.py did not become healthy: {last_error!r}")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=3)
