from __future__ import annotations

import json
import mimetypes
import shutil
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .ark_client import ArkClient, ArkError, file_to_data_url
from .config import DEFAULT_BASE_URL, DEFAULT_MODELS, OFFICIAL_LINKS, PROJECTS_DIR, ROOT
from .db import (
    add_asset,
    create_project,
    get_asset,
    get_project,
    init_db,
    list_assets,
    list_projects,
    list_tasks,
    update_asset_metadata,
    update_project,
    update_task,
)
from .exporter import export_project
from .models import ProjectCreate, ProjectPatch, ProviderSettingsIn, SourceRoleUpdate
from .security import load_provider_settings, save_provider_settings
from .prompt_craft import normalize_source_role
from .services import analyze_project, approve_project_prompts, compile_project_prompts, ensure_tasks, plan_project, result_payload, start_generation

app = FastAPI(title="E-commerce Visual Content Ecosystem Platform", version="1.9.0")
init_db()

STATIC_DIR = ROOT / "app" / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/files", StaticFiles(directory=PROJECTS_DIR), name="project-files")


@app.get("/api/health")
def health():
    return {"ok": True, "name": "E-commerce Visual Content Ecosystem Platform", "version": "1.9.0"}


@app.get("/api/settings/provider")
def get_provider():
    data = load_provider_settings(False)
    data["official_links"] = OFFICIAL_LINKS
    return data


@app.post("/api/settings/provider")
def post_provider(payload: ProviderSettingsIn):
    if not payload.base_url.startswith("https://"):
        raise HTTPException(400, "Base URL 必须使用 https://")
    return save_provider_settings(payload.base_url, payload.models, payload.api_key)


@app.post("/api/settings/test")
def test_provider():
    try:
        client = ArkClient()
        result = client.text("只回复 OK，不要输出其他内容。")
        return {"ok": True, "model": client.models["reasoning"], "latency_ms": result["latency_ms"], "output": result["text"][:100]}
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)


@app.post("/api/models/test/{kind}")
def test_model(kind: str):
    try:
        client = ArkClient()
        if kind == "text":
            r = client.text("只回复 OK。")
            return {"ok": True, "model": client.models["reasoning"], "latency_ms": r["latency_ms"], "output": r["text"][:100]}
        if kind == "vision":
            # Self-contained PNG avoids relying on external URLs.
            import base64, io
            from PIL import Image, ImageDraw
            im = Image.new("RGB", (256, 256), "white")
            ImageDraw.Draw(im).ellipse((56, 56, 200, 200), fill=(114, 92, 246))
            buf = io.BytesIO(); im.save(buf, format="PNG")
            data_url = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
            r = client.vision('只输出严格 JSON：{"imageReadable":true}。如果能看到一个紫色圆形则 true。', [data_url])
            return {"ok": True, "model": client.models["vision"], "latency_ms": r["latency_ms"], "output": r["text"][:300]}
        if kind == "image":
            r = client.image("一个白色陶瓷杯置于中性纯净背景，商业商品摄影，无文字")
            return {"ok": True, "model": client.models["image"], "latency_ms": r["latency_ms"], "url": r["url"]}
        if kind == "video":
            r = client.video_create("白色陶瓷杯置于干净桌面，镜头缓慢推进，商品广告风格，无文字", duration=5, ratio="9:16")
            return {"ok": True, "model": client.models["video"], "task_id": r.get("id"), "note": "已提交真实视频任务，可在火山方舟控制台查询。"}
        raise HTTPException(404, "未知模型类型")
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)




@app.post("/api/demo/bootstrap")
def bootstrap_demo():
    from PIL import Image, ImageDraw
    p = create_project({
        "name": "AeroCup 便携榨汁杯",
        "category": "厨房小家电",
        "brand": "DEMO",
        "price": "89.9",
        "selling_points": ["便携杯型设计", "透明杯体", "一体化便携结构"],
        "product_params": {"数据说明": "仅演示用户输入字段，不代表真实商品参数"},
        "mode": "demo",
    })
    source_dir = PROJECTS_DIR / p["id"] / "source"
    source_dir.mkdir(parents=True, exist_ok=True)
    path = source_dir / "source-01.png"
    im = Image.new("RGB", (900, 1100), (247, 248, 252))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((260, 110, 640, 980), radius=95, fill=(245, 247, 252), outline=(78, 87, 112), width=7)
    d.rounded_rectangle((294, 160, 606, 560), radius=120, fill=(204, 231, 242), outline=(123, 165, 184), width=5)
    d.rounded_rectangle((300, 590, 600, 920), radius=70, fill=(233, 236, 244), outline=(118, 126, 148), width=5)
    d.ellipse((415, 720, 485, 790), fill=(103, 89, 245))
    im.save(path)
    add_asset(p["id"], "source", "demo-product.png", str(path), mime="image/png", metadata={"demo": True})
    analyze_project(p["id"]); plan_project(p["id"]); compile_project_prompts(p["id"]); approve_project_prompts(p["id"]); ensure_tasks(p["id"]); start_generation(p["id"])
    return {"ok": True, "projectId": p["id"]}


@app.get("/api/projects")
def projects():
    result = []
    for p in list_projects():
        ts = list_tasks(p["id"])
        result.append({**p, "taskCount": len(ts), "completedCount": sum(1 for t in ts if t["status"] == "completed")})
    return result


@app.post("/api/projects")
def create(payload: ProjectCreate):
    return create_project(payload.model_dump())


@app.get("/api/projects/{project_id}")
def project(project_id: str):
    p = get_project(project_id)
    if not p:
        raise HTTPException(404, "项目不存在")
    return result_payload(project_id)


