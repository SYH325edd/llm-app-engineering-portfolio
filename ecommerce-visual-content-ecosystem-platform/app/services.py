from __future__ import annotations

import json
import shutil
import subprocess
import threading
import time
from pathlib import Path
from copy import deepcopy
from typing import Any

import httpx

from .ark_client import ArkClient, ArkError, file_to_data_url, parse_jsonish
from .config import PROJECTS_DIR
from .db import (
    add_asset,
    create_task,
    delete_asset,
    get_asset,
    get_project,
    list_assets,
    list_tasks,
    reset_tasks,
    update_project,
    update_task,
)
from .demo_renderer import create_demo_video, make_demo_card, render_detail_section, render_text_overlay, stitch_vertical
from .prompt_craft import apply_master_scene_to_visual_spec, apply_visual_role_contract, build_master_scene_lock, visual_role_contract
from .prompt_pipeline import (
    ASSET_IDS, PDD_PLATFORM_RULES,
    asset_brief_batch_prompt, canonical_hash, commerce_strategy_prompt, compile_prompt_bundle, evaluate_prompt_readiness,
    demo_evidence, normalize_asset_brief_items, normalize_evidence_bundle, normalize_product_profile,
    normalize_strategy, normalize_video_plan, normalize_visual_items, product_profile_prompt,
    source_registry, video_director_prompt, visual_director_batch_prompt, vision_evidence_prompt,
)


def project_dir(project_id: str) -> Path:
    p = PROJECTS_DIR / project_id
    p.mkdir(parents=True, exist_ok=True)
    return p


def source_paths(project_id: str) -> list[Path]:
    out = []
    for a in list_assets(project_id, "source"):
        if a.get("local_path"):
            p = Path(a["local_path"])
            if p.exists():
                out.append(p)
    return out


def _clean_json_text(s: str) -> str:
    return s.strip().replace("\ufeff", "")


def default_profile(project: dict, evidence: dict | None = None) -> dict:
    evidence = evidence or {"schemaVersion":"evidence.v2.1","assets":[],"crossAsset":{},"unresolved":[]}
    refs = []
    for asset in evidence.get("assets", []):
        source_role = asset.get("sourceRole") or "PRODUCT_TRUTH"
        creative = source_role in {"STYLE_REFERENCE", "LAYOUT_REFERENCE", "SCENE_REFERENCE"}
        refs.append({
            "imageId": asset.get("imageId"),
            "sourceRole": source_role,
            "role": {"STYLE_REFERENCE":"style_reference","LAYOUT_REFERENCE":"layout_reference","SCENE_REFERENCE":"scene_reference"}.get(source_role, "detail_reference"),
            "priority": "supporting",
            "regionResponsibilities": [{
                "sourceRegion": "full_image" if creative else "full_product",
                "regionBox": None,
                "useFor": (["style_or_layout_preview_only"] if creative else ["demo_preview_only"]),
                "ignoreFor": (["product_identity", "product_structure", "logo", "parameters"] if creative else ["all_unverified_visual_details", "background", "text", "watermark"]),
            }],
        })
    user_claims = [str(x).strip() for x in (project.get("selling_points") or []) if str(x).strip()]
    evidence_items = []
    for i, claim in enumerate(user_claims, 1):
        evidence_items.append({"evidenceId":f"ev_user_{i:03d}","fact":claim,"sourceType":"user_provided","sourceImage":"","sourcePartIds":[],"visibleEvidence":"用户输入","confidence":"high","visualProvable":False})
    idx=len(evidence_items)
    for k,v in (project.get("product_params") or {}).items():
        idx += 1
        evidence_items.append({"evidenceId":f"ev_user_{idx:03d}","fact":f"{k}: {v}","sourceType":"user_provided","sourceImage":"","sourcePartIds":[],"visibleEvidence":"用户输入参数","confidence":"high","visualProvable":False})
    return {
        "schemaVersion":"product-profile.v2",
        "productName": project.get("name") or "",
        "category": project.get("category") or "待确认",
        "brand": project.get("brand") or "",
        "price": project.get("price") or "",
        "visualIdentity": {"summary":"Demo 模式不调用视觉模型，不能建立真实商品身份锁。","lockedFeatures":[],"forbiddenChanges":["不得把 Demo 未识别内容当作商品事实"]},
        "confirmedFacts": [],
        "userClaims": user_claims,
        "parameters": project.get("product_params") or {},
        "evidence": evidence_items,
        "surfaceAppearance": [],
        "creativeReferenceProfiles": [
            {"imageId": a.get("imageId"), "sourceRole": a.get("sourceRole"), "profile": a.get("creativeReferenceProfile")}
            for a in evidence.get("assets", []) if a.get("creativeReferenceProfile")
        ],
        "identityLock": {
            "schemaVersion":"identity-lock.v2",
            "features":[],
            "references":refs,
            "forbiddenGlobalChanges":["不得把 Demo 未识别内容当作商品事实","不得新增未确认包装、附件、配件或商品结构"],
            "unresolvedIdentityFields":["Demo 模式未执行真实视觉证据抽取"],
        },
        "referenceMap":[{"imageId":r["imageId"],"role":r["role"],"useFor":["demo_preview_only"],"ignoreFor":["all_unverified_visual_details","background","text","watermark"]} for r in refs],
        "unknownFacts":["商品结构、Logo、颜色分区、组件数量等待 Live 视觉模型确认"],
        "forbiddenClaims":["未由用户提供或视觉证据确认的参数、功效、认证、材质、包装和配件"],
        "source":"demo",
    }

def analyze_project(project_id: str) -> dict:
    project = get_project(project_id)
    if not project:
        raise ValueError("Project not found")
    update_project(project_id, status="planning", creative_plan=None, prompt_bundle=None, prompt_approved_at=None)
    source_assets = list_assets(project_id, "source")
    if project["mode"] == "demo":
        evidence = demo_evidence(source_assets)
        profile = default_profile(project, evidence)
        return update_project(project_id, evidence_bundle=evidence, product_profile=profile, status="planning")

    images = source_paths(project_id)
    if not images:
        raise ValueError("请先上传至少一张商品图")
    client = ArkClient()
    registry = source_registry(source_assets[:5])
    inputs = [file_to_data_url(p) for p in images[:5]]
    prompt = vision_evidence_prompt(registry)
    try:
        raw_evidence = parse_jsonish(client.vision(prompt, inputs)["text"])
    except Exception:
        raw_evidence = parse_jsonish(client.vision(prompt, inputs, model=client.models.get("vision_fallback"))["text"])
    evidence = normalize_evidence_bundle(raw_evidence, registry)

    raw_profile = parse_jsonish(client.text(
        product_profile_prompt(project, evidence),
        system="你是商品证据融合与身份锁定引擎。只做证据归因、冲突约束和结构化身份锁；看不见就不知道，禁止补全。",
    )["text"])
    profile = normalize_product_profile(raw_profile, project, evidence)
    profile["source"] = "live"
    return update_project(project_id, evidence_bundle=evidence, product_profile=profile, status="planning")

def _unique_nonempty(values: list[str]) -> list[str]:
    out: list[str] = []
    for value in values:
        value = str(value or "").strip()
        if value and value not in out:
            out.append(value)
    return out


def _creative_archetype(project: dict) -> dict:
    """Small deterministic category layer for Demo Safe Mode.

    It only uses the user supplied product name/category to choose a presentation
    grammar. It must never invent model numbers, efficacy, materials or numeric
    claims. Live mode still lets DeepSeek create the actual plan from ProductProfile.
    """
    text = f"{project.get('name','')} {project.get('category','')}".lower()
    if any(k in text for k in ["电动牙刷", "牙刷", "toothbrush", "口腔"]):
        return {
            "categoryLabel": "口腔护理",
            "audience": ["重视日常口腔护理的年轻用户", "希望商品信息直观、使用场景清晰的家庭用户"],
            "positioning": "用干净、轻科技、日常护理的视觉语言建立商品认知；先让用户看懂产品，再逐层解释已经确认的卖点与结构。",
            "conversionGoal": "搜索页先完成商品识别与点击吸引，详情页前 3 屏完成“是什么—怎么用—为什么值得继续看”的信息递进。",
            "scene": "明亮洗漱台、晨间或睡前口腔护理场景",
            "detailFocus": "刷头、机身、按键、握持区、底座/充电结构；仅使用素材中真实可见的部位",
            "mood": "明亮、清洁、轻科技、克制，不做医疗化视觉",
            "palette": "白色 / 浅灰为主，辅以商品自身颜色；不擅自修改商品配色",
        }
    if any(k in text for k in ["耳机", "手机", "键盘", "鼠标", "充电", "数码", "3c"]):
        return {
            "categoryLabel": "3C 数码",
            "audience": ["重视外观与使用效率的数码用户", "希望快速理解核心功能与接口信息的购买用户"],
            "positioning": "以产品结构、关键接口和真实使用场景为核心，降低无关装饰，让商品本身成为视觉中心。",
            "conversionGoal": "先建立产品识别，再通过结构细节与真实使用情境降低决策成本。",
            "scene": "桌面、通勤或日常数码使用场景",
            "detailFocus": "接口、按键、连接结构、材质转折与包装内容；只表达素材可验证部分",
            "mood": "简洁、理性、现代、轻科技",
            "palette": "中性背景 + 商品自身主色",
        }
    if any(k in text for k in ["面霜", "精华", "口红", "粉底", "护肤", "美妆", "香水"]):
        return {
            "categoryLabel": "美妆个护",
            "audience": ["关注产品质感与使用仪式感的年轻消费者", "需要快速辨认包装、质地与使用部位的购买用户"],
            "positioning": "用包装质感、使用动作与可验证卖点建立感知，不使用未经确认的功效承诺。",
            "conversionGoal": "先建立质感与品类认知，再通过细节和使用场景传达已确认信息。",
            "scene": "梳妆台、浴室或日常护理场景",
            "detailFocus": "包装、开合结构、泵头/瓶口、质地展示；功效文字必须来自用户确认信息",
            "mood": "干净、细腻、轻质感",
            "palette": "低饱和中性色 + 商品自身品牌色",
        }
    if any(k in text for k in ["零食", "饼干", "饮料", "咖啡", "茶", "食品", "坚果"]):
        return {
            "categoryLabel": "食品饮料",
            "audience": ["关注口味、规格与食用场景的日常消费用户", "需要快速判断包装与份量信息的购买用户"],
            "positioning": "优先展示真实包装、内容物与食用情境；口味、配料和营养信息只采用用户提供数据。",
            "conversionGoal": "快速建立食欲与品类认知，再用包装/规格/场景信息完成决策支持。",
            "scene": "餐桌、办公桌、休闲分享场景",
            "detailFocus": "包装正反面、开袋/开瓶状态、内容物与份量；不创造配料和营养参数",
            "mood": "真实、鲜活、干净、有食欲",
            "palette": "以包装自身颜色为核心",
        }
    return {
        "categoryLabel": project.get("category") or "商品",
        "audience": ["有明确该类商品需求的拼多多用户", "希望快速看懂商品外观、用途与真实卖点的购买用户"],
        "positioning": "以商品真实性和信息效率为核心，先建立商品识别，再通过场景、细节和已确认卖点降低决策成本。",
        "conversionGoal": "搜索素材负责吸引点击，详情页负责逐层回答“是什么、怎么用、有什么已确认价值、规格是什么”。",
        "scene": f"{project.get('category') or '该类商品'}的真实日常使用环境",
        "detailFocus": "商品关键结构、材质转折、接口/部件与包装信息；仅使用素材中真实可见内容",
        "mood": "清晰、真实、现代、商业摄影感",
        "palette": "中性背景 + 商品自身主色，不擅自修改商品颜色",
    }



