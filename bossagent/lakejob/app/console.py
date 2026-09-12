"""Compatibility entry point for the LakeJob web console."""

import uvicorn

from lakejob.app.web import app, create_app


def main() -> None:
    print("LakeJob Web Console running at http://localhost:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000)

__all__ = ["app", "create_app", "main"]


if __name__ == "__main__":
    main()
