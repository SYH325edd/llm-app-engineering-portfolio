from __future__ import annotations

import json
import re
import shutil
import zipfile
from pathlib import Path

from .db import get_project, list_assets, list_tasks
from .services import evaluate_delivery, project_dir


def _safe_copy(src: Path, dst: Path):
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def safe_export_name(value: str) -> str:
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", (value or "").strip())
    name = re.sub(r"\s+", " ", name).strip(" .")
    return (name[:80].strip(" .") or "product") + "-PDD-package.zip"


def _write_json(path: Path, value: object):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), "utf-8")


def export_project(project_id: str) -> Path:
    project = get_project(project_id)
    if not project:
        raise ValueError("Project not found")
    gate = evaluate_delivery(project_id)
    if gate.get("status") != "ready":
        details = gate.get("blockers") or gate.get("warnings") or []
        raise ValueError(f"Delivery Gate={gate.get('status')}，正式素材包仅允许 READY 项目导出：{json.dumps(details, ensure_ascii=False)}")

    assets = list_assets(project_id)
    tasks = list_tasks(project_id)
    pdir = project_dir(project_id)
    export_dir = pdir / "export"
    if export_dir.exists():
        shutil.rmtree(export_dir)
    export_dir.mkdir(parents=True, exist_ok=True)

    counters = {"main_image": 0, "asset_image": 0, "detail_section": 0, "video": 0}
    manifest_assets: list[dict] = []
    task_by_asset_id = {str(t.get("label") or "").split(" · ", 1)[0]: t for t in tasks}

    for a in assets:
        local = a.get("local_path")
        if not local or not Path(local).exists():
            continue
        kind = a["kind"]
        src = Path(local)
        ext = src.suffix.lower() or ".bin"
        dest: Path | None = None
        if kind == "main_image":
            counters[kind] += 1
            dest = export_dir / "main" / f"main-{counters[kind]:02d}{ext}"
        elif kind == "asset_image":
            counters[kind] += 1
            dest = export_dir / "assets" / f"asset-{counters[kind]:02d}{ext}"
        elif kind == "detail_section":
            idx = a.get("metadata", {}).get("sectionIndex") or (counters[kind] + 1)
            counters[kind] += 1
            dest = export_dir / "detail" / "sections" / f"section-{int(idx):02d}{ext}"
        elif kind == "detail_full":
            dest = export_dir / "detail" / f"detail-full{ext}"
        elif kind == "video":
            counters[kind] += 1
            dest = export_dir / "video" / f"product-ad{ext}"
        if dest is None:
            continue
        _safe_copy(src, dest)
        task = next((t for t in tasks if t.get("result_asset_id") == a.get("id")), None)
        manifest_assets.append({
            "assetId": a.get("id"),
            "kind": kind,
            "label": a.get("label"),
            "file": str(dest.relative_to(export_dir)).replace("\\", "/"),
            "qcStatus": ((task or {}).get("qc") or {}).get("status") if task else None,
            "taskStatus": (task or {}).get("status") if task else None,
            "metadata": a.get("metadata") or {},
        })

    prompt_bundle = project.get("prompt_bundle") or {}
    profile = project.get("product_profile") or {}
    report = {
        "project": {"id": project["id"], "name": project["name"], "mode": project["mode"], "status": project["status"]},
        "deliveryGate": gate,
        "qc": [
            {"taskId": t["id"], "label": t["label"], "status": t["status"], "qc": t.get("qc"), "error": t.get("error")}
            for t in tasks
        ],
    }

    _write_json(export_dir / "product-profile.json", profile)
    _write_json(export_dir / "identity-lock.json", profile.get("identityLock") or {})
    _write_json(export_dir / "style-lock.json", prompt_bundle.get("campaignStyleLock") or {})
    _write_json(export_dir / "master-scene-lock.json", prompt_bundle.get("masterSceneLock") or {})
    _write_json(export_dir / "asset-manifest.json", {"schemaVersion": "asset-manifest.v1", "deliveryGate": gate, "assets": manifest_assets})
    _write_json(export_dir / "prompt-manifest.json", {
        "version": prompt_bundle.get("version"),
        "contentHash": prompt_bundle.get("contentHash"),
        "approvedContentHash": prompt_bundle.get("approvedContentHash"),
        "items": [
            {
                "assetId": x.get("assetId"), "type": x.get("type"), "title": x.get("title"),
                "positivePrompt": x.get("positivePrompt"), "negativePrompt": x.get("negativePrompt"),
                "references": x.get("referenceAssignments") or [], "generationParams": x.get("generationParams") or {},
                "scaffold": (x.get("promptPackage") or {}).get("scaffold"),
                "scenePolicy": (x.get("promptPackage") or {}).get("scenePolicy"),
            }
            for x in prompt_bundle.get("items") or []
        ],
    })
    _write_json(export_dir / "report" / "qc-report.json", report)

    handoff = [
        "AI Commerce Studio — PDD Material Package",
        f"项目：{project['name']}",
        f"交付状态：{str(gate.get('status')).upper()}",
        "",
        "此包用于人工上传拼多多，不包含自动登录、自动发布或店铺写入能力。",
        "正式中文、规格参数等程序化内容仅来自项目中已提供的数据；未提供的字段不会由 AI 补造。",
        "最终平台审核、尺寸和类目要求以当前拼多多商家后台及具体类目提示为准。",
        "",
        "目录：",
        "main/ 主图",
        "assets/ 商品素材图",
        "detail/ 详情切片与长图",
        "video/ 商品视频",
        "report/ QC 报告",
        "product-profile.json / identity-lock.json / style-lock.json / master-scene-lock.json / asset-manifest.json / prompt-manifest.json 为生产追溯文件。",
    ]
    (export_dir / "HANDOFF.txt").write_text("\n".join(handoff), "utf-8")
    # Backward-compatible readme for existing operators/tests.
    (export_dir / "README.txt").write_text(
        "AI Commerce Studio v1.6 导出包\nmain/ 主图\nassets/ 商品素材图\ndetail/ 完整详情图与切片\nvideo/ 广告视频\nreport/ QC与生成信息\n",
        "utf-8",
    )

    zip_path = pdir / safe_export_name(project["name"])
    if zip_path.exists():
        zip_path.unlink()
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in export_dir.rglob("*"):
            if f.is_file():
                zf.write(f, f.relative_to(export_dir))
    return zip_path