def _brief(asset_id: str, typ: str, title: str, purpose: str, goal: str, key: str,
           evidence_refs: list[str], reference_plan: list[str], visual_intent: str,
           safe_area: str, negative: list[str], qc_focus: list[str], mode: str = "normal",
           *, conversion_stage: str = "understanding", priority: str = "supporting",
           business_priority: str = "supporting", proof_intent: str | None = None, delivery_required: bool = True) -> dict:
    usage = [{"evidenceId": eid, "purpose": "copy_support"} for eid in evidence_refs]
    role = visual_role_contract(asset_id)
    return {
        "assetId": asset_id, "type": typ, "title": title, "purpose": purpose, "goal": goal,
        "visualRole": role.get("visualRole") or "", "detailRole": role.get("detailRole") or "", "roleIntent": role.get("purpose") or "", "scenePolicy": role.get("scenePolicy") or "",
        "priority": priority, "businessPriority": business_priority, "conversionStage": conversion_stage, "deliveryRequired": delivery_required,
        "proofIntent": proof_intent, "visualTask": visual_intent, "keyMessage": key,
        "evidenceUsage": usage, "requestedReferences": [{"purpose": x, "preferredRole": "supporting"} for x in reference_plan],
        "safeAreaRequirement": {"required": safe_area != "none", "purpose": "title" if safe_area != "none" else "none"},
        "platformCompliance": {"formalTextByProgram": True, "forbidUnverifiedPriceOrPromo": True, "forbidUnverifiedPackaging": True, "mobileFirst": True},
        "prohibitions": negative, "qcFocus": qc_focus, "executionMode": mode,
        "fallbackRule": {"when": ["insufficient_evidence"], "action": "neutral_fallback" if mode == "neutral_fallback" else "human_review"},
        "evidenceRefs": evidence_refs, "referencePlan": reference_plan, "visualIntent": visual_intent,
        "safeAreaIntent": safe_area, "negative": negative,
    }

def demo_asset_brief_plan(project: dict) -> dict:
    profile = project.get("product_profile") or {}
    claims = [x for x in (profile.get("userClaims") or []) if x]
    claim_ids = [x.get("evidenceId") for x in profile.get("evidence") or [] if x.get("sourceType")=="user_provided" and x.get("evidenceId")]
    key = claims[0] if claims else "商品品类与真实外观"
    ref_note = ["Demo 未执行视觉识别；仅登记素材，Live 后由 ReferenceAssignmentV2 重新分配"]
    neg = ["不生成未经确认的参数/功效/认证","不生成正式中文文字","不新增未确认包装或配件"]
    main=[
        _brief("main_01","main_image","货架识别主图","点击/识别","移动端缩略图下先看清商品，不靠夸张特效吸引点击",key,claim_ids[:1],ref_note,"完整商品、单一主体、强识别、低干扰背景","右侧标题区",neg,["商品主体占比","无文字幻觉"],conversion_stage="click",priority="primary",business_priority="revenue_critical"),
        _brief("main_02","main_image","使用关系主图","理解/代入","用一个真实使用关系降低理解成本","真实使用关系",[],ref_note,"只安排一个使用动作；Demo 不推断具体用法","上方标题区",neg,["商品完整","使用关系不造假"],"neutral_fallback",conversion_stage="understanding",priority="secondary",business_priority="conversion_critical"),
        _brief("main_03","main_image","单一证据主图","信任","只用可见结构做一个证据点；Demo 无视觉证据时降级","中性结构证据",[],ref_note,"只聚焦一个结构，不做多部位拼盘","上方标题区",neg,["不得伪造卖点","不得新增零件"],"neutral_fallback",conversion_stage="trust",priority="secondary",business_priority="conversion_critical"),
    ]
    materials=[
        _brief("asset_01","asset_image","标准商品基准图","资产基准","建立后续可复用的完整商品基准","真实外观",[],ref_note,"完整商品、低视觉自由度、中性背景","none",neg,["轮廓","比例"],conversion_stage="recognition"),
        _brief("asset_02","asset_image","单一结构细节","结构核对","只展示一个真实结构","单一结构",[],ref_note,"单一结构微距，其他区域降权","右侧标签区",neg,["结构真实性"],"neutral_fallback",conversion_stage="trust"),
        _brief("asset_03","asset_image","单一使用动作","使用教育","只用一个动作说明使用关系","使用关系",[],ref_note,"只出现必要手部/环境，Demo 不推断动作细节","左上说明区",neg,["动作合理","商品一致"],"neutral_fallback",conversion_stage="understanding"),
        _brief("asset_04","asset_image","信息承载底图","信息承载","为程序排版提供干净视觉底图",key,claim_ids[:1],ref_note,"商品置于一侧，另一侧严格留白","大面积信息区",neg,["安全区干净"],conversion_stage="decision"),
    ]
    details=[]
    detail_defs=[
        ("detail_01","首屏：快速定位","回答这是什么，建立继续浏览理由",key,"click"),
        ("detail_02","使用语境","把商品放回真实使用流程","真实使用语境","understanding"),
        ("detail_03","第一证据","用一个真实可见结构降低疑虑","中性结构证据","trust"),
        ("detail_04","第二决策理由","有证据则补第二理由，无证据就中性降级","另一项可验证结构/价值","decision"),
        ("detail_05","结构核对","购买前核对关键结构和组成","真实结构","trust"),
        ("detail_06","规格与收束","把用户已提供规格交给程序排版并完成收束","用户提供参数","closing"),
    ]
    for aid,title,goal_msg,key_msg,stage in detail_defs:
        details.append(_brief(aid,"detail_section",title,"详情页",goal_msg,key_msg,claim_ids[:1] if aid in {"detail_01","detail_06"} else [],ref_note,"纵向移动端详情视觉；商品真实、信息层级明确","顶部/侧边程序文字区",neg,["商品身份","安全区","无文字幻觉"],"neutral_fallback" if aid in {"detail_02","detail_03","detail_04","detail_05"} else "normal",conversion_stage=stage,business_priority="conversion_critical"))
    video=_brief("video_01","video","10秒商品短视频","停留/记忆","10秒内完成识别—使用关系—证据—收束",key,claim_ids[:1],ref_note,"由 VideoPlanV2 输出 shots[]，不允许自由 motion 文案","结尾 CTA 区",neg,["跨镜商品一致性","前3秒商品可见"],"neutral_fallback",conversion_stage="decision",business_priority="conversion_critical")
    video.update({"duration":10,"ratio":"9:16"})
    archetype = _creative_archetype(project)
    strategy={
        "schemaVersion":"commerce-strategy.v2","audience":["当前 Demo 未做外部用户研究，目标受众待 Live 策略模型结合类目补充"],"purchaseContext":[archetype.get("scene") or ""],
        "masterSceneProposal": {
            "sceneContext": archetype.get("scene") or "",
            "background": "与该使用场景一致的单一真实环境，保持整套固定",
            "surface": "与商品用途一致的简洁真实承托面",
            "fixedElements": ["一处低存在感环境元素"],
            "lightingIntent": {"direction":"左前上方约45°","quality":"方向明确的柔和自然/商业混合光","temperature":"neutral_warm"},
            "colorFamily": [archetype.get("palette") or "中性背景 + 商品真实颜色"],
            "depthSystem":"真实轻纵深，背景可虚化但不得换场地",
            "rationale":"Demo 仅依据用户输入类目生成场景预览；Live 必须由商品证据与策略模型重新生成"
        },
        "clickDrivers":[{"id":"cd_01","statement":"快速看清商品与品类","evidenceRefs":[],"confidence":"medium"}],
        "trustDrivers":[{"id":"td_01","statement":"商品结构真实、信息不夸大","evidenceRefs":[],"confidence":"medium"}],
        "purchaseDrivers":[{"id":"pd_01","statement":"真实规格和证据降低决策成本","evidenceRefs":claim_ids,"confidence":"medium"}],
        "objections":[],"evidenceAvailable":claims,"evidenceMissing":["Demo 未执行真实视觉证据抽取"],
        "visualPositioning":{"tone":["清晰","真实","移动端优先"],"avoid":["过度风格化","虚构功效","信息堆叠"]},
        "contentArchitecture":{"mainImages":["点击识别","使用理解","单一证据"],"materials":["基准","细节","使用","信息承载"],"detailFlow":["认知","语境","证据","第二理由","结构","收束"],"videoObjective":"前3秒建立商品识别，之后用真实关系和证据收束"},
        "kpiTargets":[{"assetScope":"main","metric":"information_clarity","direction":"increase","rationale":"Demo 不虚构 CTR 数值，只优化移动端识别"}],
        "guardrails":["Demo 不把未识别视觉内容当事实","正式文字由程序渲染","没有包装/附件/参数证据就禁止生成"],
        "targetAudience":["待 Live 结合商品证据确认"],"positioning":"真实商品证据驱动点击、信任与决策","conversionGoal":"覆盖 click / trust / decision 三阶段，移动端优先",
        "visualDirection":{"mood":"清晰、真实、克制","scene":"由 Live 证据决定","palette":"忠于商品自身颜色","compositionPrinciple":"一张图一个转化任务；商品真实性优先"},
        "missingInputs":["Demo 未执行真实视觉证据抽取"],
    }
    return {"schemaVersion":"commerce-plan.v2","source":"demo_prompt_pipeline_v2","strategy":strategy,"mainImages":main,"assetImages":materials,"detailSections":details,"video":video,"platformRuleProfile":PDD_PLATFORM_RULES}

