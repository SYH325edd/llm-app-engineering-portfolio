import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

from app.config import PROJECTS_DIR, SETTINGS_PATH
from app.ark_client import ArkClient
from app.db import add_asset, create_project, delete_project, init_db, list_assets, list_tasks, update_project, update_task
from app.exporter import export_project
from app.security import load_provider_settings, save_provider_settings
from app.services import analyze_project, approve_project_prompts, compile_project_prompts, ensure_tasks, plan_project, run_generation, evaluate_delivery, evaluate_detail_composition, compose_detail, _reference_paths_for_item
from app.prompt_craft import build_master_scene_lock
from app.prompt_pipeline import compile_image_prompt_package, evaluate_prompt_readiness, normalize_evidence_bundle, normalize_product_profile, normalize_video_plan, normalize_visual_items, source_registry


class MvpAcceptanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()

    def test_01_api_key_is_encrypted_at_rest(self):
        old = SETTINGS_PATH.read_bytes() if SETTINGS_PATH.exists() else None
        try:
            secret = "ark-test-secret-123456789"
            save_provider_settings(
                "https://ark.cn-beijing.volces.com/api/v3",
                {"reasoning": "deepseek-v4-pro"},
                secret,
            )
            raw = SETTINGS_PATH.read_text("utf-8")
            self.assertNotIn(secret, raw)
            loaded = load_provider_settings(include_secret=True)
            self.assertEqual(loaded["api_key"], secret)
            self.assertTrue(loaded["has_api_key"])
        finally:
            if old is None:
                SETTINGS_PATH.unlink(missing_ok=True)
            else:
                SETTINGS_PATH.write_bytes(old)

    def test_02_demo_end_to_end_generates_delivery_assets(self):
        p = create_project({
            "name": "验收测试商品",
            "category": "测试类目",
            "selling_points": ["已确认卖点"],
            "product_params": {"型号": "TEST"},
            "mode": "demo",
        })
        try:
            src_dir = PROJECTS_DIR / p["id"] / "source"
            src_dir.mkdir(parents=True, exist_ok=True)
            src = src_dir / "source-01.jpg"
            im = Image.new("RGB", (640, 800), "white")
            d = ImageDraw.Draw(im)
            d.rounded_rectangle((180, 80, 460, 720), 50, fill=(225, 230, 244))
            im.save(src)
            add_asset(p["id"], "source", "source.jpg", str(src), mime="image/jpeg")

            analyze_project(p["id"])
            plan_project(p["id"])
            compile_project_prompts(p["id"])
            approve_project_prompts(p["id"])
            ensure_tasks(p["id"])
            run_generation(p["id"])

            tasks = list_tasks(p["id"])
            self.assertEqual(len(tasks), 14)
            self.assertTrue(all(t["status"] == "completed" for t in tasks))
            assets = list_assets(p["id"])
            counts = {k: sum(a["kind"] == k for a in assets) for k in {a["kind"] for a in assets}}
            self.assertEqual(counts.get("main_image"), 3)
            self.assertEqual(counts.get("asset_image"), 4)
            self.assertEqual(counts.get("detail_section"), 6)
            self.assertEqual(counts.get("detail_full"), 1)
            self.assertEqual(counts.get("video"), 1)
        finally:
            delete_project(p["id"])
            import shutil
            shutil.rmtree(PROJECTS_DIR / p["id"], ignore_errors=True)

    def test_03_export_contains_expected_package(self):
        p = create_project({"name": "导出测试", "mode": "demo"})
        try:
            # A minimal source is enough; full workflow is already tested above.
            src_dir = PROJECTS_DIR / p["id"] / "source"
            src_dir.mkdir(parents=True, exist_ok=True)
            src = src_dir / "source-01.jpg"
            Image.new("RGB", (400, 500), "white").save(src)
            add_asset(p["id"], "source", "source.jpg", str(src), mime="image/jpeg")
            analyze_project(p["id"]); plan_project(p["id"]); compile_project_prompts(p["id"]); approve_project_prompts(p["id"]); ensure_tasks(p["id"]); run_generation(p["id"])
            z = export_project(p["id"])
            self.assertTrue(z.exists())
            import zipfile
            with zipfile.ZipFile(z) as zf:
                names = set(zf.namelist())
            self.assertIn("detail/detail-full.jpg", names)
            self.assertIn("video/product-ad.mp4", names)
            self.assertIn("report/qc-report.json", names)
        finally:
            delete_project(p["id"])
            import shutil
            shutil.rmtree(PROJECTS_DIR / p["id"], ignore_errors=True)

    def test_04_regeneration_replaces_previous_asset(self):
        p = create_project({"name": "重生成测试", "mode": "demo"})
        try:
            src_dir = PROJECTS_DIR / p["id"] / "source"
            src_dir.mkdir(parents=True, exist_ok=True)
            src = src_dir / "source-01.jpg"
            Image.new("RGB", (400, 500), "white").save(src)
            add_asset(p["id"], "source", "source.jpg", str(src), mime="image/jpeg")
            analyze_project(p["id"]); plan_project(p["id"]); compile_project_prompts(p["id"]); approve_project_prompts(p["id"]); ensure_tasks(p["id"]); run_generation(p["id"])

            task = next(t for t in list_tasks(p["id"]) if t["asset_type"] == "main_image")
            run_generation(p["id"], only_task_id=task["id"])
            assets = list_assets(p["id"])
            self.assertEqual(sum(a["kind"] == "main_image" for a in assets), 3)
            self.assertEqual(sum(a["kind"] == "detail_full" for a in assets), 1)
        finally:
            delete_project(p["id"])
            import shutil
            shutil.rmtree(PROJECTS_DIR / p["id"], ignore_errors=True)

    def test_05_export_sanitizes_project_name(self):
        p = create_project({"name": "A/B ../ test", "mode": "demo"})
        try:
            src_dir = PROJECTS_DIR / p["id"] / "source"
            src_dir.mkdir(parents=True, exist_ok=True)
            src = src_dir / "source-01.jpg"
            Image.new("RGB", (400, 500), "white").save(src)
            add_asset(p["id"], "source", "source.jpg", str(src), mime="image/jpeg")
            analyze_project(p["id"]); plan_project(p["id"]); compile_project_prompts(p["id"]); approve_project_prompts(p["id"]); ensure_tasks(p["id"]); run_generation(p["id"])
            z = export_project(p["id"])
            self.assertTrue(z.exists())
            self.assertNotIn("/", z.name)
            self.assertNotIn("\\", z.name)
            self.assertEqual(z.parent, PROJECTS_DIR / p["id"])
        finally:
            delete_project(p["id"])
            import shutil
            shutil.rmtree(PROJECTS_DIR / p["id"], ignore_errors=True)

    def test_06_seedance_reference_image_role_is_explicit(self):
        client = ArkClient.__new__(ArkClient)
        client.models = {"video": "doubao-seedance-2-5-260628"}
        captured = {}

        def fake_post(path, payload, timeout=None):
            captured["path"] = path
            captured["payload"] = payload
            return {"id": "task-test"}

        client._post = fake_post
        result = client.video_create("商品缓慢旋转", "data:image/png;base64,AAAA", duration=10, ratio="9:16")
        self.assertEqual(result["id"], "task-test")
        image_item = next(item for item in captured["payload"]["content"] if item["type"] == "image_url")
        self.assertEqual(image_item["role"], "reference_image")

    def test_07_launcher_chooses_next_port_when_8000_is_busy(self):
        import socket
        import run_local
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            sock.bind(("127.0.0.1", 0))
            busy_port = sock.getsockname()[1]
            sock.listen(1)
            chosen = run_local.choose_port("127.0.0.1", busy_port, attempts=3)
            self.assertNotEqual(chosen, busy_port)
            self.assertGreater(chosen, busy_port)
        finally:
            sock.close()

    def test_08_windows_launchers_use_crlf_and_keep_error_pause(self):
        root = Path(__file__).resolve().parents[1]
        start = (root / "start.bat").read_bytes()
        self.assertGreater(start.count(b"\r\n"), 10)
        self.assertIn(b"pause\r\n", start)
        self.assertIn(b"Dependencies are ready", start)
        self.assertIn(b"startup.log", start)

    def test_09_demo_pipeline_compiles_14_reviewable_prompts(self):
        p = create_project({
            "name": "usmil电动牙刷",
            "category": "生活用品",
            "selling_points": ["机身轻巧"],
            "mode": "demo",
        })
        try:
            analyze_project(p["id"])
            planned = plan_project(p["id"])
            plan = planned["creative_plan"]
            self.assertEqual(len(plan["mainImages"]), 3)
            self.assertEqual(len(plan["assetImages"]), 4)
            self.assertEqual(len(plan["detailSections"]), 6)
            self.assertNotIn("prompt", plan["mainImages"][0])
            compiled = compile_project_prompts(p["id"])
            bundle = compiled["prompt_bundle"]
            self.assertEqual(bundle["version"], "prompt-pipeline.v2.4")
            self.assertEqual(len(bundle["items"]), 14)
            self.assertTrue(bundle["contentHash"])
            first = bundle["items"][0]
            self.assertTrue(first["positivePrompt"])
            self.assertIn("[ASSET ROLE]", first["positivePrompt"])
            self.assertIn("[CAMPAIGN STYLE LOCK]", first["positivePrompt"])
            self.assertIn("[REFERENCE ROLES]", first["positivePrompt"])
            self.assertIn("[MATERIAL RENDERING]", first["positivePrompt"])
            self.assertIn("[POST-RENDER POLICY]", first["positivePrompt"])
            self.assertFalse(first["promptPackage"]["requestedCapabilities"]["mask"])
            self.assertEqual(first["promptPackage"]["promptCompilerVersion"], "prompt-compiler.v2.4")
            self.assertTrue(first["negativePrompt"])
            self.assertTrue(first["finalPrompt"])
            self.assertTrue(first["promptPackage"]["provenance"]["contentHash"])
            self.assertIn("移动端电商", first["positivePrompt"])
            self.assertIn("商品真实性", first["positivePrompt"])
            self.assertIn("文字安全区", first["positivePrompt"])
            self.assertIn("错误文字", first["negativePrompt"])
            self.assertEqual(first["generationParams"]["aspectRatio"], "1:1")
            video = next(x for x in bundle["items"] if x["assetId"] == "video_01")
            self.assertTrue(video["visualSpec"].get("shots"))
            self.assertNotIn("fallback", video["finalPrompt"].lower())
        finally:
            delete_project(p["id"])

    def test_10_generation_is_blocked_until_prompt_approval(self):
        p = create_project({"name": "演示电动牙刷", "category": "生活用品", "mode": "demo"})
        try:
            analyze_project(p["id"])
            plan_project(p["id"])
            compiled = compile_project_prompts(p["id"])
            serialized = json.dumps(compiled["creative_plan"], ensure_ascii=False)
            self.assertNotIn("IPX", serialized)
            self.assertNotIn("mAh", serialized)
            with self.assertRaises(ValueError):
                ensure_tasks(p["id"])
            approved = approve_project_prompts(p["id"])
            self.assertEqual(approved["prompt_bundle"]["approvedContentHash"], approved["prompt_bundle"]["contentHash"])
            tasks = ensure_tasks(p["id"])
            self.assertEqual(len(tasks), 14)
        finally:
            delete_project(p["id"])


    def test_11_evidence_part_ids_are_stable_and_relations_are_remapped(self):
        registry = [{"imageId":"img_1","assetId":"a1","label":"source","mime":"image/jpeg"}]
        raw = {
            "assets":[{
                "imageId":"img_1",
                "productParts":[
                    {"partId":"body","partType":"body","boundingBox":{"xPct":20,"yPct":10,"widthPct":50,"heightPct":80},"confidence":"high"},
                    {"partId":"button","partType":"button","count":1,"boundingBox":{"xPct":40,"yPct":35,"widthPct":10,"heightPct":8},"confidence":"high"}
                ],
                "spatialRelations":[{"subjectPartId":"button","relation":"attached_to","objectPartId":"body","confidence":"high"}],
                "proportions":[{"subjectPartId":"button","relativeToPartId":"body","relation":"relative_size","ratioApprox":0.1,"confidence":"high"}],
                "colorRegions":[{"targetPartId":"body","color":"white","boundingBox":{"xPct":20,"yPct":10,"widthPct":50,"heightPct":80},"confidence":"high"}]
            }]
        }
        bundle = normalize_evidence_bundle(raw, registry)
        asset = bundle["assets"][0]
        ids = {p["partId"] for p in asset["productParts"]}
        self.assertEqual(ids, {"img_1_part_01","img_1_part_02"})
        self.assertEqual(asset["spatialRelations"][0]["subjectPartId"], "img_1_part_02")
        self.assertEqual(asset["spatialRelations"][0]["objectPartId"], "img_1_part_01")
        self.assertEqual(asset["proportions"][0]["subjectPartId"], "img_1_part_02")
        self.assertEqual(asset["colorRegions"][0]["targetPartId"], "img_1_part_01")

    def test_12_video_plan_without_real_front3s_hook_is_blocked(self):
        profile = {"identityLock":{"references":[],"features":[]}}
        brief = {"duration":10}
        raw = {
            "durationSec":10,
            "hook":{"shotId":"s2","type":"product_reveal","mustShowProduct":True},
            "shots":[
                {"shotId":"s1","startSec":0,"endSec":5,"referenceImages":[],"identityLocks":[],"product":{"occupancyPct":60}},
                {"shotId":"s2","startSec":5,"endSec":10,"referenceImages":[],"identityLocks":[],"product":{"occupancyPct":60}}
            ]
        }
        result = normalize_video_plan(raw, profile, brief)
        self.assertIn("blockedReason", result)
        self.assertIn("前3秒", result["blockedReason"])


    def test_13_reference_assignment_has_no_hidden_all_source_fallback(self):
        p = create_project({"name": "参考图严格分配", "mode": "demo"})
        try:
            src_dir = PROJECTS_DIR / p["id"] / "source"
            src_dir.mkdir(parents=True, exist_ok=True)
            for i in range(2):
                src = src_dir / f"source-{i+1:02d}.jpg"
                Image.new("RGB", (320, 320), "white").save(src)
                add_asset(p["id"], "source", src.name, str(src), mime="image/jpeg")
            self.assertEqual(_reference_paths_for_item(p["id"], {"referenceAssignments": []}), [])
            selected = _reference_paths_for_item(p["id"], {"referenceAssignments": [{"imageId": "img_2"}]})
            self.assertEqual(len(selected), 1)
            self.assertTrue(selected[0].name.endswith("source-02.jpg"))
        finally:
            delete_project(p["id"])
            import shutil
            shutil.rmtree(PROJECTS_DIR / p["id"], ignore_errors=True)

    def test_14_spec_renderer_uses_only_project_parameters_and_delivery_is_ready(self):
        p = create_project({"name": "参数闭环", "category": "生活用品", "product_params": {"型号": "A1", "容量": "500ml"}, "price": "99", "mode": "demo"})
        try:
            src_dir = PROJECTS_DIR / p["id"] / "source"
            src_dir.mkdir(parents=True, exist_ok=True)
            src = src_dir / "source-01.jpg"
            Image.new("RGB", (500, 700), "white").save(src)
            add_asset(p["id"], "source", "source.jpg", str(src), mime="image/jpeg")
            analyze_project(p["id"]); plan_project(p["id"]); compile_project_prompts(p["id"]); approve_project_prompts(p["id"]); ensure_tasks(p["id"]); run_generation(p["id"])
            detail6 = next(a for a in list_assets(p["id"], "detail_section") if a.get("metadata", {}).get("sectionIndex") == 6)
            meta = detail6["metadata"]["renderMeta"]
            self.assertTrue(meta["specMode"])
            self.assertEqual(meta["renderedParams"]["型号"], "A1")
            self.assertEqual(meta["renderedParams"]["容量"], "500ml")
            self.assertTrue(meta["priceRendered"])
            self.assertEqual(evaluate_delivery(p["id"])["status"], "ready")
            z = export_project(p["id"])
            import zipfile
            with zipfile.ZipFile(z) as zf:
                names = set(zf.namelist())
            for expected in {"product-profile.json", "identity-lock.json", "style-lock.json", "asset-manifest.json", "prompt-manifest.json", "HANDOFF.txt"}:
                self.assertIn(expected, names)
        finally:
            delete_project(p["id"])
            import shutil
            shutil.rmtree(PROJECTS_DIR / p["id"], ignore_errors=True)

    def test_15_delivery_gate_blocks_unresolved_qc_failure(self):
        from app.db import update_task
        p = create_project({"name": "交付门测试", "mode": "demo"})
        try:
            src_dir = PROJECTS_DIR / p["id"] / "source"
            src_dir.mkdir(parents=True, exist_ok=True)
            src = src_dir / "source-01.jpg"
            Image.new("RGB", (400, 500), "white").save(src)
            add_asset(p["id"], "source", "source.jpg", str(src), mime="image/jpeg")
            analyze_project(p["id"]); plan_project(p["id"]); compile_project_prompts(p["id"]); approve_project_prompts(p["id"]); ensure_tasks(p["id"]); run_generation(p["id"])
            task = list_tasks(p["id"])[0]
            update_task(task["id"], status="failed_qc", qc_json={"status":"FAIL","issues":[{"field":"logo","severity":"critical"}]})
            self.assertEqual(evaluate_delivery(p["id"])["status"], "blocked")
            with self.assertRaises(ValueError):
                export_project(p["id"])
        finally:
            delete_project(p["id"])
            import shutil
            shutil.rmtree(PROJECTS_DIR / p["id"], ignore_errors=True)

    def test_16_targeted_retry_executes_once_and_reuses_existing_prompt(self):
        from unittest.mock import patch
        from app.db import update_task
        p = create_project({"name": "定向重试", "mode": "demo"})
        try:
            src_dir = PROJECTS_DIR / p["id"] / "source"
            src_dir.mkdir(parents=True, exist_ok=True)
            src = src_dir / "source-01.jpg"
            Image.new("RGB", (400, 500), "white").save(src)
            add_asset(p["id"], "source", "source.jpg", str(src), mime="image/jpeg")
            analyze_project(p["id"]); plan_project(p["id"]); compile_project_prompts(p["id"]); approve_project_prompts(p["id"]); ensure_tasks(p["id"])
            task = next(t for t in list_tasks(p["id"]) if t["asset_type"] == "main_image")
            update_project(p["id"], mode="live")
            calls = []
            def fake_render(project, current_task, repair_instruction=None):
                calls.append(repair_instruction)
                out = PROJECTS_DIR / p["id"] / "generated" / f"retry-{len(calls)}.jpg"
                out.parent.mkdir(parents=True, exist_ok=True)
                Image.new("RGB", (800, 800), "white").save(out)
                asset = add_asset(p["id"], "main_image", current_task["label"], str(out), mime="image/jpeg")
                if len(calls) == 1:
                    qc = {"status":"FAIL","issues":[{"field":"logo","severity":"critical"}],"retryDecision":{"action":"targeted_retry","focusFields":["logo"],"maxRetries":1}}
                else:
                    qc = {"status":"PASS","issues":[],"retryDecision":{"action":"none","focusFields":[],"maxRetries":0}}
                return {"asset": asset, "qc": qc}
            with patch("app.services._render_live_task", side_effect=fake_render):
                run_generation(p["id"], only_task_id=task["id"])
            updated = next(t for t in list_tasks(p["id"]) if t["id"] == task["id"])
            self.assertEqual(len(calls), 2)
            self.assertIsNone(calls[0])
            self.assertIn("TARGETED REPAIR", calls[1])
            self.assertEqual(updated["status"], "completed")
            self.assertEqual(updated["qc"]["status"], "PASS")
            self.assertEqual(len(updated["qc"]["retryHistory"]), 2)
        finally:
            delete_project(p["id"])
            import shutil
            shutil.rmtree(PROJECTS_DIR / p["id"], ignore_errors=True)

    def test_17_source_roles_separate_product_truth_from_creative_reference(self):
        registry = [
            {"imageId":"img_1","assetId":"a1","label":"product","mime":"image/jpeg","sourceRole":"PRODUCT_TRUTH"},
            {"imageId":"img_2","assetId":"a2","label":"style","mime":"image/jpeg","sourceRole":"STYLE_REFERENCE"},
        ]
        raw = {"assets":[
            {"imageId":"img_1","productParts":[{"partId":"body","partType":"body","confidence":"high"}],
             "surfaceAppearance":[{"targetPartId":"body","appearanceClass":"matte_polymer","finish":"matte","reflectance":"low","transparency":"opaque","microDetail":"fine smooth grain","edgeCharacter":"soft_rounded","confidence":"high"}]},
            {"imageId":"img_2","productParts":[{"partId":"foreign","partType":"reference_product","confidence":"high"}],
             "creativeReferenceProfile":{"compositionPattern":"product left, copy right","productOccupancy":"60-65%","cameraPattern":"slight low 3/4","backgroundGeometry":"two broad geometric planes","lightDirection":"upper-left 45 degrees","lightQuality":"soft directional","colorRelationship":"neutral white with restrained blue accent","negativeSpacePattern":"clean right third","visualHierarchy":"product > surface > background","copyZonePattern":"right third"}}
        ]}
        evidence = normalize_evidence_bundle(raw, registry)
        self.assertEqual(evidence["schemaVersion"], "evidence.v2.1")
        self.assertEqual(evidence["assets"][0]["sourceRole"], "PRODUCT_TRUTH")
        self.assertEqual(evidence["assets"][0]["surfaceAppearance"][0]["appearanceClass"], "matte_polymer")
        self.assertEqual(evidence["assets"][1]["productParts"], [])
        self.assertTrue(evidence["assets"][1]["creativeReferenceProfile"])

        project = {"name":"真实商品","category":"数码","brand":"","price":"","selling_points":[],"product_params":{}}
        raw_profile = {
            "confirmedFacts":["真实商品有主体结构", "参考图商品是黑色"],
            "evidence":[
                {"localKey":"v1","fact":"真实商品有主体结构","sourceType":"visual","sourceImage":"img_1","confidence":"high","visualProvable":True},
                {"localKey":"v2","fact":"参考图商品是黑色","sourceType":"visual","sourceImage":"img_2","confidence":"high","visualProvable":True},
            ],
            "identityLock":{"features":[
                {"field":"silhouette","target":"body","value":"stable body","evidenceRefs":["v1"],"sourceImages":["img_1"],"severity":"critical"},
                {"field":"colorRegion","target":"foreign","value":"black","evidenceRefs":["v2"],"sourceImages":["img_2"],"severity":"critical"},
            ],"references":[]}
        }
        profile = normalize_product_profile(raw_profile, project, evidence)
        self.assertEqual(profile["confirmedFacts"], ["真实商品有主体结构"])
        self.assertEqual(len(profile["identityLock"]["features"]), 1)
        self.assertEqual(profile["identityLock"]["features"][0]["sourceImages"], ["img_1"])
        self.assertEqual(profile["surfaceAppearance"][0]["appearanceClass"], "matte_polymer")
        self.assertEqual(profile["creativeReferenceProfiles"][0]["imageId"], "img_2")
        briefs = [{"assetId":"main_01","type":"main_image","prohibitions":[],"qcFocus":[]}]
        directed = {"items":[{"assetId":"main_01","referenceAssignments":[{"imageId":"img_2","role":"master_structure","regionResponsibilities":[{"sourceRegion":"full_image","useFor":["product_identity"],"ignoreFor":[]}]}],"visualSpec":{}}]}
        normalized = normalize_visual_items(directed, briefs, profile)[0]["referenceAssignments"][0]
        self.assertEqual(normalized["sourceRole"], "STYLE_REFERENCE")
        self.assertNotIn("product_identity", normalized["regionResponsibilities"][0]["useFor"])
        self.assertIn("product_identity", normalized["regionResponsibilities"][0]["ignoreFor"])

    def test_18_prompt_v22_consumes_surface_and_creative_reference_profile(self):
        project = {"name":"耳机","category":"电子数码","creative_plan":{"strategy":{}}}
        profile = {
            "productName":"耳机","category":"电子数码",
            "evidence":[],
            "surfaceAppearance":[{"imageId":"img_1","sourceRole":"PRODUCT_TRUTH","targetPartId":"img_1_part_01","appearanceClass":"matte_polymer","finish":"matte","texture":"fine grain","reflectance":"low","transparency":"opaque","microDetail":"subtle fine surface grain","edgeCharacter":"soft_rounded","confidence":"high"}],
            "creativeReferenceProfiles":[{"imageId":"img_2","sourceRole":"STYLE_REFERENCE","profile":{"compositionPattern":"product left, clean copy zone right","productOccupancy":"60%","cameraPattern":"slight low 3/4","backgroundGeometry":"two broad planes","lightDirection":"upper-left 45 degrees","lightQuality":"soft directional","colorRelationship":"neutral white + restrained blue","negativeSpacePattern":"clean right third","visualHierarchy":"product > support plane > background","copyZonePattern":"right third"}}],
            "identityLock":{"features":[],"references":[
                {"imageId":"img_1","sourceRole":"PRODUCT_TRUTH","role":"detail_reference","priority":"primary","regionResponsibilities":[{"sourceRegion":"full_product","regionBox":None,"useFor":["product_identity"],"ignoreFor":["background"]}]},
                {"imageId":"img_2","sourceRole":"STYLE_REFERENCE","role":"style_reference","priority":"secondary","regionResponsibilities":[{"sourceRegion":"full_image","regionBox":None,"useFor":["style","lighting"],"ignoreFor":["product_identity","logo"]}]},
            ],"forbiddenGlobalChanges":[]}
        }
        brief = {"assetId":"main_01","type":"main_image","title":"搜索主图","goal":"点击识别","visualTask":"准确展示商品","evidenceUsage":[],"prohibitions":[],"qcFocus":[]}
        directed = {"referenceAssignments":profile["identityLock"]["references"],"visualSpec":{
            "camera":{"shot":"full_product","height":"eye_level","horizontalAngleDeg":15,"verticalAngleDeg":0,"focalLengthFeel":"product_85mm","perspective":"neutral"},
            "product":{"facing":"three_quarter_right","rotationAxis":"none","rotationDeg":0,"tiltDeg":0,"occupancyPct":65,"anchor":{"xPct":45,"yPct":52},"crop":"full","cropBoundary":{}},
            "composition":{"layout":"product left","negativeSpace":"right copy zone","visualHierarchy":["product","background"]},
            "depth":{"depthOfField":"medium","foreground":"none","backgroundDepth":"soft_depth"},
            "environment":{"background":"clean neutral studio","surface":"matte platform","sceneLogic":"product first"},
            "lighting":{"key":"soft upper-left key","fill":"gentle right fill","rim":"subtle","direction":"upper-left","temperature":"neutral","contrast":"medium","highlightControl":"controlled"},
            "human":{"allowed":False},"props":[],"safeAreas":[],"layers":{},"colorDirection":{"temperature":"neutral","contrast":"medium","saturation":"medium"},"output":{"aspectRatio":"1:1","recommendedSize":"2048x2048"}
        }}
        pkg = compile_image_prompt_package(project, profile, brief, directed, "hash")
        self.assertEqual(pkg["promptCompilerVersion"], "prompt-compiler.v2.4")
        self.assertIn("[CREATIVE REFERENCE PROFILE]", pkg["positivePrompt"])
        self.assertIn("matte_polymer", pkg["positivePrompt"])
        self.assertIn("fine grain", pkg["positivePrompt"])
        self.assertIn("product left, clean copy zone right", pkg["positivePrompt"])
        self.assertIn("SourceRole=STYLE_REFERENCE", pkg["positivePrompt"])

    def test_19_source_registry_reads_authoritative_role_from_asset_metadata(self):
        assets = [
            {"id":"a1","label":"商品","mime":"image/jpeg","metadata":{"sourceRole":"PRODUCT_DETAIL"}},
            {"id":"a2","label":"参考","mime":"image/jpeg","metadata":{"sourceRole":"LAYOUT_REFERENCE"}},
        ]
        reg = source_registry(assets)
        self.assertEqual(reg[0]["sourceRole"], "PRODUCT_DETAIL")
        self.assertEqual(reg[1]["sourceRole"], "LAYOUT_REFERENCE")


    def test_20_master_scene_lock_is_inherited_by_scene_assets(self):
        p = create_project({"name":"白色马克杯","category":"家居/水杯/马克杯","mode":"demo"})
        try:
            src_dir = PROJECTS_DIR / p["id"] / "source"
            src_dir.mkdir(parents=True, exist_ok=True)
            src = src_dir / "source-01.jpg"
            Image.new("RGB", (600, 700), "white").save(src)
            add_asset(p["id"], "source", "mug.jpg", str(src), mime="image/jpeg")
            analyze_project(p["id"]); plan_project(p["id"])
            compiled = compile_project_prompts(p["id"])
            bundle = compiled["prompt_bundle"]
            scene = bundle["masterSceneLock"]
            self.assertEqual(scene["schemaVersion"], "master-scene-lock.v1")
            items = {x["assetId"]: x for x in bundle["items"]}
            self.assertEqual(items["main_01"]["promptPackage"]["scenePolicy"], "catalog_exempt")
            self.assertEqual(items["main_02"]["promptPackage"]["scenePolicy"], "inherit_master_scene")
            main2 = items["main_02"]["visualSpec"]
            self.assertEqual(main2["environment"]["background"], scene["background"])
            self.assertEqual(main2["environment"]["surface"], scene["surface"])
            self.assertEqual(main2["lighting"]["direction"], scene["lighting"]["direction"])
            self.assertIn("[MASTER SCENE LOCK]", items["main_02"]["positivePrompt"])
            detail3 = items["detail_03"]["visualSpec"]
            self.assertEqual(detail3["masterSceneInheritance"]["policy"], "derived_from_master_scene")
            self.assertIn("由母场景裁切/虚化/低纹理化得到", detail3["environment"]["background"])
        finally:
            delete_project(p["id"])
            import shutil
            shutil.rmtree(PROJECTS_DIR / p["id"], ignore_errors=True)

    def test_21_detail_composer_requires_all_pass_sections_and_final_qc(self):
        p = create_project({"name":"详情拼接测试","category":"家居","mode":"demo"})
        try:
            src_dir = PROJECTS_DIR / p["id"] / "source"
            src_dir.mkdir(parents=True, exist_ok=True)
            src = src_dir / "source-01.jpg"
            Image.new("RGB", (500, 600), "white").save(src)
            add_asset(p["id"], "source", "source.jpg", str(src), mime="image/jpeg")
            analyze_project(p["id"]); plan_project(p["id"]); compile_project_prompts(p["id"]); approve_project_prompts(p["id"]); ensure_tasks(p["id"]); run_generation(p["id"])
            full = list_assets(p["id"], "detail_full")
            self.assertEqual(len(full), 1)
            self.assertEqual(full[0]["metadata"]["sections"], 6)
            self.assertEqual(full[0]["metadata"]["compositeQc"]["status"], "PASS")
            self.assertEqual(evaluate_detail_composition(p["id"])["status"], "ready")

            detail_task = next(t for t in list_tasks(p["id"]) if t["asset_type"] == "detail_section")
            update_task(detail_task["id"], status="needs_review", qc_json={"status":"WARNING"})
            self.assertIsNone(compose_detail(p["id"]))
            self.assertEqual(list_assets(p["id"], "detail_full"), [])
            gate = evaluate_detail_composition(p["id"])
            self.assertEqual(gate["status"], "blocked")
            self.assertTrue(gate["invalidQc"])
            delivery = evaluate_delivery(p["id"])
            self.assertEqual(delivery["status"], "blocked")
            self.assertTrue(any(x.get("reason") == "detail_composer_blocked" for x in delivery["blockers"]))
        finally:
            delete_project(p["id"])
            import shutil
            shutil.rmtree(PROJECTS_DIR / p["id"], ignore_errors=True)



    def test_22_live_prompt_readiness_blocks_generic_prompt_without_product_evidence(self):
        empty = {
            "confirmedFacts": [], "surfaceAppearance": [],
            "identityLock": {"features": [], "references": []},
        }
        readiness = evaluate_prompt_readiness(empty, "live")
        self.assertEqual(readiness["status"], "BLOCKED")
        self.assertTrue(readiness["blockers"])

        grounded = {
            "confirmedFacts": ["右侧有一个把手"],
            "surfaceAppearance": [{"appearanceClass":"ceramic"}],
            "identityLock": {
                "features": [{"featureId":"lf_1","field":"silhouette","value":"cylindrical mug"}],
                "references": [{"imageId":"img_1","sourceRole":"PRODUCT_TRUTH"}],
            },
        }
        readiness2 = evaluate_prompt_readiness(grounded, "live")
        self.assertEqual(readiness2["status"], "PASS")

    def test_23_visual_role_contract_prevents_detail_03_04_05_collapse(self):
        profile = {
            "identityLock": {"features": [], "references": [
                {"imageId":"img_1","sourceRole":"PRODUCT_TRUTH","role":"detail_reference","priority":"primary","regionResponsibilities":[{"sourceRegion":"full_product","regionBox":None,"useFor":["product_identity"],"ignoreFor":[]}]}
            ]}
        }
        briefs = [
            {"assetId":"detail_03","type":"detail_section","prohibitions":[],"qcFocus":[]},
            {"assetId":"detail_04","type":"detail_section","prohibitions":[],"qcFocus":[]},
            {"assetId":"detail_05","type":"detail_section","prohibitions":[],"qcFocus":[]},
        ]
        same_spec = {
            "camera":{"shot":"closeup","height":"eye_level","horizontalAngleDeg":0,"verticalAngleDeg":0,"focalLengthFeel":"macro","perspective":"neutral"},
            "product":{"facing":"front","occupancyPct":76,"anchor":{"xPct":50,"yPct":50},"crop":"intentional_detail"},
            "composition":{},"depth":{},"environment":{},"lighting":{},"human":{"allowed":False},"props":[],"safeAreas":[],"colorDirection":{},"output":{"aspectRatio":"3:4"}
        }
        raw = {"items":[{"assetId":b["assetId"],"referenceAssignments":[{"imageId":"img_1"}],"visualSpec":same_spec} for b in briefs]}
        out = normalize_visual_items(raw, briefs, profile)
        by = {x["assetId"]:x["visualSpec"] for x in out}
        sigs = []
        for aid in ["detail_03","detail_04","detail_05"]:
            cam=by[aid]["camera"]; prod=by[aid]["product"]
            sigs.append((cam.get("shot"),cam.get("focalLengthFeel"),prod.get("occupancyPct"),prod.get("crop")))
        self.assertEqual(len(set(sigs)), 3)
        self.assertEqual(by["detail_03"]["visualRoleContract"]["visualRole"], "detail_primary_proof")
        self.assertEqual(by["detail_04"]["visualRoleContract"]["visualRole"], "detail_decision_reason")
        self.assertEqual(by["detail_05"]["visualRoleContract"]["visualRole"], "detail_structure_verification")

    def test_24_master_scene_prefers_strategy_proposal_over_category_fallback(self):
        project = {"name":"白色马克杯","category":"家居/马克杯"}
        profile = {"creativeReferenceProfiles": []}
        strategy = {
            "purchaseContext":["工作日上午的居家书桌饮水"],
            "masterSceneProposal": {
                "sceneContext":"工作日上午的居家书桌饮水区",
                "background":"暖白书房墙面与固定木质书架",
                "surface":"浅色橡木书桌",
                "fixedElements":["远景一本合上的书"],
                "lightingIntent":{"direction":"左侧窗光","quality":"柔和自然窗光","temperature":"neutral_warm"},
                "colorFamily":["暖白","浅木色","商品真实白色"],
                "depthSystem":"真实书房轻纵深",
                "rationale":"购买语境是桌面饮水，不使用通用厨房模板"
            }
        }
        lock = build_master_scene_lock(project, profile, strategy)
        self.assertEqual(lock["source"], "strategy")
        self.assertEqual(lock["sceneContext"], "工作日上午的居家书桌饮水区")
        self.assertEqual(lock["surface"], "浅色橡木书桌")
        self.assertEqual(lock["lighting"]["direction"], "左侧窗光")
        self.assertNotIn("厨房", lock["sceneContext"])

    def test_25_compiled_prompt_contains_product_evidence_and_visual_role_contract(self):
        project = {"name":"白色马克杯","category":"家居","mode":"live","creative_plan":{"strategy":{}}}
        profile = {
            "productName":"白色马克杯","confirmedFacts":["右侧只有一个C形把手","杯身为纯白圆柱轮廓"],
            "surfaceAppearance":[{"imageId":"img_1","targetPartId":"body","appearanceClass":"ceramic","finish":"glossy","reflectance":"medium","transparency":"opaque","edgeCharacter":"soft_rounded"}],
            "evidence":[],
            "identityLock":{"features":[{"featureId":"lf_1","field":"silhouette","target":"body","value":"纯白圆柱杯身+右侧单把手","severity":"critical"}],"references":[{"imageId":"img_1","sourceRole":"PRODUCT_TRUTH","role":"master_structure","priority":"primary","regionResponsibilities":[{"sourceRegion":"full_product","regionBox":None,"useFor":["product_identity"],"ignoreFor":["background"]}]}],"forbiddenGlobalChanges":[]}
        }
        brief = {"assetId":"detail_05","type":"detail_section","title":"结构核对","goal":"购买前核对结构","visualTask":"核对完整商品结构","evidenceUsage":[],"prohibitions":[],"qcFocus":[]}
        directed = {"referenceAssignments":profile["identityLock"]["references"],"visualSpec":{"camera":{},"product":{},"composition":{},"depth":{},"environment":{},"lighting":{},"human":{"allowed":False},"props":[],"safeAreas":[],"colorDirection":{},"output":{"aspectRatio":"3:4"}}}
        pkg = compile_image_prompt_package(project, profile, brief, directed, "hash")
        self.assertIn("[PRODUCT EVIDENCE SUMMARY]", pkg["positivePrompt"])
        self.assertIn("右侧只有一个C形把手", pkg["positivePrompt"])
        self.assertIn("[VISUAL ROLE CONTRACT]", pkg["positivePrompt"])
        self.assertIn("detail_structure_verification", pkg["positivePrompt"])
        self.assertEqual(pkg["promptReadiness"]["status"], "PASS")



if __name__ == "__main__":
    unittest.main()
