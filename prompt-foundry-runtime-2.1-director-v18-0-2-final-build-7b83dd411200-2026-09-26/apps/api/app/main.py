from __future__ import annotations

import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from runtime.checkpoints import CheckpointStore
from runtime.orchestrator import RuntimeV20
from build_identity import BUILD_ID

from .ark import ArkClient, ArkConfigurationError
from .config import load_env_file, read_env_file, update_env_file
from .schemas import ArkConfigRequest, CreateRunRequest
from .store import RunStore


PROJECT_ROOT = Path(__file__).resolve().parents[3]
APP_VERSION = "2.1.0"
RUNTIME_VERSION = "2.1"
FRAMEWORK_VERSION = "1.3-frozen"




def _recover_orphaned_runs(store: RunStore) -> None:
    """Convert persisted in-flight runs into recoverable paused runs on process start."""
    now = datetime.now(timezone.utc).isoformat()
    for summary in store.list():
        if summary.get("status") not in {"pending", "running"}:
            continue
        run_id = summary.get("run_id")
        run = store.get(str(run_id)) if run_id else None
        if not isinstance(run, dict):
            continue
        run["status"] = "paused"
        run["updated_at"] = now
        run["error"] = {
            "type": "runtime_restarted",
            "unit_id": run.get("current_unit"),
            "stage": run.get("current_stage"),
            "message": "Runtime process restarted while this run was in flight. Completed checkpoints were preserved; resume from the current unit.",
        }
        run.setdefault("events", []).append({
            "event_id": f"evt_restart_{str(run_id)[-8:]}",
            "type": "runtime_restarted",
            "unit_id": run.get("current_unit"),
            "stage": run.get("current_stage"),
            "status": "paused",
            "message": "Process restart detected; run is recoverable from checkpoints.",
            "created_at": now,
        })
        store.save(run)

def _default_store() -> RunStore:
    return RunStore(PROJECT_ROOT / "data" / "runs")


def _default_checkpoint_store() -> CheckpointStore:
    return CheckpointStore(PROJECT_ROOT / "data" / "checkpoints")


def _checkpoint_store_for_injected_run_store(store: RunStore) -> CheckpointStore:
    """Keep dependency-injected run/checkpoint persistence in the same sandbox.

    A caller that injects a custom RunStore (tests, isolated deployments, tooling)
    must never fall back to the project's production checkpoint directory.
    """
    root = Path(store.root)
    base = root.parent if root.name == "runs" else root
    return CheckpointStore(base / "checkpoints")


def _model_from_config_path(config_path: Path) -> ArkClient | None:
    values = read_env_file(config_path)
    api_key = values.get("ARK_API_KEY", "").strip()
    model = values.get("ARK_MODEL", "").strip()
    if not api_key or not model:
        return None
    base_url = values.get("ARK_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3").rstrip("/")
    try:
        timeout = float(values.get("ARK_TIMEOUT_SECONDS", "300"))
    except ValueError:
        timeout = 300.0
    try:
        max_completion_tokens = int(values.get("ARK_MAX_COMPLETION_TOKENS", "32768"))
    except ValueError:
        max_completion_tokens = 32768
    try:
        max_transport_retries = max(0, int(values.get("ARK_MAX_TRANSPORT_RETRIES", "5")))
    except ValueError:
        max_transport_retries = 5
    try:
        retry_base_seconds = max(0.0, float(values.get("ARK_RETRY_BASE_SECONDS", "2")))
    except ValueError:
        retry_base_seconds = 2.0
    try:
        retry_max_seconds = max(retry_base_seconds, float(values.get("ARK_RETRY_MAX_SECONDS", "30")))
    except ValueError:
        retry_max_seconds = max(30.0, retry_base_seconds)
    try:
        min_request_interval_seconds = max(0.0, float(values.get("ARK_MIN_REQUEST_INTERVAL_SECONDS", "0.75")))
    except ValueError:
        min_request_interval_seconds = 0.75
    return ArkClient(
        api_key=api_key, model=model, base_url=base_url, timeout_seconds=timeout,
        max_completion_tokens=max_completion_tokens, max_transport_retries=max_transport_retries,
        retry_base_seconds=retry_base_seconds, retry_max_seconds=retry_max_seconds,
        min_request_interval_seconds=min_request_interval_seconds,
    )


def _default_model(config_path: Path) -> Any | None:
    file_model = _model_from_config_path(config_path)
    if file_model is not None:
        return file_model
    load_env_file(config_path)
    try:
        return ArkClient.from_env()
    except ArkConfigurationError:
        return None