def _validate_plan_contract(plan: dict, profile: dict):
    expected={"mainImages":ASSET_IDS["main"],"assetImages":ASSET_IDS["material"],"detailSections":ASSET_IDS["detail"]}
    evidence={x.get("evidenceId"):x for x in (profile.get("evidence") or []) if x.get("evidenceId")}
    for group, ids in expected.items():
        items=plan.get(group) or []
        if [x.get("assetId") for x in items] != ids:
            raise ValueError(f"CreativePlan {group} assetId 必须严格为 {ids}")
        for item in items:
            if item.get("executionMode") not in {"normal","neutral_fallback","blocked"}: raise ValueError(f"{item.get('assetId')} executionMode 非法")
            for usage in item.get("evidenceUsage") or []:
                eid=usage.get("evidenceId"); ev=evidence.get(eid)
                if not ev: raise ValueError(f"{item.get('assetId')} 引用了不存在 evidenceId: {eid}")
                if usage.get("purpose")=="visual_proof" and ev.get("visualProvable") is not True: raise ValueError(f"{item.get('assetId')} 把不可视觉证明证据 {eid} 用作 visual_proof")
    video=plan.get("video") or {}
    if video.get("assetId")!="video_01" or video.get("type")!="video": raise ValueError("CreativePlan video 契约错误")
    for usage in video.get("evidenceUsage") or []:
        eid=usage.get("evidenceId"); ev=evidence.get(eid)
        if not ev: raise ValueError(f"video_01 引用了不存在 evidenceId: {eid}")
        if usage.get("purpose")=="visual_proof" and ev.get("visualProvable") is not True: raise ValueError(f"video_01 把不可视觉证明证据 {eid} 用作 visual_proof")

def _validate_director_contract(directed: dict, plan: dict, profile: dict):
    expected=[x["assetId"] for x in (plan.get("mainImages") or [])+(plan.get("assetImages") or [])+(plan.get("detailSections") or [])+[plan.get("video")] if x]
    items=directed.get("items") or []; got=[x.get("assetId") for x in items]
    if len(items)!=len(expected) or set(got)!=set(expected) or len(got)!=len(set(got)):
        raise ValueError("Visual Director 必须返回 14 个唯一 assetId")
    valid_refs={x.get("imageId") for x in (profile.get("identityLock") or {}).get("references") or [] if x.get("imageId")}
    for item in items:
        if item.get("assetId")=="video_01":
            vp=item.get("videoPlan") or {}; shots=vp.get("shots") or []
            if not shots: raise ValueError("VideoPlanV2.shots 为空，禁止 fallback motion")
            if vp.get("blockedReason"): raise ValueError(vp.get("blockedReason"))
            for shot in shots:
                for rid in shot.get("referenceImages") or []:
                    if rid not in valid_refs: raise ValueError(f"video_01 引用了不存在参考图 {rid}")
            continue
        for ref in item.get("referenceAssignments") or []:
            if ref.get("imageId") not in valid_refs: raise ValueError(f"{item.get('assetId')} 引用了不存在参考图 {ref.get('imageId')}")
        spec=item.get("visualSpec") or {}; product=spec.get("product") or {}
        occ=product.get("occupancyPct")
        if occ is None or not (20 <= float(occ) <= 90): raise ValueError(f"{item.get('assetId')} product.occupancyPct 非法")
        for area in spec.get("safeAreas") or []:
            vals=[area.get(k) for k in ["xPct","yPct","widthPct","heightPct"]]
            if any(v is None for v in vals): raise ValueError(f"{item.get('assetId')} safeArea 坐标缺失")
            if float(area["xPct"])+float(area["widthPct"])>100.01 or float(area["yPct"])+float(area["heightPct"])>100.01: raise ValueError(f"{item.get('assetId')} safeArea 越界")

    # Hard anti-homogeneity contract for the pairs/sections that previously collapsed.
    by_id={x.get("assetId"):x for x in items if x.get("assetId")}
    def sig(aid: str):
        spec=(by_id.get(aid) or {}).get("visualSpec") or {}
        cam=spec.get("camera") or {}; prod=spec.get("product") or {}
        return (cam.get("shot"),cam.get("height"),cam.get("focalLengthFeel"),round(float(prod.get("occupancyPct") or 0),1),prod.get("crop"),prod.get("facing"))
    for a,b in [("main_02","asset_03"),("detail_03","detail_04"),("detail_04","detail_05"),("detail_03","detail_05")]:
        if a in by_id and b in by_id and sig(a)==sig(b):
            raise ValueError(f"Visual Director 同质化：{a} 与 {b} 的镜头签名完全相同 {sig(a)}")

def plan_project(project_id: str) -> dict:
    project=get_project(project_id)
    if not project: raise ValueError("Project not found")
    if not project.get("product_profile"):
        analyze_project(project_id); project=get_project(project_id)
    reset_tasks(project_id); update_project(project_id,prompt_bundle=None,prompt_approved_at=None)
    if project["mode"]=="demo":
        plan=demo_asset_brief_plan(project)
        _validate_plan_contract(plan, project["product_profile"])
        from .prompt_pipeline import validate_commerce_plan
        plan["commerceValidation"] = validate_commerce_plan(plan, project["product_profile"])
        return update_project(project_id,creative_plan=plan,status="planning")

    profile=project["product_profile"]
    readiness = evaluate_prompt_readiness(profile, "live")
    if readiness.get("status") == "BLOCKED":
        raise ValueError("PromptReadiness 未通过，禁止继续生产规划：" + "；".join(readiness.get("blockers") or []))
    client=ArkClient()
    raw_strategy=parse_jsonish(client.text(
        commerce_strategy_prompt(profile,PDD_PLATFORM_RULES),
        system="你是电商转化策略引擎。只做证据驱动的点击/信任/决策策略，不设计具体镜头，不虚构商业数据。",
    )["text"])
    strategy=normalize_strategy(raw_strategy,project)
    batches={}
    for batch,key in [("main","mainImages"),("material","assetImages"),("detail","detailSections"),("video","video")]:
        raw=parse_jsonish(client.text(
            asset_brief_batch_prompt(profile,strategy,batch,ASSET_IDS[batch],PDD_PLATFORM_RULES),
            system="你是电商 AssetBrief 规划器。每个资产只有一个主要转化任务；证据不足就降级或阻塞，不写镜头参数，不编商品事实。",
        )["text"])
        items=normalize_asset_brief_items(raw,batch,ASSET_IDS[batch],profile)
        batches[key]=items[0] if batch=="video" else items
    plan={"schemaVersion":"commerce-plan.v2","source":"live_prompt_pipeline_v2","strategy":strategy,"mainImages":batches["mainImages"],"assetImages":batches["assetImages"],"detailSections":batches["detailSections"],"video":batches["video"],"platformRuleProfile":PDD_PLATFORM_RULES}
    _validate_plan_contract(plan,profile)
    from .prompt_pipeline import validate_commerce_plan
    validation=validate_commerce_plan(plan,profile); plan["commerceValidation"]=validation
    if validation.get("status")=="FAIL":
        raise ValueError("CommerceValidation 未通过："+json.dumps(validation.get("issues") or [],ensure_ascii=False))
    return update_project(project_id,creative_plan=plan,status="planning")