@app.patch("/api/projects/{project_id}")
def patch_project(project_id: str, payload: ProjectPatch):
    if not get_project(project_id):
        raise HTTPException(404, "项目不存在")
    changes = payload.model_dump(exclude_none=True)
    # Any upstream edit invalidates downstream compiled prompts/tasks.
    if "product_profile" in changes:
        changes.update({"creative_plan": None, "prompt_bundle": None, "prompt_approved_at": None, "status": "planning"})
    elif "creative_plan" in changes:
        changes.update({"prompt_bundle": None, "prompt_approved_at": None, "status": "planning"})
    return update_project(project_id, **changes)


@app.post("/api/projects/{project_id}/upload")
async def upload(project_id: str, files: list[UploadFile] = File(...), source_role: str = "PRODUCT_TRUTH"):
    p = get_project(project_id)
    if not p:
        raise HTTPException(404, "项目不存在")
    source_role = normalize_source_role(source_role)
    existing = list_assets(project_id, "source")
    remaining = max(0, 5 - len(existing))
    if remaining <= 0:
        raise HTTPException(400, "最多上传 5 张商品图")
    saved = []
    source_dir = PROJECTS_DIR / project_id / "source"
    source_dir.mkdir(parents=True, exist_ok=True)
    for f in files[:remaining]:
        if f.content_type not in {"image/jpeg", "image/png", "image/webp"}:
            continue
        ext = mimetypes.guess_extension(f.content_type) or ".jpg"
        path = source_dir / f"source-{len(existing)+len(saved)+1:02d}{ext}"
        content = await f.read()
        if len(content) > 12 * 1024 * 1024:
            continue
        path.write_bytes(content)
        saved.append(add_asset(project_id, "source", f.filename or path.name, str(path), mime=f.content_type, metadata={"originalName": f.filename, "sourceRole": source_role}))
    if saved:
        update_project(project_id, product_profile=None, evidence_bundle=None, creative_plan=None, prompt_bundle=None, prompt_approved_at=None, status="draft")
    return {"saved": len(saved), "assets": saved}


@app.post("/api/assets/{asset_id}/source-role")
def set_source_role(asset_id: str, payload: SourceRoleUpdate):
    asset = get_asset(asset_id)
    if not asset or asset.get("kind") != "source":
        raise HTTPException(404, "素材不存在")
    metadata = dict(asset.get("metadata") or {})
    metadata["sourceRole"] = normalize_source_role(payload.source_role)
    updated = update_asset_metadata(asset_id, metadata)
    update_project(asset["project_id"], product_profile=None, evidence_bundle=None, creative_plan=None, prompt_bundle=None, prompt_approved_at=None, status="draft")
    return updated


@app.post("/api/projects/{project_id}/analyze")
def analyze(project_id: str):
    try:
        return analyze_project(project_id)
    except (ValueError, ArkError) as e:
        raise HTTPException(400, str(e))


@app.post("/api/projects/{project_id}/plan")
def plan(project_id: str):
    try:
        return plan_project(project_id)
    except (ValueError, ArkError) as e:
        raise HTTPException(400, str(e))


@app.post("/api/projects/{project_id}/compile-prompts")
def compile_prompts(project_id: str):
    try:
        return compile_project_prompts(project_id)
    except (ValueError, ArkError) as e:
        raise HTTPException(400, str(e))


@app.post("/api/projects/{project_id}/approve-prompts")
def approve_prompts(project_id: str):
    try:
        return approve_project_prompts(project_id)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/projects/{project_id}/generate")
def generate(project_id: str):
    p = get_project(project_id)
    if not p:
        raise HTTPException(404, "项目不存在")
    try:
        tasks = ensure_tasks(project_id)
        start_generation(project_id)
        return {"ok": True, "status": "generating", "taskCount": len(tasks)}
    except Exception as e:
        raise HTTPException(400, str(e))


@app.get("/api/projects/{project_id}/tasks")
def tasks(project_id: str):
    if not get_project(project_id):
        raise HTTPException(404, "项目不存在")
    return list_tasks(project_id)


@app.get("/api/projects/{project_id}/result")
def result(project_id: str):
    if not get_project(project_id):
        raise HTTPException(404, "项目不存在")
    return result_payload(project_id)


@app.post("/api/assets/{asset_id}/regenerate")
def regenerate(asset_id: str):
    task = next((t for p in list_projects() for t in list_tasks(p["id"]) if t.get("result_asset_id") == asset_id), None)
    if not task:
        # Also allow task id for convenience.
        task = next((t for p in list_projects() for t in list_tasks(p["id"]) if t["id"] == asset_id), None)
    if not task:
        raise HTTPException(404, "任务或素材不存在")
    # Preserve result_asset_id until the generation worker starts so it can
    # replace the previous asset instead of creating a duplicate record.
    update_task(task["id"], status="pending", qc_json=None, error=None)
    start_generation(task["project_id"], only_task_id=task["id"])
    return {"ok": True, "taskId": task["id"]}


@app.post("/api/projects/{project_id}/export")
def export(project_id: str):
    try:
        path = export_project(project_id)
        return {"ok": True, "download": f"/api/projects/{project_id}/export/download"}
    except Exception as e:
        raise HTTPException(400, str(e))


@app.get("/api/projects/{project_id}/export/download")
def download_export(project_id: str):
    p = get_project(project_id)
    if not p:
        raise HTTPException(404, "项目不存在")
    # Export is deterministic and local; rebuilding here also guarantees the
    # sanitized filename path is used for every download.
    path = export_project(project_id)
    return FileResponse(path, filename=path.name, media_type="application/zip")


@app.get("/{full_path:path}")
def spa(full_path: str):
    # API and file paths are matched above; all UI routes return the SPA shell.
    return FileResponse(STATIC_DIR / "index.html")
