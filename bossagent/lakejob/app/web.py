from lakejob.app.routes.resumes import router as resumes_router
from pathlib import Path

from lakejob.paths import PROJECT_ROOT

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from lakejob.app.admin import router as admin_mutation_router
from lakejob.shared.i18n import LANG_COOKIE
from lakejob.app.routes.admin import router as admin_router
from lakejob.app.routes.auth import router as auth_router
from lakejob.app.routes.browser import router as browser_router
from lakejob.app.routes.candidates import router as candidates_router
from lakejob.app.routes.dashboard import router as dashboard_router
from lakejob.app.routes.flows import router as flows_router
from lakejob.app.routes.health import router as health_router
from lakejob.app.routes.jobs import router as jobs_router
from lakejob.app.routes.local_control import router as local_control_router
from lakejob.app.routes.logs import router as logs_router
from lakejob.app.routes.messages import router as messages_router
from lakejob.app.routes.orchestration import router as orchestration_router
from lakejob.app.routes.profiles import router as profiles_router
from lakejob.app.routes.settings import router as settings_router
from lakejob.app.routes.scheduler import router as scheduler_router
from lakejob.app.routes.talent_pool import router as talent_pool_router


ROOT = PROJECT_ROOT


def create_app() -> FastAPI:
    app = FastAPI(title="LakeJob Web Console")
    app.mount("/static", StaticFiles(directory=str(PROJECT_ROOT / "static")), name="static")
    app.include_router(health_router)
    app.include_router(dashboard_router)
    app.include_router(browser_router)
    app.include_router(settings_router)
    app.include_router(jobs_router)
    app.include_router(candidates_router)
    app.include_router(talent_pool_router)
    app.include_router(profiles_router)
    app.include_router(resumes_router)
    app.include_router(messages_router)
    app.include_router(orchestration_router)
    app.include_router(flows_router)
    app.include_router(auth_router)
    app.include_router(scheduler_router)
    app.include_router(local_control_router)
    app.include_router(logs_router)
    app.include_router(admin_router)
    app.include_router(admin_mutation_router)

    @app.middleware("http")
    async def language_cookie_middleware(request: Request, call_next):
        if request.method == "POST":
            host = (request.client.host if request.client else "").lower()
            if host not in {"127.0.0.1", "::1", "localhost", "testclient"}:
                return JSONResponse(
                    {"ok": False, "error": "POST actions are restricted to the local console"},
                    status_code=403,
                )
        response = await call_next(request)
        lang = request.query_params.get("lang")
        if lang in {"zh", "en"}:
            response.set_cookie(LANG_COOKIE, lang, max_age=60 * 60 * 24 * 365, samesite="lax")
        return response

    return app


app = create_app()