def _demo_visual_director(project: dict) -> dict:
    plan=project["creative_plan"]
    identity=(project.get("product_profile") or {}).get("identityLock") or {}
    refs=identity.get("references") or []
    def assignments(limit=1):
        out=[]
        for r in refs[:limit]:
            out.append({"imageId":r.get("imageId"),"role":r.get("role") or "detail_reference","priority":"supporting","regionResponsibilities":[{"sourceRegion":"full_product","regionBox":None,"useFor":["demo_preview_only"],"ignoreFor":["all_unverified_visual_details","background","text","watermark"]}]})
        return out
    def base_spec(aspect="1:1"):
        return {
            "camera":{"shot":"full_product","height":"eye_level","horizontalAngleDeg":10,"verticalAngleDeg":0,"focalLengthFeel":"product_85mm","perspective":"neutral","perspectiveStrength":"none","distortionAllowed":False},
            "product":{"facing":"three_quarter_right","rotationAxis":"none","rotationDeg":0,"tiltDeg":0,"occupancyPct":64,"anchor":{"xPct":42,"yPct":52},"crop":"full","cropTargets":[],"cropBoundary":{"top":"keep","bottom":"keep","left":"keep","right":"keep"}},
            "composition":{"layout":"单一商品主体，移动端快速识别","negativeSpace":"右侧留白","visualHierarchy":["商品主体","必要环境"]},
            "depth":{"depthOfField":"medium","foreground":"none","backgroundDepth":"soft_depth"},
            "environment":{"background":"浅灰白低纹理背景","surface":"简洁中性承托面","sceneLogic":"环境只服务商品识别"},
            "lighting":{"key":"左前上方柔和大面积主光","fill":"右前轻补光","rim":"轻微轮廓光","direction":"前上方","temperature":"neutral","contrast":"medium","highlightControl":"保留真实材质层次，避免过曝和塑料感"},
            "human":{"allowed":False,"scope":"none","action":"","handPosition":"","gripPoint":""},
            "props":[],
            "safeAreas":[{"purpose":"title","xPct":70,"yPct":8,"widthPct":27,"heightPct":84,"cleanliness":"strict"}],
            "layers":{"background":"back","product":"front","props":[],"overlays":[],"safeAreaLayer":"above_all"},
            "colorDirection":{"temperature":"neutral","contrast":"medium","saturation":"medium","backgroundPalette":["white","light_gray"]},
            "output":{"aspectRatio":aspect,"recommendedSize":"2048x2048" if aspect=="1:1" else "1536x2048"},
        }
    items=[]
    briefs=(plan.get("mainImages") or [])+(plan.get("assetImages") or [])+(plan.get("detailSections") or [])
    for brief in briefs:
        spec=base_spec("3:4" if brief["type"]=="detail_section" else "1:1")
        aid=brief["assetId"]
        if aid in {"main_02","asset_03","detail_02"}:
            spec["camera"].update({"shot":"medium_closeup","horizontalAngleDeg":25,"focalLengthFeel":"normal_50mm"})
            spec["product"].update({"occupancyPct":44,"anchor":{"xPct":58,"yPct":55}})
            spec["environment"].update({"background":"真实但克制的日常使用环境","surface":"与商品用途一致的真实承托环境","sceneLogic":"只呈现一个使用关系，环境轻虚化"})
            spec["human"]={"allowed":True,"scope":"hand_only","action":"只执行一个自然使用动作","handPosition":"画面中部靠商品一侧","gripPoint":"仅在不会遮挡关键结构的位置持握"}
            spec["safeAreas"]=[{"purpose":"title","xPct":4,"yPct":4,"widthPct":46,"heightPct":24,"cleanliness":"strict"}]
        if aid in {"main_03","asset_02","detail_03","detail_04","detail_05"}:
            spec["camera"].update({"shot":"closeup","horizontalAngleDeg":0,"focalLengthFeel":"macro","perspective":"neutral"})
            spec["product"].update({"occupancyPct":76,"crop":"intentional_detail","cropTargets":["single_verified_detail"]})
            spec["composition"].update({"layout":"只聚焦一个结构证据，禁止多部位拼盘","negativeSpace":"上方留白","visualHierarchy":["单一结构证据"]})
            spec["depth"].update({"depthOfField":"shallow"})
            spec["safeAreas"]=[{"purpose":"title","xPct":5,"yPct":4,"widthPct":90,"heightPct":19,"cleanliness":"strict"}]
        if aid=="asset_04":
            spec["product"].update({"occupancyPct":46,"anchor":{"xPct":30,"yPct":52}})
            spec["composition"].update({"layout":"商品左侧，右侧大留白作为信息承载底图","negativeSpace":"右侧严格干净","visualHierarchy":["商品","程序文字区"]})
            spec["safeAreas"]=[{"purpose":"spec","xPct":54,"yPct":10,"widthPct":42,"heightPct":80,"cleanliness":"strict"}]
        if aid=="detail_06":
            spec["product"].update({"occupancyPct":36,"anchor":{"xPct":27,"yPct":55}})
            spec["safeAreas"]=[{"purpose":"spec","xPct":49,"yPct":10,"widthPct":47,"heightPct":80,"cleanliness":"strict"}]
        spec = apply_visual_role_contract(brief, spec)
        master_scene = build_master_scene_lock(project, project.get("product_profile") or {}, plan.get("strategy") or {})
        spec = apply_master_scene_to_visual_spec(brief, spec, master_scene)
        items.append({"assetId":aid,"referenceAssignments":assignments(),"referenceMap":assignments(),"visualSpec":spec,"negative":brief.get("prohibitions") or [],"qcChecklist":brief.get("qcFocus") or []})
    # Video is a real structured preview, not motion free text.
    video_brief=plan["video"]
    video_plan={
        "assetId":"video_01","durationSec":10,"aspectRatio":"9:16",
        "hook":{"shotId":"s1","type":"product_reveal","mustShowProduct":True,"goal":"前2秒先建立商品识别，不用无关环境做钩子"},
        "pacingCurve":[{"shotId":"s1","intensity":"high"},{"shotId":"s2","intensity":"medium"},{"shotId":"s3","intensity":"medium"},{"shotId":"s4","intensity":"low"},{"shotId":"s5","intensity":"low"}],
        "shots":[
            {"shotId":"s1","startSec":0,"endSec":2,"purpose":"商品识别钩子","referenceImages":[r.get("imageId") for r in refs[:1] if r.get("imageId")],"subject":"full_product","camera":{"shot":"closeup","height":"eye_level","horizontalAngleDeg":10,"movement":"push_in","movementAmount":"micro","speed":"medium"},"product":{"facing":"three_quarter_right","occupancyPct":68,"allowedMotion":["micro_parallax"]},"action":"商品稳定展示","human":{"allowed":False,"scope":"none","action":"","handPosition":"","gripPoint":""},"identityLocks":[],"forbiddenChanges":["改变商品结构"],"transitionOut":"cut"},
            {"shotId":"s2","startSec":2,"endSec":4,"purpose":"完整外观建立","referenceImages":[r.get("imageId") for r in refs[:1] if r.get("imageId")],"subject":"full_product","camera":{"shot":"full_product","height":"eye_level","horizontalAngleDeg":0,"movement":"static","movementAmount":"micro","speed":"slow"},"product":{"facing":"front","occupancyPct":58,"allowedMotion":["none"]},"action":"完整商品稳定呈现","human":{"allowed":False,"scope":"none","action":"","handPosition":"","gripPoint":""},"identityLocks":[],"forbiddenChanges":["改变商品结构"],"transitionOut":"match_cut"},
            {"shotId":"s3","startSec":4,"endSec":6.5,"purpose":"单一使用关系","referenceImages":[r.get("imageId") for r in refs[:1] if r.get("imageId")],"subject":"hand_product","camera":{"shot":"medium_closeup","height":"eye_level","horizontalAngleDeg":20,"movement":"static","movementAmount":"micro","speed":"slow"},"product":{"facing":"three_quarter_right","occupancyPct":42,"allowedMotion":["natural_hand_motion"]},"action":"仅一个真实、克制的使用动作；Demo 不指定具体功效动作","human":{"allowed":True,"scope":"hand_only","action":"单手自然持握","handPosition":"商品握持区域","gripPoint":"不遮挡关键结构"},"identityLocks":[],"forbiddenChanges":["遮挡商品关键结构"],"transitionOut":"cut"},
            {"shotId":"s4","startSec":6.5,"endSec":8.5,"purpose":"单一结构证据","referenceImages":[r.get("imageId") for r in refs[:1] if r.get("imageId")],"subject":"detail","camera":{"shot":"macro","height":"eye_level","horizontalAngleDeg":0,"movement":"push_in","movementAmount":"micro","speed":"slow"},"product":{"facing":"front","occupancyPct":75,"allowedMotion":["none"]},"action":"只展示一个已验证结构；Demo 无视觉证据时作为中性结构预览","human":{"allowed":False,"scope":"none","action":"","handPosition":"","gripPoint":""},"identityLocks":[],"forbiddenChanges":["新增结构"],"transitionOut":"cut"},
            {"shotId":"s5","startSec":8.5,"endSec":10,"purpose":"商品收束","referenceImages":[r.get("imageId") for r in refs[:1] if r.get("imageId")],"subject":"full_product","camera":{"shot":"full_product","height":"eye_level","horizontalAngleDeg":0,"movement":"pull_out","movementAmount":"micro","speed":"slow"},"product":{"facing":"front","occupancyPct":55,"allowedMotion":["none"]},"action":"完整商品稳定收束，底部留后期 CTA 空间","human":{"allowed":False,"scope":"none","action":"","handPosition":"","gripPoint":""},"identityLocks":[],"forbiddenChanges":["改变商品身份"],"transitionOut":"fade"}
        ],
        "audioPlan":{"bgm":{"required":True,"style":"clean_modern_commercial","bpmRange":[90,110]},"voiceover":{"required":False,"script":None},"sfx":[]},
        "negative":video_brief.get("prohibitions") or [],"qcChecklist":video_brief.get("qcFocus") or [],
    }
    items.append({"assetId":"video_01","videoPlan":video_plan,"referenceAssignments":assignments(),"referenceMap":assignments(),"negative":video_brief.get("prohibitions") or [],"qcChecklist":video_brief.get("qcFocus") or []})
    return {"schemaVersion":"director-bundle.v2","items":items}

def compile_project_prompts(project_id: str) -> dict:
    project=get_project(project_id)
    if not project or not project.get("creative_plan") or not project.get("product_profile"):
        raise ValueError("请先完成 ProductProfileV2 与 Commerce Plan")
    plan=project["creative_plan"]; profile=project["product_profile"]; evidence=project.get("evidence_bundle") or {}
    readiness = evaluate_prompt_readiness(profile, project.get("mode") or "live")
    if project.get("mode") == "live" and readiness.get("status") == "BLOCKED":
        raise ValueError("PromptReadiness 未通过：" + "；".join(readiness.get("blockers") or []))
    master_scene = build_master_scene_lock(project, profile, plan.get("strategy") or {})
    _validate_plan_contract(plan,profile)
    if project["mode"]=="demo":
        directed=_demo_visual_director(project)
    else:
        client=ArkClient(); all_items=[]
        for batch,key in [("main","mainImages"),("material","assetImages"),("detail","detailSections")]:
            briefs=plan.get(key) or []
            raw=parse_jsonish(client.text(
                visual_director_batch_prompt(profile,evidence,plan.get("strategy") or {},briefs,batch,PDD_PLATFORM_RULES,master_scene),
                system="你是电商视觉执行导演。把业务简报变成可执行、移动端优先、商品保真优先的结构化镜头规格；不写最终 Prompt，不补商品事实。",
            )["text"])
            all_items.extend(normalize_visual_items(raw,briefs,profile,master_scene))
        raw_video=parse_jsonish(client.text(
            video_director_prompt(profile,evidence,plan.get("strategy") or {},plan.get("video") or {},PDD_PLATFORM_RULES),
            system="你是电商视频导演。输出真实可执行的 shots[] 时间轴；商品一致性高于炫技，禁止隐藏 fallback。",
        )["text"])
        video_plan=normalize_video_plan(raw_video,profile,plan.get("video") or {})
        if video_plan.get("blockedReason"): raise ValueError(video_plan["blockedReason"])
        all_items.append({"assetId":"video_01","videoPlan":video_plan,"referenceAssignments":[],"referenceMap":[],"negative":video_plan.get("negative") or [],"qcChecklist":video_plan.get("qcChecklist") or (plan.get("video") or {}).get("qcFocus") or []})
        directed={"schemaVersion":"director-bundle.v2","items":all_items}
    _validate_director_contract(directed,plan,profile)
    bundle=compile_prompt_bundle(project,profile,evidence,plan,directed,project["mode"])
    if (bundle.get("commerceValidation") or {}).get("status")=="FAIL":
        raise ValueError("CommerceValidation 未通过，禁止进入 PromptReviewGate")
    reset_tasks(project_id)
    return update_project(project_id,prompt_bundle=bundle,prompt_approved_at=None,status="planning")

