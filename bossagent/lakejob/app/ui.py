from __future__ import annotations

from pathlib import Path

from lakejob.paths import PROJECT_ROOT
from urllib.parse import urlencode

from fastapi.responses import RedirectResponse
from fastapi.templating import Jinja2Templates

from lakejob.shared.i18n import get_locale, t


ROOT = PROJECT_ROOT

templates = Jinja2Templates(directory=str(PROJECT_ROOT / "templates"))
templates.env.globals["get_locale"] = get_locale
templates.env.globals["t"] = t


def redirect(path: str, message: str = "", error: str = "") -> RedirectResponse:
    query = {}
    if message:
        query["message"] = message
    if error:
        query["error"] = error
    suffix = "?" + urlencode(query) if query else ""
    return RedirectResponse(path + suffix, status_code=303)
