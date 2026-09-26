from __future__ import annotations

import argparse
import logging
import os
import socket
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
LOG_PATH = DATA_DIR / "startup.log"


def configure_logging() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.FileHandler(LOG_PATH, encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
        force=True,
    )


def port_available(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((host, port))
            return True
        except OSError:
            return False


def choose_port(host: str, preferred: int, attempts: int = 20) -> int:
    for port in range(preferred, preferred + attempts):
        if port_available(host, port):
            return port
    raise RuntimeError(f"No free local port found in {preferred}-{preferred + attempts - 1}")


def wait_and_open(url: str, timeout: float = 20.0) -> None:
    health_url = url.rstrip("/") + "/api/health"
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(health_url, timeout=1.0) as response:
                if response.status == 200:
                    logging.info("Health check passed: %s", health_url)
                    if os.environ.get("AICS_NO_BROWSER") != "1":
                        webbrowser.open(url.rstrip("/") + "/projects")
                    return
        except Exception:
            time.sleep(0.35)
    logging.warning("Server did not become ready within %.1f seconds; browser was not opened.", timeout)


def main() -> int:
    configure_logging()
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.environ.get("AICS_PORT", "8000")))
    args = parser.parse_args()

    if sys.version_info < (3, 10):
        raise RuntimeError("Python 3.10 or newer is required")

    port = choose_port(args.host, args.port)
    if port != args.port:
        logging.warning("Port %s is occupied; using port %s instead.", args.port, port)

    # Import the application before opening a browser so startup/import errors are
    # captured in startup.log and surfaced in the launcher window.
    try:
        import uvicorn
        from app.main import app
    except Exception:
        logging.exception("Application import failed")
        return 2

    url = f"http://{args.host}:{port}"
    logging.info("AI Commerce Studio starting at %s/projects", url)
    logging.info("Startup log: %s", LOG_PATH)
    threading.Thread(target=wait_and_open, args=(url,), daemon=True).start()

    try:
        uvicorn.run(app, host=args.host, port=port, reload=False, log_level="info")
        return 0
    except KeyboardInterrupt:
        logging.info("Stopped by user")
        return 0
    except Exception:
        logging.exception("Server startup/runtime failed")
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