def approve_project_prompts(project_id: str) -> dict:
    from .db import now_iso
    project=get_project(project_id)
    if not project or not project.get("prompt_bundle"): raise ValueError("请先编译并检查 Prompt")
    bundle=deepcopy(project["prompt_bundle"]); items=bundle.get("items") or []
    if len(items)!=14: raise ValueError("Prompt Bundle 不完整，必须包含 13 张图片 + 1 条视频")
    blocked=[x.get("assetId") for x in items if x.get("executionMode")=="blocked"]
    if blocked: raise ValueError(f"仍有被阻塞资产，不能批准生成：{blocked}")
    if (bundle.get("commerceValidation") or {}).get("status")=="FAIL": raise ValueError("CommerceValidation=FAIL，禁止批准")
    readiness = bundle.get("promptReadiness") or {}
    if project.get("mode") == "live" and readiness.get("status") == "BLOCKED":
        raise ValueError("PromptReadiness=BLOCKED，商品视觉证据不足，禁止批准生产 Prompt")
    content_hash=bundle.get("contentHash")
    if not content_hash: raise ValueError("Prompt Bundle 缺少 contentHash")
    bundle["approvedContentHash"]=content_hash
    return update_project(project_id,prompt_bundle=bundle,prompt_approved_at=now_iso())

def ensure_tasks(project_id: str) -> list[dict]:
    existing=list_tasks(project_id)
    if existing: return existing
    project=get_project(project_id)
    if not project or not project.get("creative_plan"): raise ValueError("请先生成 Commerce Plan")
    bundle=project.get("prompt_bundle")
    if not bundle: raise ValueError("请先编译 AssetBriefV2 → VisualSpecV2/VideoPlanV2 → PromptPackageV2")
    if not project.get("prompt_approved_at"): raise ValueError("请先人工检查并确认 Prompt，再允许调用生成模型")
    if bundle.get("approvedContentHash") != bundle.get("contentHash"): raise ValueError("Prompt 审批哈希已失效，请重新审查并批准")
    plan=project["creative_plan"]
    brief_by_id={x["assetId"]:x for x in (plan.get("mainImages") or [])+(plan.get("assetImages") or [])+(plan.get("detailSections") or [])+[plan.get("video")] if x}
    for item in bundle.get("items") or []:
        brief=brief_by_id.get(item.get("assetId"),{}); typ=item.get("type")
        if item.get("executionMode")=="blocked": continue
        create_task(project_id,typ,f"{item.get('assetId')} · {brief.get('title') or item.get('title') or item.get('assetId')}",brief.get("purpose") or "","video" if typ=="video" else "image",item.get("finalPrompt") or "")
    return list_tasks(project_id)

def _task_plan_item(project: dict, task: dict) -> dict:
    plan = project["creative_plan"]
    asset_id = str(task.get("label") or "").split(" · ", 1)[0]
    all_items = (plan.get("mainImages") or []) + (plan.get("assetImages") or []) + (plan.get("detailSections") or [])
    if plan.get("video"):
        all_items.append(plan["video"])
    for item in all_items:
        if item.get("assetId") == asset_id:
            return item
    # Compatibility fallback for old tasks.
    return plan.get("video") if task.get("asset_type") == "video" else {}


def _download(url: str, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=120.0, follow_redirects=True) as client:
        r = client.get(url)
        r.raise_for_status()
        path.write_bytes(r.content)


def _demo_qc() -> dict:
    return {"status": "PASS", "identityScore": None, "issues": [], "note": "Demo 模式：未调用视觉模型进行 AI QC。"}


def _qc_status_rank(status: str | None) -> int:
    return {"PASS": 0, "WARNING": 1, "FAIL": 2}.get(str(status or "WARNING").upper(), 1)


def _final_asset_qc(project: dict, task: dict, asset: dict, render_meta: dict | None = None) -> dict:
    """Deterministic QC on the actual file that will be delivered."""
    issues: list[dict] = []
    checks: list[dict] = []
    path_text = asset.get("local_path") if asset else None
    if not path_text or not Path(path_text).exists():
        return {
            "schemaVersion": "final-asset-qc.v1", "status": "FAIL", "checks": [],
            "issues": [{"field": "finalFile", "severity": "critical", "observation": "最终交付文件不存在"}],
        }
    path = Path(path_text)
    if task.get("asset_type") == "video":
        size = path.stat().st_size
        checks.append({"field": "fileExists", "result": "PASS", "observation": f"视频文件存在，{size} bytes"})
        if size < 1024:
            issues.append({"field": "videoFile", "severity": "critical", "observation": "视频文件过小，可能无效"})
    else:
        try:
            from PIL import Image
            with Image.open(path) as im:
                width, height = im.size
                im.verify()
            checks.append({"field": "imageReadable", "result": "PASS", "observation": f"{width}x{height}"})
            if width < 500 or height < 500:
                issues.append({"field": "resolution", "severity": "major", "observation": f"最终图分辨率过低：{width}x{height}"})
            if task.get("asset_type") == "detail_section" and (width, height) != (750, 980):
                issues.append({"field": "detailCanvas", "severity": "major", "observation": f"详情切片画布异常：{width}x{height}，期望750x980"})
        except Exception as e:
            issues.append({"field": "imageReadable", "severity": "critical", "observation": f"最终图片无法读取：{e}"})

    meta = render_meta or (asset.get("metadata") or {}).get("renderMeta") or {}
    if meta.get("copyRendered"):
        expected_copy = str((_task_plan_item(project, task) or {}).get("keyMessage") or "").strip()
        if str(meta.get("renderedCopy") or "") != expected_copy:
            issues.append({"field": "copyTruth", "severity": "critical", "observation": "最终图程序文案与 AssetBrief.keyMessage 不一致"})
        checks.append({"field": "copySource", "result": "PASS" if str(meta.get("renderedCopy") or "") == expected_copy else "FAIL", "observation": "正式短文案由程序从 AssetBrief 渲染"})
    if meta.get("specMode"):
        source_params = {str(k): str(v) for k, v in (project.get("product_params") or {}).items() if str(k).strip() and str(v).strip()}
        rendered = {str(k): str(v) for k, v in (meta.get("renderedParams") or {}).items()}
        wrong = [k for k, v in rendered.items() if source_params.get(k) != v]
        missing = [k for k in source_params if k not in rendered]
        if wrong:
            issues.append({"field": "parameterTruth", "severity": "critical", "observation": "最终规格图含有与项目数据不一致的参数：" + ", ".join(wrong)})
        if missing:
            issues.append({"field": "parameterCoverage", "severity": "major", "observation": "规格图未容纳全部已提供参数：" + ", ".join(missing)})
        if project.get("price") and not meta.get("priceRendered"):
            issues.append({"field": "priceCoverage", "severity": "minor", "observation": "项目提供了价格，但当前规格收束图未渲染价格"})
        checks.append({"field": "parameterSource", "result": "PASS" if not wrong else "FAIL", "observation": "规格文字仅来自 project.product_params / price"})

    critical = [i for i in issues if i.get("severity") == "critical"]
    major = [i for i in issues if i.get("severity") == "major"]
    status = "FAIL" if critical else "WARNING" if major or issues else "PASS"
    return {"schemaVersion": "final-asset-qc.v1", "status": status, "checks": checks, "issues": issues}


def _combine_qc(generation_qc: dict, final_qc: dict, retry_history: list[dict] | None = None) -> dict:
    statuses = [generation_qc.get("status"), final_qc.get("status")]
    status = max(statuses, key=_qc_status_rank)
    issues = list(generation_qc.get("issues") or []) + list(final_qc.get("issues") or [])
    if status == "FAIL" and final_qc.get("status") == "FAIL" and generation_qc.get("status") != "FAIL":
        retry = {"action": "human_review", "focusFields": [i.get("field") for i in final_qc.get("issues") or [] if i.get("field")], "maxRetries": 0}
    else:
        retry = generation_qc.get("retryDecision") or {"action": "none", "focusFields": [], "maxRetries": 0}
    return {
        "schemaVersion": "production-qc.v1",
        "status": status,
        "identityScore": generation_qc.get("identityScore"),
        "executionScore": generation_qc.get("executionScore"),
        "generationQc": generation_qc,
        "finalAssetQc": final_qc,
        "issues": issues,
        "retryDecision": retry,
        "retryHistory": retry_history or [],
    }


def _repair_instruction(qc: dict) -> str:
    decision = qc.get("retryDecision") or {}
    fields = [str(x) for x in decision.get("focusFields") or [] if str(x).strip()]
    if not fields:
        fields = [str(i.get("field")) for i in qc.get("issues") or [] if i.get("field")][:3]
    focus = "、".join(fields) or "商品身份与结构"
    return (
        "[TARGETED REPAIR]\n"
        f"本轮只修复：{focus}。\n"
        "严格保留上一版已经正确的商品轮廓、比例、颜色、Logo/标签位置、构图、机位、背景、光线和所有未被点名的细节。\n"
        "不要重做整套视觉，不新增任何结构、包装、附件、文字或卖点。"
    )



def evaluate_detail_composition(project_id: str) -> dict:
    project = get_project(project_id)
    if not project:
        raise ValueError("Project not found")
    detail_briefs = (project.get("creative_plan") or {}).get("detailSections") or []
    if not detail_briefs:
        return {"schemaVersion":"detail-composer-gate.v1","status":"not_applicable","plannedSectionCount":0,"readySectionCount":0,"missing":[],"invalidQc":[],"assets":[]}

    tasks = list_tasks(project_id)
    by_aid = {str(t.get("label") or "").split(" · ", 1)[0]: t for t in tasks if t.get("asset_type") == "detail_section"}
    missing: list[dict] = []
    invalid_qc: list[dict] = []
    ordered_assets: list[dict] = []
    for index, brief in enumerate(detail_briefs, 1):
        aid = brief.get("assetId")
        task = by_aid.get(aid)
        if not task:
            missing.append({"assetId": aid, "reason": "detail_task_missing"})
            continue
        qc = task.get("qc") or {}
        if task.get("status") != "completed" or qc.get("status") != "PASS":
            invalid_qc.append({"assetId": aid, "taskStatus": task.get("status"), "qcStatus": qc.get("status") or "missing"})
            continue
        asset = get_asset(task.get("result_asset_id")) if task.get("result_asset_id") else None
        if not asset or asset.get("kind") != "detail_section" or not asset.get("local_path") or not Path(asset["local_path"]).exists():
            missing.append({"assetId": aid, "reason": "detail_result_missing"})
            continue
        ordered_assets.append({"assetId": aid, "index": index, "asset": asset})

    status = "ready" if len(ordered_assets) == len(detail_briefs) and not missing and not invalid_qc else "blocked"
    return {
        "schemaVersion":"detail-composer-gate.v1",
        "status":status,
        "plannedSectionCount":len(detail_briefs),
        "readySectionCount":len(ordered_assets),
        "missing":missing,
        "invalidQc":invalid_qc,
        "assets":ordered_assets,
    }


