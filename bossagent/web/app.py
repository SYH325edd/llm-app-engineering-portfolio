from web.routes.resumes import router as resumes_router
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from admin_skill import router as admin_mutation_router
from i18n import LANG_COOKIE
from web.routes.admin import router as admin_router
from web.routes.auth import router as auth_router
from web.routes.candidates import router as candidates_router
from web.routes.dashboard import router as dashboard_router
from web.routes.flows import router as flows_router
from web.routes.health import router as health_router
from web.routes.jobs import router as jobs_router
from web.routes.local_control import router as local_control_router
from web.routes.logs import router as logs_router
from web.routes.messages import router as messages_router
from web.routes.profiles import router as profiles_router
from web.routes.settings import router as settings_router
from web.routes.scheduler import router as scheduler_router
from web.routes.talent_pool import router as talent_pool_router


ROOT = Path(__file__).resolve().parents[1]


def create_app() -> FastAPI:
    app = FastAPI(title="LakeJob Web Console")
    app.mount("/static", StaticFiles(directory=str(ROOT / "static")), name="static")
    app.include_router(health_router)
    app.include_router(dashboard_router)
    app.include_router(settings_router)
    app.include_router(jobs_router)
    app.include_router(candidates_router)
    app.include_router(talent_pool_router)
    app.include_router(profiles_router)
    app.include_router(resumes_router)
    app.include_router(messages_router)
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