def _masked_key(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 4:
        return "••••"
    return f"••••{value[-4:]}"


def _public_config(active_model: Any | None) -> dict[str, Any]:
    api_key = getattr(active_model, "api_key", None)
    timeout = getattr(active_model, "timeout_seconds", None)
    max_completion_tokens = getattr(active_model, "max_completion_tokens", None)
    max_transport_retries = getattr(active_model, "max_transport_retries", None)
    retry_base_seconds = getattr(active_model, "retry_base_seconds", None)
    retry_max_seconds = getattr(active_model, "retry_max_seconds", None)
    min_request_interval_seconds = getattr(active_model, "min_request_interval_seconds", None)
    return {
        "configured": active_model is not None,
        "api_key_configured": bool(api_key) if active_model is not None else False,
        "api_key_hint": _masked_key(api_key),
        "model": getattr(active_model, "model", None),
        "base_url": getattr(active_model, "base_url", None),
        "timeout_seconds": timeout,
        "max_completion_tokens": max_completion_tokens,
        "max_transport_retries": max_transport_retries,
        "retry_base_seconds": retry_base_seconds,
        "retry_max_seconds": retry_max_seconds,
        "min_request_interval_seconds": min_request_interval_seconds,
    }


def create_app(
    *,
    model: Any | None = None,
    store: RunStore | None = None,
    checkpoint_store: CheckpointStore | None = None,
    config_path: str | Path | None = None,
    autoload_model: bool = True,
    sync_runs: bool = True,
) -> FastAPI:
    app = FastAPI(title="Prompt Foundry Runtime 2.1 API", version=APP_VERSION)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.config_path = Path(config_path) if config_path is not None else PROJECT_ROOT / ".env"
    app.state.model = model if model is not None else (_default_model(app.state.config_path) if autoload_model else None)
    app.state.store = store if store is not None else _default_store()
    if checkpoint_store is not None:
        app.state.checkpoints = checkpoint_store
    elif store is not None:
        app.state.checkpoints = _checkpoint_store_for_injected_run_store(app.state.store)
    else:
        app.state.checkpoints = _default_checkpoint_store()
    _recover_orphaned_runs(app.state.store)
    app.state.sync_runs = sync_runs
    app.state.active_jobs: set[str] = set()
    app.state.jobs_lock = threading.Lock()

    def runtime() -> RuntimeV20:
        active_model = app.state.model
        if active_model is None:
            raise HTTPException(status_code=503, detail="Ark model is not configured")
        return RuntimeV20(model=active_model, store=app.state.store, checkpoints=app.state.checkpoints)

    def schedule(run_id: str, operation: Callable[[RuntimeV20, str], dict[str, Any]]) -> None:
        with app.state.jobs_lock:
            if run_id in app.state.active_jobs:
                return
            app.state.active_jobs.add(run_id)

        def worker() -> None:
            try:
                operation(runtime(), run_id)
            except Exception:
                # RuntimeV20 persists unit/run failures itself. Avoid killing the local server thread.
                pass
            finally:
                with app.state.jobs_lock:
                    app.state.active_jobs.discard(run_id)

        threading.Thread(target=worker, daemon=True, name=f"pf-{run_id}").start()

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "version": APP_VERSION,
            "runtime": RUNTIME_VERSION,
            "framework": FRAMEWORK_VERSION,
            "build_id": BUILD_ID,
            "contracts": dict(RuntimeV20.CONTRACTS),
        }

    @app.get("/api/config")
    def config() -> dict[str, Any]:
        return _public_config(app.state.model)

    @app.put("/api/config")
    def save_config(payload: ArkConfigRequest) -> dict[str, Any]:
        existing = read_env_file(app.state.config_path)
        api_key = payload.api_key or existing.get("ARK_API_KEY", "").strip()
        if not api_key:
            raise HTTPException(status_code=422, detail="ARK_API_KEY is required")
        update_env_file(
            app.state.config_path,
            {
                "ARK_API_KEY": api_key,
                "ARK_MODEL": payload.model,
                "ARK_BASE_URL": payload.base_url,
                "ARK_TIMEOUT_SECONDS": str(payload.timeout_seconds).rstrip("0").rstrip("."),
                "ARK_MAX_COMPLETION_TOKENS": str(payload.max_completion_tokens),
            },
        )
        # Saving endpoint/model settings must not silently reset the provider transport policy.
        # Prefer the active client's values; otherwise recover the persisted env values.
        active = app.state.model
        try:
            max_transport_retries = int(getattr(active, "max_transport_retries", existing.get("ARK_MAX_TRANSPORT_RETRIES", "5")))
        except (TypeError, ValueError):
            max_transport_retries = 5
        try:
            retry_base_seconds = float(getattr(active, "retry_base_seconds", existing.get("ARK_RETRY_BASE_SECONDS", "2")))
        except (TypeError, ValueError):
            retry_base_seconds = 2.0
        try:
            retry_max_seconds = float(getattr(active, "retry_max_seconds", existing.get("ARK_RETRY_MAX_SECONDS", "30")))
        except (TypeError, ValueError):
            retry_max_seconds = 30.0
        max_transport_retries = max(0, max_transport_retries)
        retry_base_seconds = max(0.0, retry_base_seconds)
        retry_max_seconds = max(retry_base_seconds, retry_max_seconds)
        try:
            min_request_interval_seconds = float(
                getattr(active, "min_request_interval_seconds", existing.get("ARK_MIN_REQUEST_INTERVAL_SECONDS", "0.75"))
            )
        except (TypeError, ValueError):
            min_request_interval_seconds = 0.75
        min_request_interval_seconds = max(0.0, min_request_interval_seconds)
        app.state.model = ArkClient(
            api_key=api_key,
            model=payload.model,
            base_url=payload.base_url,
            timeout_seconds=payload.timeout_seconds,
            max_completion_tokens=payload.max_completion_tokens,
            max_transport_retries=max_transport_retries,
            retry_base_seconds=retry_base_seconds,
            retry_max_seconds=retry_max_seconds,
            min_request_interval_seconds=min_request_interval_seconds,
        )
        return _public_config(app.state.model)

    @app.post("/api/model/test")
    def model_test() -> dict[str, Any]:
        active_model = app.state.model
        if active_model is None:
            raise HTTPException(status_code=503, detail="Ark model is not configured")
        try:
            if hasattr(active_model, "generate_text"):
                text = active_model.generate_text("You are a connectivity test. Reply with exactly pong.", "ping", temperature=0.0)
            else:
                active_model.generate_json("health", "Return JSON only.", {"ping": True})
                text = "pong"
        except Exception as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        return {"ok": True, "response": str(text)[:200]}

    @app.post("/api/runs")
    def create_run(payload: CreateRunRequest) -> dict[str, Any]:
        rt = runtime()
        try:
            run = rt.create(payload.source_text, payload.title)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if app.state.sync_runs:
            return rt.execute(run["run_id"])
        schedule(run["run_id"], lambda runtime_obj, rid: runtime_obj.execute(rid))
        return app.state.store.get(run["run_id"]) or run

    @app.post("/api/runs/{run_id}/resume")
    def resume_run(run_id: str) -> dict[str, Any]:
        if app.state.store.get(run_id) is None:
            raise HTTPException(status_code=404, detail="run not found")
        rt = runtime()
        if app.state.sync_runs:
            return rt.resume(run_id)
        schedule(run_id, lambda runtime_obj, rid: runtime_obj.resume(rid))
        return app.state.store.get(run_id) or {"run_id": run_id, "status": "pending"}

    @app.post("/api/runs/{run_id}/units/{unit_id:path}/retry")
    def retry_unit(run_id: str, unit_id: str) -> dict[str, Any]:
        if app.state.store.get(run_id) is None:
            raise HTTPException(status_code=404, detail="run not found")
        rt = runtime()
        if app.state.sync_runs:
            return rt.retry_unit(run_id, unit_id)
        schedule(run_id, lambda runtime_obj, rid: runtime_obj.retry_unit(rid, unit_id))
        return app.state.store.get(run_id) or {"run_id": run_id, "status": "pending"}

    @app.post("/api/runs/{run_id}/redistribute-overloaded")
    def redistribute_overloaded(run_id: str) -> dict[str, Any]:
        if app.state.store.get(run_id) is None:
            raise HTTPException(status_code=404, detail="run not found")
        rt = runtime()
        try:
            if app.state.sync_runs:
                return rt.redistribute_overloaded_shots(run_id)
            schedule(run_id, lambda runtime_obj, rid: runtime_obj.redistribute_overloaded_shots(rid))
            return app.state.store.get(run_id) or {"run_id": run_id, "status": "pending"}
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @app.get("/api/runs")
    def list_runs() -> list[dict[str, Any]]:
        return app.state.store.list()

    @app.get("/api/runs/{run_id}")
    def get_run(run_id: str) -> dict[str, Any]:
        run = app.state.store.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="run not found")
        return run

    @app.get("/api/runs/{run_id}/events")
    def get_events(run_id: str) -> list[dict[str, Any]]:
        run = app.state.store.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="run not found")
        return run.get("events", []) or []

    @app.get("/api/runs/{run_id}/outputs")
    def get_outputs(run_id: str) -> dict[str, Any]:
        run = app.state.store.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="run not found")
        artifacts = run.get("artifacts", {}) or {}
        compiled = artifacts.get("compiled_project") or {}
        partial_assets = artifacts.get("asset_prompts") or {}
        return {
            "script": artifacts.get("script"),
            "character_prompts": compiled.get("character_prompts") or partial_assets.get("character_prompts", []),
            "scene_prompts": compiled.get("scene_prompts") or partial_assets.get("scene_prompts", []),
            "shot_prompts": compiled.get("shot_prompts", []),
            "production_design": {
                "pvb": artifacts.get("pvb") or artifacts.get("pvb_candidate"),
                "psb": artifacts.get("psb") or artifacts.get("psb_candidate"),
                "style_guide": artifacts.get("style_guide") or artifacts.get("style_guide_candidate"),
            },
            "storyboard": artifacts.get("storyboard") or artifacts.get("storyboard_partial"),
            "shot_specs": artifacts.get("shot_specs", []),
            "static_evaluation": artifacts.get("static_evaluation"),
        }

    web_root = PROJECT_ROOT / "apps" / "web"
    if web_root.exists():
        app.mount("/", StaticFiles(directory=web_root, html=True), name="web")
    return app


# Production local app runs jobs in background so the browser can poll unit progress.
app = create_app(sync_runs=False)