def _final_detail_composite_qc(section_assets: list[dict], output_path: Path) -> dict:
    from PIL import Image
    issues: list[dict] = []
    checks: list[dict] = []
    if not output_path.exists():
        return {"schemaVersion":"final-detail-qc.v1","status":"FAIL","checks":[],"issues":[{"field":"file","severity":"critical","observation":"详情长图文件不存在"}]}
    widths: list[int] = []
    heights: list[int] = []
    for entry in section_assets:
        path = Path((entry.get("asset") or {}).get("local_path") or "")
        try:
            with Image.open(path) as im:
                widths.append(im.width); heights.append(im.height)
        except Exception:
            issues.append({"field":"sectionRead","severity":"critical","observation":f"无法读取详情切片 {entry.get('assetId')}"})
    try:
        with Image.open(output_path) as full:
            actual = (full.width, full.height)
    except Exception:
        actual = (0, 0)
        issues.append({"field":"compositeRead","severity":"critical","observation":"无法读取详情长图"})
    expected = ((max(widths) if widths else 0), sum(heights))
    if actual != expected:
        issues.append({"field":"compositeDimensions","severity":"critical","observation":f"详情长图尺寸异常，expected={expected}, actual={actual}"})
    checks.append({"field":"sectionCount","result":"PASS" if len(section_assets) == len(widths) and len(section_assets) > 0 else "FAIL","observation":f"已拼接 {len(widths)} 个详情切片"})
    checks.append({"field":"compositeDimensions","result":"PASS" if actual == expected and actual != (0,0) else "FAIL","observation":f"expected={expected}, actual={actual}"})
    status = "FAIL" if any(i.get("severity") == "critical" for i in issues) else "PASS"
    return {"schemaVersion":"final-detail-qc.v1","status":status,"checks":checks,"issues":issues,"canvas":{"width":actual[0],"height":actual[1]},"sectionCount":len(section_assets)}

def evaluate_delivery(project_id: str) -> dict:
    """Compute delivery readiness without introducing a new database state machine."""
    project = get_project(project_id)
    if not project:
        raise ValueError("Project not found")
    tasks = list_tasks(project_id)
    plan = project.get("creative_plan") or {}
    briefs = (plan.get("mainImages") or []) + (plan.get("assetImages") or []) + (plan.get("detailSections") or [])
    if plan.get("video"):
        briefs.append(plan["video"])
    required_ids = {b.get("assetId") for b in briefs if b and b.get("deliveryRequired", True)}
    task_by_asset = {str(t.get("label") or "").split(" · ", 1)[0]: t for t in tasks}
    blockers: list[dict] = []
    warnings: list[dict] = []
    for aid in sorted(x for x in required_ids if x):
        task = task_by_asset.get(aid)
        if not task:
            blockers.append({"assetId": aid, "reason": "required_task_missing"})
            continue
        if task.get("status") in {"failed", "failed_qc"}:
            blockers.append({"assetId": aid, "reason": task.get("status"), "error": task.get("error")})
            continue
        qc = task.get("qc") or {}
        if qc.get("status") == "FAIL":
            blockers.append({"assetId": aid, "reason": "unresolved_qc_fail"})
        elif qc.get("status") == "WARNING" or task.get("status") == "needs_review":
            warnings.append({"assetId": aid, "reason": "qc_warning"})
        if not task.get("result_asset_id"):
            blockers.append({"assetId": aid, "reason": "result_asset_missing"})

    detail_gate = evaluate_detail_composition(project_id)
    if detail_gate.get("status") == "blocked":
        blockers.append({"assetId": "detail_full", "reason": "detail_composer_blocked", "detail": {"missing": detail_gate.get("missing") or [], "invalidQc": detail_gate.get("invalidQc") or []}})
    elif detail_gate.get("status") == "ready":
        full_assets = [a for a in list_assets(project_id, "detail_full") if a.get("local_path") and Path(a["local_path"]).exists()]
        if not full_assets:
            blockers.append({"assetId":"detail_full","reason":"detail_full_missing_after_sections_ready"})
        else:
            composite_qc = (full_assets[-1].get("metadata") or {}).get("compositeQc") or {}
            if composite_qc.get("status") != "PASS":
                blockers.append({"assetId":"detail_full","reason":"final_detail_qc_not_pass","qcStatus":composite_qc.get("status") or "missing"})
    delivery_status = "blocked" if blockers else "needs_review" if warnings else "ready"
    return {
        "schemaVersion": "delivery-gate.v1",
        "status": delivery_status,
        "requiredAssetCount": len(required_ids),
        "blockers": blockers,
        "warnings": warnings,
        "detailComposition": detail_gate,
    }


def _remove_asset_file(asset: dict | None):
    if not asset or not asset.get("local_path"):
        return
    try:
        path = Path(asset["local_path"]).resolve()
        path.relative_to(PROJECTS_DIR.resolve())
        path.unlink(missing_ok=True)
    except Exception:
        # Only files below the local project store may be removed here.
        pass


def _remove_task_result(task: dict):
    asset_id = task.get("result_asset_id")
    if not asset_id:
        return
    asset = get_asset(asset_id)
    _remove_asset_file(asset)
    delete_asset(asset_id)


def _prompt_item_for_task(project: dict, task: dict) -> dict:
    aid = str(task.get("label") or "").split(" · ", 1)[0]
    for item in (project.get("prompt_bundle") or {}).get("items", []):
        if item.get("assetId") == aid:
            return item
    return {}


def _reference_paths_for_item(project_id: str, item: dict, limit: int = 4) -> list[Path]:
    """Resolve only the references explicitly selected by ReferenceAssignmentV2.

    There is deliberately no fallback to every uploaded source image. A silent
    fallback breaks the visual-director contract and can contaminate one task
    with unrelated views/backgrounds.
    """
    sources = list_assets(project_id, "source")
    by_id = {f"img_{i}": a for i, a in enumerate(sources, 1)}
    paths: list[Path] = []
    for ref in item.get("referenceAssignments") or item.get("referenceMap") or []:
        asset = by_id.get(ref.get("imageId"))
        if asset and asset.get("local_path"):
            p = Path(asset["local_path"])
            if p.exists() and p not in paths:
                paths.append(p)
    return paths[:limit]


def _live_qc(client: ArkClient, project: dict, task: dict, generated: Path) -> dict:
    item=_prompt_item_for_task(project,task)
    originals=_reference_paths_for_item(project["id"],item,limit=2)
    if not originals:
        return {"schemaVersion":"qc.v2","status":"WARNING","identityScore":None,"executionScore":None,"checks":[],"issues":[{"field":"reference","severity":"major","observation":"缺少可用于对比的商品参考图"}],"retryDecision":{"action":"human_review","focusFields":["reference"],"maxRetries":0}}
    profile=project.get("product_profile") or {}; lock=profile.get("identityLock") or {}
    features=lock.get("features") or []; spec=item.get("visualSpec") or {}; qc_focus=item.get("qcChecklist") or []
    assignments=item.get("referenceAssignments") or item.get("referenceMap") or []
    prompt=f"""
任务：做电商生成图 QC。前 {len(originals)} 张是本资产实际使用的原始商品参考图，最后 1 张是生成结果。
你只负责观察差异，不给总分，不评价审美。程序会根据 severity 计算 identityScore / status。

IdentityLockV2.features：
{json.dumps(features,ensure_ascii=False)}

ReferenceAssignmentV2：
{json.dumps(assignments,ensure_ascii=False)}

VisualSpecV2：
{json.dumps(spec,ensure_ascii=False)}

当前资产 QC Focus：
{json.dumps(qc_focus,ensure_ascii=False)}

输出严格 JSON：
{{
  "identityChecks":[
    {{"checkId":"lf_001","sourceFeatureId":"lf_001","field":"","expected":null,"result":"PASS|WARNING|FAIL|NA","severity":"critical|major|minor","referenceRegion":"","generatedRegion":"","observation":""}}
  ],
  "executionChecks":[
    {{"checkId":"extraParts","field":"extraParts|missingParts|textHallucination|safeArea|composition|orientation|humanRule|packaging|attachments","result":"PASS|WARNING|FAIL|NA","severity":"critical|major|minor","referenceRegion":"","generatedRegion":"","observation":""}}
  ],
  "issues":[
    {{"field":"","severity":"critical|major|minor","observation":"","fix":""}}
  ]
}}

硬规则：
- IdentityLock 中每个 featureId 必须有一项 identityChecks；看不清则 NA，不得猜。
- expected 必须照抄 IdentityLock.value，不得自己改写期望。
- 使用 ReferenceAssignment.regionResponsibilities 作为参考证据区域；有 regionBox 就优先观察对应区域。
- 新增/删除商品组件、按钮/接口数量改变、Logo明显错误、凭空包装/附件、关键结构变形 => critical FAIL。
- 商品真实颜色明显改变、比例明显漂移 => major 或 critical。
- 正式中文/参数/价格/促销/认证文字由程序渲染；如果生成图自行出现此类文字，textHallucination 至少 major FAIL。
- 若 VisualSpec 禁止人物/手部但画面出现，humanRule=major/critical FAIL；允许手部时检查持握是否遮挡关键身份结构。
- safeArea 为 strict 时，高对比纹理/道具/主体侵入该矩形 => safeArea WARNING/FAIL。
- observation 必须写“参考图看到了什么、生成图看到了什么”，不能只写“不同”。
""".strip()
    try:
        image_inputs=[file_to_data_url(p) for p in originals]+[file_to_data_url(generated)]
        try: raw=parse_jsonish(client.vision(prompt,image_inputs)["text"])
        except Exception: raw=parse_jsonish(client.vision(prompt,image_inputs,model=client.models.get("vision_fallback"))["text"])
        identity=raw.get("identityChecks") or []; execution=raw.get("executionChecks") or []; issues=raw.get("issues") or []
        feature_by_id={f.get("featureId"):f for f in features if f.get("featureId")}
        # Normalize identity severity from the contract; model cannot downgrade it.
        normalized=[]
        for c in identity:
            if not isinstance(c,dict): continue
            fid=c.get("sourceFeatureId") or c.get("checkId"); feat=feature_by_id.get(fid)
            if feat:
                c["severity"]=feat.get("severity") or "major"; c["expected"]=feat.get("value")
            if c.get("result") not in {"PASS","WARNING","FAIL","NA"}: c["result"]="WARNING"
            normalized.append(c)
        seen={c.get("sourceFeatureId") or c.get("checkId") for c in normalized}
        for fid,feat in feature_by_id.items():
            if fid not in seen:
                normalized.append({"checkId":fid,"sourceFeatureId":fid,"field":feat.get("field"),"expected":feat.get("value"),"result":"NA","severity":feat.get("severity") or "major","referenceRegion":"","generatedRegion":"","observation":"模型未返回该锁的检查结果"})
        identity=normalized
        weights={"critical":1.0,"major":0.5,"minor":0.2}; result_value={"PASS":1.0,"WARNING":0.5,"FAIL":0.0}
        denom=sum(weights.get(c.get("severity"),0.2) for c in identity if c.get("result")!="NA")
        numer=sum(weights.get(c.get("severity"),0.2)*result_value.get(c.get("result"),0.5) for c in identity if c.get("result")!="NA")
        identity_score=round(100*numer/denom) if denom else None
        ex_valid=[c for c in execution if isinstance(c,dict) and c.get("result") in {"PASS","WARNING","FAIL"}]
        execution_score=round(100*sum(result_value[c["result"]] for c in ex_valid)/len(ex_valid)) if ex_valid else None
        all_checks=identity+ex_valid
        critical_fail=[c for c in all_checks if c.get("severity")=="critical" and c.get("result")=="FAIL"]
        major_fail=[c for c in all_checks if c.get("severity")=="major" and c.get("result")=="FAIL"]
        warnings=[c for c in all_checks if c.get("result")=="WARNING"]
        if critical_fail or len(major_fail)>=2: status="FAIL"
        elif len(major_fail)==1 or warnings: status="WARNING"
        else: status="PASS"
        focus=list(dict.fromkeys([c.get("field") for c in critical_fail+major_fail if c.get("field")]))
        brief=_task_plan_item(project,task)
        retry={"action":"targeted_retry" if status=="FAIL" else "human_review" if status=="WARNING" else "none","focusFields":focus,"maxRetries":1 if status=="FAIL" else 0,"businessPriority":brief.get("businessPriority","supporting")}
        return {"schemaVersion":"qc.v2","status":status,"identityScore":identity_score,"executionScore":execution_score,"scoreWeights":weights,"checks":{"identity":identity,"execution":ex_valid},"issues":issues,"retryDecision":retry}
    except Exception as e:
        return {"schemaVersion":"qc.v2","status":"WARNING","identityScore":None,"executionScore":None,"checks":{},"issues":[{"field":"qc","severity":"major","observation":f"QC 调用失败：{e}","fix":"人工检查或重试视觉 QC"}],"retryDecision":{"action":"human_review","focusFields":["qc"],"maxRetries":0}}

def _ffmpeg_exe() -> str | None:
    exe=shutil.which("ffmpeg")
    if exe: return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def _extract_video_frames(video_path: Path, shots: list[dict], out_dir: Path) -> list[tuple[str,Path]]:
    exe=_ffmpeg_exe()
    if not exe or not video_path.exists(): return []
    out_dir.mkdir(parents=True,exist_ok=True); frames=[]
    for shot in shots[:6]:
        try: mid=(float(shot.get("startSec"))+float(shot.get("endSec")))/2
        except Exception: continue
        out=out_dir/f"{shot.get('shotId','shot')}.jpg"
        cmd=[exe,"-y","-ss",f"{mid:.3f}","-i",str(video_path),"-frames:v","1","-q:v","2",str(out)]
        try:
            subprocess.run(cmd,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=30)
            if out.exists(): frames.append((shot.get("shotId") or "shot",out))
        except Exception: pass
    return frames


def _live_video_qc(client: ArkClient, project: dict, task: dict, video_path: Path) -> dict:
    item=_prompt_item_for_task(project,task); vp=item.get("visualSpec") or (item.get("promptPackage") or {}).get("videoPlan") or {}
    shots=vp.get("shots") or []
    frames=_extract_video_frames(video_path,shots,project_dir(project["id"])/"generated"/"video-qc")
    originals=_reference_paths_for_item(project["id"],item,limit=2)
    if not frames or not originals:
        return {"schemaVersion":"video-qc.v2","status":"WARNING","identityScore":None,"issues":[{"field":"video_qc","severity":"major","observation":"无法提取视频抽帧或缺少参考图"}],"retryDecision":{"action":"human_review","focusFields":["video_qc"],"maxRetries":0}}
    lock=(project.get("product_profile") or {}).get("identityLock") or {}
    order=[sid for sid,_ in frames]
    prompt=f"""
任务：对生成商品视频做 Video QC。前 {len(originals)} 张是原始商品参考图，之后 {len(frames)} 张依次是生成视频各镜头中点抽帧，对应 shotId：{order}。
只检查商品身份、每镜执行与跨镜一致性，不评价审美。

IdentityLockV2：{json.dumps(lock,ensure_ascii=False)}
VideoPlanV2：{json.dumps(vp,ensure_ascii=False)}

输出严格 JSON：
{{
 "shotChecks":[{{"shotId":"s1","identity":"PASS|WARNING|FAIL|NA","execution":"PASS|WARNING|FAIL|NA","severity":"critical|major|minor","observation":""}}],
 "crossShotChecks":[{{"field":"silhouette|logo|buttonCount|interface|colorRegions|headStructure|bodyStructure|packaging|attachments","result":"PASS|WARNING|FAIL|NA","severity":"critical|major|minor","observation":""}}],
 "issues":[{{"field":"","severity":"critical|major|minor","observation":"","fix":""}}]
}}

硬规则：
- 每个抽帧 shotId 都要有 shotChecks。
- 新增/删除组件、按钮/接口数量改变、Logo明显错误、凭空包装/附件、跨镜换款/变形 => critical FAIL。
- 跨镜颜色区域、轮廓、刷头/机身等关键结构漂移至少 major；严重时 critical。
- 如果某镜人物/手部违反该 shot 的 human 规则，execution 至少 major FAIL。
- 不生成任何 identityScore，总分由程序计算。
""".strip()
    try:
        inputs=[file_to_data_url(p) for p in originals]+[file_to_data_url(p) for _,p in frames]
        try: raw=parse_jsonish(client.vision(prompt,inputs)["text"])
        except Exception: raw=parse_jsonish(client.vision(prompt,inputs,model=client.models.get("vision_fallback"))["text"])
        checks=(raw.get("shotChecks") or [])+(raw.get("crossShotChecks") or [])
        critical=[c for c in checks if c.get("severity")=="critical" and (c.get("identity")=="FAIL" or c.get("execution")=="FAIL" or c.get("result")=="FAIL")]
        major=[c for c in checks if c.get("severity")=="major" and (c.get("identity")=="FAIL" or c.get("execution")=="FAIL" or c.get("result")=="FAIL")]
        warn=[c for c in checks if "WARNING" in {c.get("identity"),c.get("execution"),c.get("result")}]
        status="FAIL" if critical or len(major)>=2 else "WARNING" if major or warn else "PASS"
        score_items=[]
        for c in checks:
            vals=[v for v in [c.get("identity"),c.get("execution"),c.get("result")] if v in {"PASS","WARNING","FAIL"}]
            score_items.extend(vals)
        rv={"PASS":1,"WARNING":0.5,"FAIL":0}; score=round(100*sum(rv[x] for x in score_items)/len(score_items)) if score_items else None
        focus=list(dict.fromkeys([c.get("field") or c.get("shotId") for c in critical+major if c.get("field") or c.get("shotId")]))
        brief=_task_plan_item(project,task)
        return {"schemaVersion":"video-qc.v2","status":status,"identityScore":score,"checks":{"shots":raw.get("shotChecks") or [],"crossShot":raw.get("crossShotChecks") or []},"issues":raw.get("issues") or [],"retryDecision":{"action":"targeted_retry" if status=="FAIL" else "human_review" if status=="WARNING" else "none","focusFields":focus,"maxRetries":1 if status=="FAIL" else 0,"businessPriority":brief.get("businessPriority","conversion_critical")}}
    except Exception as e:
        return {"schemaVersion":"video-qc.v2","status":"WARNING","identityScore":None,"issues":[{"field":"video_qc","severity":"major","observation":f"视频QC失败：{e}"}],"retryDecision":{"action":"human_review","focusFields":["video_qc"],"maxRetries":0}}


def _render_demo_task(project: dict, task: dict, index: int) -> dict:
    pdir = project_dir(project["id"])
    generated = pdir / "generated"
    generated.mkdir(parents=True, exist_ok=True)
    src = source_paths(project["id"])
    item = _task_plan_item(project, task)
    if task["asset_type"] == "video":
        images = [Path(a["local_path"]) for a in list_assets(project["id"]) if a["kind"] in {"main_image", "asset_image"} and a.get("local_path")]
        out = generated / "product-ad-demo.mp4"
        ok = create_demo_video(images[:5], out, duration=int(item.get("duration", 10)))
        if not ok:
            raise RuntimeError("Demo 视频生成失败：本机未找到可用 FFmpeg")
        asset = add_asset(project["id"], "video", task["label"], str(out), mime="video/mp4", metadata={"demo": True})
        gen_qc = _demo_qc()
        final_qc = _final_asset_qc(project, task, asset)
        return {"asset": asset, "qc": _combine_qc(gen_qc, final_qc)}

    size = (1024, 1024) if task["asset_type"] != "detail_section" else (900, 900)
    visual = generated / f"{task['id']}-visual.jpg"
    make_demo_card(visual, project["name"], item.get("keyMessage", task["purpose"]), task["label"], src, size=size, variant=index)
    render_meta = None
    if task["asset_type"] == "detail_section":
        detail_tasks = [t for t in list_tasks(project["id"]) if t["asset_type"] == "detail_section"]
        detail_index = next(i for i, t in enumerate(detail_tasks) if t["id"] == task["id"]) + 1
        out = generated / f"detail-{detail_index:02d}.jpg"
        spec_mode = str(item.get("assetId") or "").endswith("06") or "规格" in str(item.get("title") or "") or "参数" in str(item.get("title") or "")
        render_meta = render_detail_section(
            out, visual, item.get("title", task["label"]), item.get("keyMessage", ""), detail_index,
            product_params=project.get("product_params") or {}, price=project.get("price") or "", spec_mode=spec_mode,
        )
        asset = add_asset(project["id"], "detail_section", task["label"], str(out), mime="image/jpeg", metadata={"demo": True, "sectionIndex": detail_index, "renderMeta": render_meta})
    else:
        kind = task["asset_type"]
        out = generated / f"{task['id']}.jpg"
        shutil.copy2(visual, out)
        asset = add_asset(project["id"], kind, task["label"], str(out), mime="image/jpeg", metadata={"demo": True})
    gen_qc = _demo_qc()
    final_qc = _final_asset_qc(project, task, asset, render_meta)
    return {"asset": asset, "qc": _combine_qc(gen_qc, final_qc)}


def _render_live_task(project: dict, task: dict, repair_instruction: str | None = None) -> dict:
    client = ArkClient()
    pdir = project_dir(project["id"])
    generated = pdir / "generated"
    generated.mkdir(parents=True, exist_ok=True)
    item = _task_plan_item(project, task)
    prompt_item = _prompt_item_for_task(project, task)
    requested = ((prompt_item.get("promptPackage") or {}).get("requestedCapabilities") or {})
    role = "video" if task["asset_type"] == "video" else "image"
    # timeline instructions are prompt semantics, not a raw Ark API capability.
    if role == "video" and requested.get("timestampControl"):
        requested = {k: v for k, v in requested.items() if k != "timestampControl"}
    client.require_capabilities(role, requested)

    ref_paths = _reference_paths_for_item(project["id"], prompt_item, limit=4)
    if list_assets(project["id"], "source") and not ref_paths:
        raise ValueError("ReferenceAssignmentV2 未给当前资产分配可用商品参考图；禁止回退到全部源图")
    refs = [file_to_data_url(p) for p in ref_paths]
    effective_prompt = task["prompt"] + (("\n\n" + repair_instruction) if repair_instruction else "")

    if task["asset_type"] == "video":
        gp = (prompt_item.get("generationParams") or {})
        created = client.video_create(effective_prompt, refs, duration=int(gp.get("durationSec") or item.get("duration", 10)), ratio=gp.get("aspectRatio") or item.get("ratio", "9:16"))
        remote_task_id = created.get("id")
        if not remote_task_id:
            raise ArkError("Seedance 未返回任务 ID")
        deadline = time.time() + 420
        last = {}
        while time.time() < deadline:
            time.sleep(8)
            last = client.video_get(remote_task_id)
            status = last.get("status")
            if status == "succeeded":
                url = (last.get("content") or {}).get("video_url")
                if not url:
                    raise ArkError("视频成功但未返回 video_url")
                out = generated / "product-ad-live.mp4"
                try:
                    _download(url, out)
                    local = str(out)
                except Exception:
                    local = None
                asset = add_asset(project["id"], "video", task["label"], local, remote_url=url, mime="video/mp4", metadata={"arkTaskId": remote_task_id, "demo": False, "repair": bool(repair_instruction)})
                gen_qc = _live_video_qc(client, project, task, out) if local else {"schemaVersion":"video-qc.v2","status":"WARNING","identityScore":None,"issues":[{"field":"video_download","severity":"major","observation":"远程视频生成成功，但本地下载失败，无法抽帧QC"}],"retryDecision":{"action":"human_review","focusFields":["video_download"],"maxRetries":0}}
                final_qc = _final_asset_qc(project, task, asset)
                return {"asset": asset, "qc": _combine_qc(gen_qc, final_qc)}
            if status in {"failed", "cancelled", "expired"}:
                raise ArkError(json.dumps(last.get("error") or {"status": status}, ensure_ascii=False))
        raise ArkError(f"视频任务等待超时，可在火山方舟按任务ID查询：{remote_task_id}")

    gp = prompt_item.get("generationParams") or {}
    result = client.image(effective_prompt, refs, size=gp.get("size") or "2K")
    out = generated / f"{task['id']}-seedream.jpg"
    _download(result["url"], out)
    # Generation QC must inspect the raw model result before deterministic copy/spec rendering.
    gen_qc = _live_qc(client, project, task, out)

    render_meta = None
    if task["asset_type"] == "detail_section":
        detail_tasks = [t for t in list_tasks(project["id"]) if t["asset_type"] == "detail_section"]
        detail_index = next(i for i, t in enumerate(detail_tasks) if t["id"] == task["id"]) + 1
        rendered = generated / f"detail-{detail_index:02d}.jpg"
        spec_mode = str(item.get("assetId") or "").endswith("06") or "规格" in str(item.get("title") or "") or "参数" in str(item.get("title") or "")
        render_meta = render_detail_section(
            rendered, out, item.get("title", task["label"]), item.get("keyMessage", ""), detail_index,
            product_params=project.get("product_params") or {}, price=project.get("price") or "", spec_mode=spec_mode,
        )
        asset = add_asset(project["id"], "detail_section", task["label"], str(rendered), remote_url=result["url"], mime="image/jpeg", metadata={"demo": False, "sectionIndex": detail_index, "generationLatencyMs": result["latency_ms"], "renderMeta": render_meta, "repair": bool(repair_instruction)})
    else:
        # Formal short copy is composited after generation, never drawn by the model.
        rendered = generated / f"{task['id']}-final.jpg"
        safe_areas = ((prompt_item.get("visualSpec") or {}).get("safeAreas") or [])
        render_meta = render_text_overlay(rendered, out, item.get("keyMessage") or "", safe_areas)
        asset = add_asset(project["id"], task["asset_type"], task["label"], str(rendered), remote_url=result["url"], mime="image/jpeg", metadata={"demo": False, "generationLatencyMs": result["latency_ms"], "renderMeta": render_meta, "repair": bool(repair_instruction)})
    final_qc = _final_asset_qc(project, task, asset, render_meta)
    return {"asset": asset, "qc": _combine_qc(gen_qc, final_qc)}

def compose_detail(project_id: str) -> dict | None:
    gate = evaluate_detail_composition(project_id)
    old_full = list_assets(project_id, "detail_full")
    if gate.get("status") != "ready":
        # Never leave a stale long image behind when the current section set is incomplete.
        for old in old_full:
            try:
                if old.get("local_path"):
                    Path(old["local_path"]).unlink(missing_ok=True)
            except Exception:
                pass
            delete_asset(old["id"])
        return None

    ordered_entries = gate.get("assets") or []
    out = project_dir(project_id) / "generated" / "detail-full.jpg"
    for old in old_full:
        try:
            if old.get("local_path"):
                Path(old["local_path"]).unlink(missing_ok=True)
        except Exception:
            pass
        delete_asset(old["id"])

    stitch_vertical([Path(entry["asset"]["local_path"]) for entry in ordered_entries], out)
    composite_qc = _final_detail_composite_qc(ordered_entries, out)
    if composite_qc.get("status") != "PASS":
        out.unlink(missing_ok=True)
        return None
    return add_asset(
        project_id, "detail_full", "完整详情长图", str(out), mime="image/jpeg",
        metadata={
            "sections": len(ordered_entries),
            "sectionAssetIds": [entry.get("assetId") for entry in ordered_entries],
            "compositeQc": composite_qc,
            "composerGate": {k: gate.get(k) for k in ["status","plannedSectionCount","readySectionCount"]},
        },
    )


def run_generation(project_id: str, only_task_id: str | None = None):
    project = get_project(project_id)
    if not project:
        return
    try:
        update_project(project_id, status="generating")
        tasks = ensure_tasks(project_id)
        if only_task_id:
            tasks = [t for t in tasks if t["id"] == only_task_id]
        for idx, task in enumerate(tasks):
            if task["status"] in {"completed", "needs_review", "failed_qc"} and not only_task_id:
                continue
            update_task(task["id"], status="running", error=None)
            try:
                _remove_task_result(task)
                result = _render_demo_task(project, task, idx) if project["mode"] == "demo" else _render_live_task(project, task)
                qc = result["qc"]
                retry_history: list[dict] = []

                decision = qc.get("retryDecision") or {}
                if project["mode"] == "live" and qc.get("status") == "FAIL" and decision.get("action") == "targeted_retry" and int(decision.get("maxRetries") or 0) > 0:
                    retry_history.append({
                        "attempt": 1,
                        "status": qc.get("status"),
                        "focusFields": decision.get("focusFields") or [],
                        "action": "targeted_retry",
                    })
                    first_asset = result.get("asset")
                    if first_asset:
                        _remove_asset_file(first_asset)
                        delete_asset(first_asset["id"])
                    repair = _repair_instruction(qc)
                    result = _render_live_task(project, task, repair_instruction=repair)
                    qc = result["qc"]
                    retry_history.append({
                        "attempt": 2,
                        "status": qc.get("status"),
                        "focusFields": (qc.get("retryDecision") or {}).get("focusFields") or [],
                        "action": "completed_retry",
                    })
                    qc["retryHistory"] = retry_history

                qstatus = str(qc.get("status") or "WARNING").upper()
                task_status = "completed" if qstatus == "PASS" else "needs_review" if qstatus == "WARNING" else "failed_qc"
                update_task(task["id"], status=task_status, result_asset_id=result["asset"]["id"], qc_json=qc, error=None)
            except Exception as e:
                update_task(task["id"], status="failed", error=str(e))
                if project["mode"] == "live" and not only_task_id:
                    continue

        compose_detail(project_id)
        gate = evaluate_delivery(project_id)
        if gate["status"] == "ready":
            update_project(project_id, status="completed")
        elif gate["status"] == "needs_review":
            update_project(project_id, status="needs_review")
        else:
            update_project(project_id, status="blocked")
    except Exception:
        update_project(project_id, status="failed")

def start_generation(project_id: str, only_task_id: str | None = None):
    t = threading.Thread(target=run_generation, args=(project_id, only_task_id), daemon=True)
    t.start()


def result_payload(project_id: str) -> dict:
    project = get_project(project_id)
    assets = list_assets(project_id)
    tasks = list_tasks(project_id)
    for a in assets:
        if a.get("local_path"):
            try:
                rel = Path(a["local_path"]).resolve().relative_to(PROJECTS_DIR.resolve())
                a["local_url"] = "/files/" + str(rel).replace("\\", "/")
            except Exception:
                a["local_url"] = None
        else:
            a["local_url"] = None
    try:
        delivery = evaluate_delivery(project_id)
    except Exception:
        delivery = {"schemaVersion":"delivery-gate.v1","status":"blocked","blockers":[{"reason":"delivery_evaluation_failed"}],"warnings":[]}
    return {"project": project, "assets": assets, "tasks": tasks, "deliveryGate": delivery}
