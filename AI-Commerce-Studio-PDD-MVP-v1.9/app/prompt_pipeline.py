from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

from .prompt_craft import (
    CREATIVE_REFERENCE_ROLES, PRODUCT_FACT_SOURCE_ROLES,
    apply_master_scene_to_visual_spec, asset_scaffold, build_campaign_style_lock, build_master_scene_lock,
    category_render_guide, creative_profile_lines, master_scene_lines, normalize_source_role,
    scene_policy_for_asset, style_lock_lines, apply_visual_role_contract, visual_role_contract,
)


IMAGE_TYPES = ("mainImages", "assetImages", "detailSections")
ASSET_IDS = {
    "main": [f"main_{i:02d}" for i in range(1, 4)],
    "material": [f"asset_{i:02d}" for i in range(1, 5)],
    "detail": [f"detail_{i:02d}" for i in range(1, 7)],
    "video": ["video_01"],
}

# Conservative, versioned product-side rules. These are intentionally not a
# hard-coded copy of a merchant-backend rule page. The live merchant backend
# remains the final authority for upload constraints.
PDD_PLATFORM_RULES: dict[str, Any] = {
    "schemaVersion": "platform-rule.v2",
    "platform": "pdd",
    "version": "mvp-2026-09",
    "ruleSource": "conservative_mvp_profile",
    "truthfulness": {
        "required": True,
        "forbidUnverifiedClaims": True,
        "forbidInventedCertification": True,
        "forbidInventedPackagingOrAccessories": True,
    },
    "mobileFirst": {
        "primarySurface": "phone",
        "searchAssetRatio": "1:1",
        "detailSectionRatio": "3:4",
        "videoRatio": "9:16",
        "minPrimaryProductOccupancyPct": 52,
    },
    "textPolicy": {
        "formalTextRenderedByProgram": True,
        "imageModelShouldNotRenderPriceOrParameters": True,
        "imageModelShouldNotRenderPromoOrCertification": True,
    },
    "detail": {
        "strategy": "section_render_then_compose",
        "targetWidth": 750,
    },
    "note": "真实上架前以当前拼多多商家后台、类目规则和审核提示为准。",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def canonical_hash(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def source_registry(source_assets: list[dict]) -> list[dict]:
    out = []
    for idx, asset in enumerate(source_assets, 1):
        metadata = asset.get("metadata") if isinstance(asset.get("metadata"), dict) else {}
        source_role = normalize_source_role(metadata.get("sourceRole"))
        out.append({
            "imageId": f"img_{idx}",
            "assetId": asset.get("id"),
            "label": asset.get("label") or f"source-{idx}",
            "mime": asset.get("mime") or "",
            "sourceRole": source_role,
        })
    return out

def _empty_box() -> dict:
    return {"xPct": 0, "yPct": 0, "widthPct": 0, "heightPct": 0}


def demo_evidence(source_assets: list[dict]) -> dict:
    registry = source_registry(source_assets)
    return {
        "schemaVersion": "evidence.v2.1",
        "mode": "demo_preview",
        "assets": [
            {
                **r,
                "assetRole": "unknown",
                "view": {"direction": "unknown", "elevation": "unknown"},
                "productParts": [],
                "surfaceAppearance": [],
                "spatialRelations": [],
                "proportions": [],
                "colorRegions": [],
                "textItems": [],
                "creativeReferenceProfile": None,
                "packagingEvidence": {"status": "uncertain", "notes": ["Demo 模式不调用视觉模型"]},
                "accessoryEvidence": {"status": "uncertain", "notes": ["Demo 模式不调用视觉模型"]},
                "recommendedUse": ["demo_preview_only"],
                "ignoreFor": ["all_unverified_visual_details", "background", "text", "watermark"],
                "quality": {"sharpness": "unknown", "occlusion": "unknown", "distortion": "unknown"},
            }
            for r in registry
        ],
        "crossAsset": {
            "consistentFeatures": [],
            "conflicts": [],
            "masterReferences": {},
            "missingViews": ["Demo 模式未执行真实逐图证据抽取"],
            "creativeReferenceProfiles": [],
        },
        "unresolved": ["Demo 模式不能建立生产级 IdentityLock 或 CreativeReferenceProfile；切换 Live 后重新分析。"],
    }

def vision_evidence_prompt(registry: list[dict]) -> str:
    ids = [r["imageId"] for r in registry]
    role_map = {r["imageId"]: r.get("sourceRole") for r in registry}
    schema = {
        "schemaVersion": "evidence.v2.1",
        "assets": [
            {
                "imageId": "img_1",
                "sourceRole": "PRODUCT_TRUTH|PRODUCT_DETAIL|PACKAGING_TRUTH|STYLE_REFERENCE|LAYOUT_REFERENCE|SCENE_REFERENCE",
                "assetRole": "product_front|product_three_quarter|product_side|product_back|product_detail|packaging|accessory|scene|reference_design|unknown",
                "view": {
                    "direction": "front|front_left|front_right|side_left|side_right|back|top|bottom|detail|unknown",
                    "elevation": "eye_level|slight_high|high|slight_low|low|unknown",
                },
                "productParts": [
                    {
                        "partId": "",
                        "partType": "",
                        "count": None,
                        "shape": None,
                        "position": {"relativeTo": None, "vertical": "unknown", "horizontal": "unknown"},
                        "dominantColor": None,
                        "sizeRelative": "unknown",
                        "visibleRegion": "full|partial|occluded",
                        "boundingBox": {"xPct": 0, "yPct": 0, "widthPct": 0, "heightPct": 0},
                        "confidence": "high|medium|low",
                    }
                ],
                "surfaceAppearance": [
                    {
                        "targetPartId": "",
                        "regionBox": None,
                        "appearanceClass": "matte_polymer|glossy_polymer|brushed_metal|polished_metal|clear_glass|frosted_glass|fabric|wood|ceramic|stone|paper|coated_packaging|unknown",
                        "finish": "matte|satin|glossy|brushed|polished|frosted|woven|natural|unknown",
                        "texture": "",
                        "reflectance": "low|medium|high|mixed|unknown",
                        "transparency": "opaque|translucent|transparent|mixed|unknown",
                        "microDetail": "",
                        "edgeCharacter": "soft_rounded|crisp|beveled|thin|thick|mixed|unknown",
                        "confidence": "high|medium|low"
                    }
                ],
                "spatialRelations": [
                    {"subjectPartId": "", "relation": "above|below|left_of|right_of|inside|attached_to|centered_on|overlaps|unknown", "objectPartId": "", "confidence": "high|medium|low"}
                ],
                "proportions": [
                    {"subjectPartId": "", "relativeToPartId": "", "relation": "length_ratio|width_ratio|area_ratio|relative_size", "ratioApprox": None, "confidence": "high|medium|low"}
                ],
                "colorRegions": [
                    {"regionId": "", "targetPartId": "", "color": "", "position": "", "boundingBox": _empty_box(), "confidence": "high|medium|low"}
                ],
                "textItems": [
                    {"text": "", "kind": "product|packaging|background|watermark", "location": "", "boundingBox": _empty_box(), "confidence": "high|medium|low"}
                ],
                "creativeReferenceProfile": {
                    "compositionPattern": "",
                    "productOccupancy": "",
                    "cameraPattern": "",
                    "backgroundGeometry": "",
                    "surfaceSystem": "",
                    "propSystem": "",
                    "lightDirection": "",
                    "lightQuality": "",
                    "contrastPattern": "",
                    "colorRelationship": "",
                    "depthPattern": "",
                    "negativeSpacePattern": "",
                    "visualHierarchy": "",
                    "copyZonePattern": "",
                    "avoidInherit": ["reference product identity", "brand", "logo", "copy", "parameters", "packaging facts"]
                },
                "packagingEvidence": {"status": "visible|not_visible|uncertain", "notes": []},
                "accessoryEvidence": {"status": "visible|not_visible|uncertain", "notes": []},
                "recommendedUse": [],
                "ignoreFor": [],
                "quality": {"sharpness": "good|usable|poor", "occlusion": "none|partial|severe", "distortion": "none|minor|major"},
            }
        ],
        "crossAsset": {
            "consistentFeatures": [],
            "conflicts": [],
            "masterReferences": {"structure": "", "color": "", "logo": "", "front": "", "side": "", "detail": "", "packaging": ""},
            "missingViews": [],
            "creativeReferenceProfiles": []
        },
        "unresolved": [],
    }
    return f"""
任务：将上传素材逐张转换成 EvidenceBundleV2.1。你将按顺序收到 {len(ids)} 张图，对应 imageId：{', '.join(ids)}。

用户已经为每张图指定 SourceRole；这是权威角色，禁止擅自改写：
{json.dumps(role_map, ensure_ascii=False)}

SourceRole 语义：
- PRODUCT_TRUTH：商品事实主参考，可证明可见商品身份、颜色、结构与表面外观。
- PRODUCT_DETAIL：商品细节事实参考，只证明当前清晰可见局部。
- PACKAGING_TRUTH：包装事实参考，只证明包装自身，不得把包装文字/结构当商品本体。
- STYLE_REFERENCE：只提取摄影风格、光线、色彩和氛围方法，不得用于商品事实或 IdentityLock。
- LAYOUT_REFERENCE：只提取构图、层级、占比、留白和 copy zone，不得用于商品事实或 IdentityLock。
- SCENE_REFERENCE：只提取环境、承托面、道具关系和空间层次，不得用于商品事实或 IdentityLock。

核心纪律：事实参考与创意参考彻底分流。
1. PRODUCT_TRUTH / PRODUCT_DETAIL / PACKAGING_TRUTH 才允许输出 productParts、surfaceAppearance、商品颜色/文字/结构证据。
2. STYLE_REFERENCE / LAYOUT_REFERENCE / SCENE_REFERENCE 不得证明用户商品的形状、Logo、部件、材质、参数、包装或附件；这些图重点输出 creativeReferenceProfile。
3. creativeReferenceProfile 只描述“视觉方法”：构图、镜头、背景几何、承托面、道具系统、光线方向/质感、对比、色彩关系、空间层次、留白、视觉层级、文案区。不要复制参考图的品牌、商品、文字或参数。
4. surfaceAppearance 只描述像素可见的表面外观。静态图片能判断“哑光低反射表面/拉丝金属观感/透明玻璃观感”，但不能把视觉外观升级成未经证实的化学材质成分（例如 ABS、铝合金具体牌号）。不确定写 unknown。
5. material/finish/texture/reflectance/transparency/microDetail/edgeCharacter 必须与真实可见区域绑定；目标部位无法确认时不写。
6. 包装和附件必须严格区分；背景道具不得当附件。
7. 背面、接口、按钮、内部结构看不见就 unknown，不根据常识补齐。
8. 性能、功效、认证、容量、功率、续航、重量、适用人群等仍禁止仅凭图片推断。

坐标规则：boundingBox/regionBox 使用相对原图 0–100 百分比；看不清则 null，不做伪精确。
ID 规则：imageId 与输入顺序完全一致；partId/regionId 可暂空，程序会稳定分配。

输出严格 JSON，不要 Markdown，不要解释，必须符合这个 Schema：
{json.dumps(schema, ensure_ascii=False)}
""".strip()

def product_profile_prompt(project: dict, evidence: dict) -> str:
    user_input = {k: project.get(k) for k in ["name", "category", "brand", "price", "selling_points", "product_params"]}
    schema = {
        "schemaVersion": "product-profile.v2",
        "productName": "",
        "category": "",
        "brand": "",
        "price": "",
        "visualIdentity": {"summary": ""},
        "confirmedFacts": [],
        "userClaims": [],
        "parameters": {},
        "evidence": [
            {
                "localKey": "v1",
                "fact": "",
                "sourceType": "visual|user_provided|inferred",
                "sourceImage": "img_1|",
                "sourcePartIds": [],
                "visibleEvidence": "",
                "confidence": "high|medium|low",
                "visualProvable": True,
            }
        ],
        "identityLock": {
            "schemaVersion": "identity-lock.v2",
            "features": [
                {
                    "field": "silhouette|headStructure|bodyStructure|buttonCount|buttonPosition|buttonShape|logoText|logoPosition|colorRegion|interfaceCount|interfacePosition|baseStructure|attachmentCount|packaging|proportion|other",
                    "target": "",
                    "value": None,
                    "evidenceRefs": [],
                    "sourceImages": [],
                    "sourceType": "visual|user_provided|inferred",
                    "visualProvable": True,
                    "severity": "critical|major|minor",
                    "tolerance": {"type": "exact|visual_match|approximate_ratio", "value": None},
                    "forbiddenChanges": [],
                }
            ],
            "references": [
                {
                    "imageId": "img_1",
                    "role": "master_structure|color_reference|logo_reference|detail_reference|packaging_reference|scene_reference",
                    "priority": "primary|secondary|supporting",
                    "regionResponsibilities": [
                        {"sourceRegion": "full_product", "regionBox": None, "useFor": [], "ignoreFor": []}
                    ],
                }
            ],
            "forbiddenGlobalChanges": [],
            "unresolvedIdentityFields": [],
        },
        "unknownFacts": [],
        "forbiddenClaims": [],
        "source": "live",
    }
    return f"""
任务：把“用户明确输入 + EvidenceBundleV2.1”融合成 ProductProfileV2 与 IdentityLockV2。

这不是营销文案任务。只做事实融合、证据归因和商品身份锁定。

用户输入：
{json.dumps(user_input, ensure_ascii=False)}

EvidenceBundleV2.1：
{json.dumps(evidence, ensure_ascii=False)}

硬规则：
1. 视觉事实必须能追溯到 EvidenceBundleV2.1 中的 imageId / partId / region；看不见的内容不得进入 confirmedFacts。
2. 用户明确提供的信息可进入 userClaims / parameters，但必须标 sourceType=user_provided；不得伪装成视觉事实。
3. inferred 只允许作为“待核实解释”，不得进入 confirmedFacts，也不得进入 IdentityLock.features。
4. visualProvable=true 仅用于画面可以直接证明的视觉事实；“轻巧、续航久、效果好、动力强、舒适、杀菌”等不能仅凭静态外观证明，必须为 false。
5. IdentityLock.features 只允许 sourceType=visual 且 visualProvable=true 的稳定视觉特征。用户主张不能进入 IdentityLock。
5A. SourceRole 是硬边界：只有 PRODUCT_TRUTH / PRODUCT_DETAIL / PACKAGING_TRUTH 可以进入商品事实与 IdentityLock；STYLE_REFERENCE / LAYOUT_REFERENCE / SCENE_REFERENCE 绝不能证明用户商品身份、材质、Logo、部件、参数或包装。
5B. surfaceAppearance 是视觉表面事实，可用于后续渲染，但不要把“哑光低反射外观”等视觉描述升级成未经证实的化学材质成分。creativeReferenceProfile 不进入商品事实，只供后续视觉导演学习构图/灯光/背景方法。
6. 按钮/接口/附件等数量只有在证据足够清晰时才能 exact 锁定；否则写 unresolvedIdentityFields。
7. 任何 conflict.resolution=requires_human 的字段不得进入 IdentityLock.features。
8. severity：会导致商品变成另一款/另一结构的字段用 critical；明显影响商品识别用 major；轻微表面差异用 minor。
9. reference responsibilities 必须说明每张图负责什么；regionBox 有可靠坐标就引用，没有就 null，禁止伪造坐标。
10. 包装/附件未在证据中确认时，明确写未确认，并加入 forbiddenClaims / forbiddenGlobalChanges，禁止后续模型凭空生成。
11. 不创造数字参数、认证、功效、材质成分、价格优惠、配件、包装内容。
12. 每条 evidence 必须给一个仅用于本次响应内部关联的 localKey（如 v1/u1）；IdentityLock.features.evidenceRefs 只引用这些 localKey。程序随后会把 localKey 映射成稳定 evidenceId，并重新分配 featureId。

输出严格 JSON，不要 Markdown，不要解释，符合：
{json.dumps(schema, ensure_ascii=False)}
""".strip()


def commerce_strategy_prompt(profile: dict, platform_rules: dict | None = None) -> str:
    schema = {
        "schemaVersion": "commerce-strategy.v2",
        "audience": [],
        "purchaseContext": [],
        "clickDrivers": [{"id": "", "statement": "", "evidenceRefs": [], "confidence": "high|medium|low"}],
        "trustDrivers": [{"id": "", "statement": "", "evidenceRefs": [], "confidence": "high|medium|low"}],
        "purchaseDrivers": [{"id": "", "statement": "", "evidenceRefs": [], "confidence": "high|medium|low"}],
        "objections": [],
        "evidenceAvailable": [],
        "evidenceMissing": [],
        "visualPositioning": {"tone": [], "avoid": []},
        "categoryVisualGrammar": {"presentationConventions": [], "searchThumbnailPriorities": [], "avoidCliches": []},
        "contentArchitecture": {"mainImages": [], "materials": [], "detailFlow": [], "videoObjective": ""},
        "masterSceneProposal": {
            "sceneContext": "",
            "background": "",
            "surface": "",
            "fixedElements": [],
            "lightingIntent": {"direction": "", "quality": "", "temperature": "neutral|neutral_warm|warm|cool"},
            "colorFamily": [],
            "depthSystem": "",
            "rationale": "",
        },
        "kpiTargets": [
            {"assetScope": "main|material|detail|video", "metric": "ctr|cvr|stay_time|3s_completion|information_clarity", "direction": "increase|decrease", "rationale": ""}
        ],
        "guardrails": [],
    }
    return f"""
任务：只建立 CommerceStrategyMap。先回答“为什么点、为什么信、为什么买”，不要设计具体单张图片和镜头。

ProductProfileV2：
{json.dumps(profile, ensure_ascii=False)}

PlatformRuleProfile：
{json.dumps(platform_rules or PDD_PLATFORM_RULES, ensure_ascii=False)}

商业规则：
- 策略必须建立在 confirmedFacts、userClaims、parameters 与 evidence 上；缺证据就明确 evidenceMissing。
- 用户主张可以成为 copy_support，但不能自动变成视觉证据。
- clickDrivers 负责货架识别与点击理由；trustDrivers 负责降低疑虑；purchaseDrivers 负责决策与收束，三者不能同义重复。
- kpiTargets 只定义优化方向和业务目的，不虚构真实历史 CTR/CVR 数值；没有基线就不要填数字。
- 移动端优先：信息密度必须适合手机快速浏览，商品识别优先于装饰。
- 视觉定位必须与商品证据兼容，禁止用风格化改变商品身份。
- categoryVisualGrammar 只总结“这个类目怎样更易读、更可信”的表现语法，不得当成拼多多官方规则，也不得补商品事实。searchThumbnailPriorities 要考虑手机端缩略图识别；avoidCliches 要明确本类目常见但低质量/同质化的表现。
- 主图、素材、详情、视频必须形成组合分工，而不是同一张图换背景。
- masterSceneProposal 必须由 ProductProfile 的商品用途/购买语境、CommerceStrategy 与 CreativeReferenceProfile 共同推导；它只定义“同一次拍摄发生在哪里”，不写镜头参数。
- 有 SCENE_REFERENCE 时优先继承其背景几何、承托面、光线和空间关系；没有参考场景时根据 purchaseContext 与商品用途设计一个具体、可重复的单一场景。只有证据不足才使用保守中性场景。
- masterSceneProposal 不得添加会被误认成商品附件/包装的道具；fixedElements 只允许低存在感环境元素。
- 不得出现具体机位角度、焦段、商品占比、安全区坐标；这些属于 Visual Director。masterSceneProposal.lightingIntent 只描述光向/质感/色温，不给相机参数。
- 不得创造未确认卖点、功效、包装、附件、认证和价格优惠。

输出严格 JSON，不要 Markdown，不要解释：
{json.dumps(schema, ensure_ascii=False)}
""".strip()


def asset_brief_batch_prompt(profile: dict, strategy: dict, batch: str, asset_ids: list[str], platform_rules: dict | None = None) -> str:
    typ = {"main": "main_image", "material": "asset_image", "detail": "detail_section", "video": "video"}[batch]
    schema = {
        "batch": batch,
        "items": [
            {
                "assetId": asset_ids[0] if asset_ids else "",
                "type": typ,
                "title": "",
                "priority": "primary|secondary|supporting",
                "businessPriority": "revenue_critical|conversion_critical|supporting",
                "conversionStage": "click|recognition|trust|understanding|decision|closing",
                "purpose": "",
                "goal": "",
                "visualRole": "",
                "detailRole": "",
                "proofIntent": None,
                "visualTask": "",
                "keyMessage": "",
                "evidenceUsage": [{"evidenceId": "", "purpose": "visual_proof|copy_support|identity_only"}],
                "requestedReferences": [{"purpose": "", "preferredRole": ""}],
                "safeAreaRequirement": {"required": True, "purpose": "title|subtitle|spec|cta|none"},
                "platformCompliance": {
                    "formalTextByProgram": True,
                    "forbidUnverifiedPriceOrPromo": True,
                    "forbidUnverifiedPackaging": True,
                    "mobileFirst": True,
                },
                "prohibitions": [],
                "qcFocus": [],
                "executionMode": "normal|neutral_fallback|blocked",
                "fallbackRule": {"when": [], "action": "neutral_fallback|human_review|blocked"},
            }
        ],
    }
    batch_goal = {
        "main": "3 张主图必须分别承担货架点击/识别、场景理解或信任、证据/决策中的互补任务；不能只是换背景。",
        "material": "4 张素材图用于建立可复用商品资产：基准外观、单一细节证据、使用关系、信息承载底图等；必须各自单一任务。",
        "detail": "6 个详情 Section 必须形成清晰信息节奏：认知→语境→证据→第二理由/降级→结构核对→规格与收束。具体语义由证据决定，不照抄模板。",
        "video": "1 条视频先定义商业目的、前3秒钩子目标、使用关系和证据节奏；此阶段不写 shots。",
    }[batch]
    return f"""
任务：基于 CommerceStrategyMap，为 {batch.upper()} 批次生成 AssetBriefV2。只规划当前批次，不处理其他资产。

当前批次 assetId 必须严格为：{asset_ids}

ProductProfileV2：
{json.dumps(profile, ensure_ascii=False)}

CommerceStrategyMap：
{json.dumps(strategy, ensure_ascii=False)}

PlatformRuleProfile：
{json.dumps(platform_rules or PDD_PLATFORM_RULES, ensure_ascii=False)}

批次业务目标：
{batch_goal}

本批次固定视觉角色契约（角色名与核心职责不得改写，只允许结合真实证据补充具体内容）：
{json.dumps({aid: visual_role_contract(aid) for aid in asset_ids}, ensure_ascii=False)}

硬规则：
- items 数量和 assetId 顺序必须与给定列表完全一致。
- 每个资产只表达一个核心信息、承担一个主要转化任务；不得把多个结构/卖点塞进一张图。
- visualRole/detailRole 必须遵守上面的固定视觉角色契约。尤其 detail_03=第一证据微距、detail_04=第二决策理由的中近景/完整关系、detail_05=完整结构核对；D3/D4/D5 禁止使用同一种画面语法。
- main_02 与 asset_03 都可以有使用关系，但必须是不同景别/角度/主体占比：一个是场景主图，一个是辅助使用素材，不能复制同一构图。
- proofIntent 与 keyMessage 分开。proofIntent 只有存在 visualProvable=true 的证据时才允许非空。
- evidenceUsage 只能引用 ProductProfileV2.evidence 里真实存在的 evidenceId。
- visualProvable=false 的证据只能 copy_support 或 identity_only，绝不能 visual_proof。
- requestedReferences 只说明“需要什么证据角色”，不直接猜 imageId。
- visualTask 只描述画面要完成的证明/展示任务，不写相机角度、光位、焦段和具体坐标。
- 没有第二卖点/包装/附件证据时必须 neutral_fallback 或 blocked，不得写“待确认”给生成模型。
- 正式中文、价格、参数、认证、促销文字由程序渲染；模型画面不承担这些文字。
- prohibitions 必须针对当前资产，不能只写泛泛的“不违规”。
- businessPriority 要体现重试优先级：搜索主图通常高于辅助素材，但必须结合本资产业务职责判断。
- 任何商品事实都必须有证据来源；不创造功效、参数、认证、包装、配件、优惠。

输出严格 JSON，不要 Markdown，不要解释：
{json.dumps(schema, ensure_ascii=False)}
""".strip()


def visual_director_batch_prompt(profile: dict, evidence: dict, strategy: dict, briefs: list[dict], batch: str, platform_rules: dict | None = None, master_scene_lock: dict | None = None) -> str:
    schema_item = {
        "assetId": briefs[0]["assetId"] if briefs else "",
        "referenceAssignments": [
            {
                "imageId": "img_1",
                "role": "master_structure|color_reference|logo_reference|detail_reference|packaging_reference|scene_reference",
                "priority": "primary|secondary|supporting",
                "regionResponsibilities": [
                    {"sourceRegion": "full_product", "regionBox": None, "useFor": [], "ignoreFor": []}
                ],
            }
        ],
        "visualSpec": {
            "camera": {
                "shot": "extreme_closeup|closeup|medium_closeup|medium|full_product|wide",
                "height": "low|slight_low|eye_level|slight_high|high|top_down",
                "horizontalAngleDeg": 0,
                "verticalAngleDeg": 0,
                "focalLengthFeel": "macro|wide_35mm|normal_50mm|product_85mm",
                "perspective": "neutral|mild|strong",
                "perspectiveStrength": "none|mild|strong",
                "distortionAllowed": False,
            },
            "product": {
                "facing": "front|three_quarter_left|three_quarter_right|left_side|right_side|back",
                "rotationAxis": "none|vertical|horizontal",
                "rotationDeg": 0,
                "tiltDeg": 0,
                "occupancyPct": 60,
                "anchor": {"xPct": 50, "yPct": 50},
                "crop": "full|allowed_minor|intentional_detail",
                "cropTargets": [],
                "cropBoundary": {"top": "keep|cut_allowed|must_cut", "bottom": "keep|cut_allowed|must_cut", "left": "keep|cut_allowed|must_cut", "right": "keep|cut_allowed|must_cut"},
            },
            "composition": {"layout": "", "negativeSpace": "", "visualHierarchy": []},
            "depth": {"depthOfField": "deep|medium|shallow", "foreground": "none|clean|blurred_prop", "backgroundDepth": "flat|soft_depth|environment_depth"},
            "environment": {"background": "", "surface": "", "sceneLogic": ""},
            "lighting": {"key": "", "fill": "", "rim": "", "direction": "", "temperature": "cool|neutral|warm", "contrast": "low|medium|high", "highlightControl": ""},
            "human": {"allowed": False, "scope": "none|hand_only|upper_body|full_body", "action": "", "handPosition": "", "gripPoint": ""},
            "props": [{"name": "", "position": "", "size": "small|medium|large", "material": "", "purpose": ""}],
            "safeAreas": [{"purpose": "title|subtitle|price|spec|cta", "xPct": 70, "yPct": 0, "widthPct": 30, "heightPct": 100, "cleanliness": "strict|moderate"}],
            "layers": {"background": "back", "product": "front", "props": [], "overlays": [], "safeAreaLayer": "above_all"},
            "colorDirection": {"temperature": "cool|neutral|warm", "contrast": "low|medium|high", "saturation": "low|medium|high", "backgroundPalette": []},
            "output": {"aspectRatio": "1:1", "recommendedSize": "2048x2048"},
        },
        "negative": [],
        "qcChecklist": [],
    }
    return f"""
任务：把当前 {batch.upper()} 批次已批准的 AssetBriefV2 转成 ReferenceAssignmentV2 + VisualSpecV2。
你是视觉执行导演，不写最终 Prompt，不创造商品事实，不改变业务目标。

ProductProfileV2：
{json.dumps(profile, ensure_ascii=False)}

EvidenceBundleV2.1：
{json.dumps(evidence, ensure_ascii=False)}

CommerceStrategyMap：
{json.dumps(strategy, ensure_ascii=False)}

当前批次 AssetBriefV2：
{json.dumps(briefs, ensure_ascii=False)}

PlatformRuleProfile：
{json.dumps(platform_rules or PDD_PLATFORM_RULES, ensure_ascii=False)}

MasterSceneLockV1：
{json.dumps(master_scene_lock or {}, ensure_ascii=False)}

当前批次固定视觉角色契约：
{json.dumps({b.get("assetId"): visual_role_contract(b.get("assetId")) for b in briefs}, ensure_ascii=False)}

硬规则：
- 每个 brief 必须一一输出一个 item，assetId 不得改变。
- MasterSceneLockV1 是场景连续性的权威来源：除 catalog_exempt 资产外，场景型主图/场景素材必须使用同一 sceneContext、surface、background 和主光方向；细节/规格资产只能从同一母场景裁切、虚化或低纹理化，不得重新发明另一套厨房/房间/桌面/窗户方向。
- main_01 或明确白底/packshot/目录型资产允许 catalog_exempt；豁免只针对物理背景，不豁免商品颜色、材质和整套光线语法。
- referenceAssignments 只能引用 ProductProfile.identityLock.references / EvidenceBundle 中真实存在的 imageId。
- 必须尊重 sourceRole：PRODUCT_TRUTH / PRODUCT_DETAIL / PACKAGING_TRUTH 只能承担商品事实、结构、颜色、表面外观职责；STYLE_REFERENCE / LAYOUT_REFERENCE / SCENE_REFERENCE 只能承担摄影风格、构图、背景、光线、空间、道具或留白职责。严禁让创意参考图承担 identity/structure/logo/material truth。
- 若 brief 需要商品参考而没有 PRODUCT_TRUTH / PRODUCT_DETAIL / PACKAGING_TRUTH 可用，必须 executionMode=blocked，不得用 STYLE_REFERENCE 顶替商品事实。
- regionResponsibilities 尽量复用真实 evidence boundingBox；无可靠区域坐标时 regionBox=null，禁止伪精确。
- 一张图一个视觉任务。结构细节资产只能聚焦一个核心结构或紧密相连的一组结构。
- 固定视觉角色契约是相机/景别差异的最低约束：Visual Director 只能在其基础上优化构图、道具与安全区，不能把不同 assetId 再收敛成相同 closeup/macro。
- detail_03 必须是主证据微距；detail_04 必须回到中近景/半完整商品承载第二决策理由；detail_05 必须完整商品结构核对。三者禁止相同 shot/focalLengthFeel/crop/occupancy 组合。
- main_02 与 asset_03 即使都有人手使用，也必须采用不同角度、景别和主体占比。
- 相机、商品姿态、主体占比、anchor、安全区、裁切边界必须明确；不要使用“合适角度”“自然构图”“高级感”等不可执行描述。
- 商品保真优先于风格：不允许广角/夸张透视导致商品变形；默认 distortionAllowed=false。
- 人物/手部必须提前决定。若 hand_only，必须写 handPosition 与 gripPoint；不能写“人物或手部”。
- 道具必须有业务作用，数量从少，不能遮挡关键结构；无必要就 props=[]。
- 包装/附件未确认时不得出现在 props/environment/composition 中。
- safeAreas 使用 0–100 坐标矩形；strict 区域必须保持低纹理、低对比、无遮挡，供程序排版。
- 移动端优先：搜索主图商品识别强，详情页保持纵向信息节奏，不要让商品在手机上过小。
- 灯光必须利于真实材质和轮廓辨识：控制高光、避免过曝、避免彩色光污染商品真实颜色。
- output.recommendedSize 只给建议尺寸，不假定所有模型都支持；ModelAdapter 决定最终能力降级。
- 所有 qcChecklist 必须能从 IdentityLock / VisualSpec 逐项检查。

输出严格 JSON，不要 Markdown，不要解释：
{{"batch":"{batch}","items":[{json.dumps(schema_item, ensure_ascii=False)}]}}
""".strip()


def video_director_prompt(profile: dict, evidence: dict, strategy: dict, brief: dict, platform_rules: dict | None = None) -> str:
    schema = {
        "assetId": "video_01",
        "durationSec": 10,
        "aspectRatio": "9:16",
        "hook": {"shotId": "s1", "type": "product_reveal|problem_context|motion|detail_proof", "mustShowProduct": True, "goal": ""},
        "pacingCurve": [{"shotId": "s1", "intensity": "low|medium|high"}],
        "shots": [
            {
                "shotId": "s1",
                "startSec": 0,
                "endSec": 2,
                "purpose": "",
                "referenceImages": ["img_1"],
                "subject": "full_product|head|button|detail|hand_product|other",
                "camera": {
                    "shot": "closeup|medium_closeup|medium|full_product|macro",
                    "height": "low|slight_low|eye_level|slight_high|high|top_down",
                    "horizontalAngleDeg": 0,
                    "movement": "static|push_in|pull_out|pan_left|pan_right|orbit|tilt",
                    "movementAmount": "micro|small|medium",
                    "speed": "slow|medium",
                },
                "product": {"facing": "front|three_quarter_left|three_quarter_right|left_side|right_side|back", "occupancyPct": 65, "allowedMotion": []},
                "action": "",
                "human": {"allowed": False, "scope": "none|hand_only|upper_body|full_body", "action": "", "handPosition": "", "gripPoint": ""},
                "identityLocks": [],
                "forbiddenChanges": [],
                "transitionOut": "cut|match_cut|fade",
            }
        ],
        "audioPlan": {
            "bgm": {"required": True, "style": "", "bpmRange": [90, 110]},
            "voiceover": {"required": False, "script": None},
            "sfx": [],
        },
        "negative": [],
        "qcChecklist": [],
    }
    return f"""
任务：把 video_01 AssetBriefV2 转成 VideoPlanV2。必须输出真正的 shots[]，不能输出一段 motion 文案。

ProductProfileV2：
{json.dumps(profile, ensure_ascii=False)}

EvidenceBundleV2.1：
{json.dumps(evidence, ensure_ascii=False)}

CommerceStrategyMap：
{json.dumps(strategy, ensure_ascii=False)}

Video AssetBriefV2：
{json.dumps(brief, ensure_ascii=False)}

PlatformRuleProfile：
{json.dumps(platform_rules or PDD_PLATFORM_RULES, ensure_ascii=False)}

硬规则：
- 总时长 8–12 秒，shot 时间必须连续、无重叠、覆盖整个 durationSec。
- 前 3 秒必须建立 hook，且 hook.mustShowProduct=true；不能只拍无关环境。
- 每镜只承担一个主要任务：识别、使用关系、证据、收束等。
- 每镜 referenceImages 只能引用真实存在的 imageId；优先任务相关参考，不默认塞所有图。
- 每镜必须明确商品朝向、画面占比、允许运动、相机运动、人物/手部规则、IdentityLock featureId。
- 运动幅度以微动/小幅为主，商品保真高于炫技；禁止大幅旋转导致 Logo/组件漂移，禁止不可解释形变。
- 使用动作必须符合真实物理关系；手部出现时写清持握点，不能遮挡关键身份结构。
- 不得生成未经确认的功效、包装、附件、文字、价格、认证、促销。
- pacingCurve 要有起伏：Hook 高/中强度，证据镜头可放慢，结尾稳定收束；避免全程同一节奏。
- audioPlan 只给后期编辑方向。若没有可靠口播文案，voiceover.required=false，不让视频模型直接生成中文口播内容。
- shots 为空或任何时间段无法合理执行时，不得给默认 fallback，应在 negative/qcChecklist 中说明并让上游 blocked/human_review。

输出严格 JSON，不要 Markdown，不要解释：
{json.dumps(schema, ensure_ascii=False)}
""".strip()


def _format_reference(ref: dict) -> str:
    role = ref.get("role") or "supporting_reference"
    priority = ref.get("priority") or "supporting"
    rr = ref.get("regionResponsibilities") or []
    segments = []
    for region in rr:
        name = region.get("sourceRegion") or "指定区域"
        box = region.get("regionBox")
        box_text = ""
        if isinstance(box, dict):
            box_text = f"@{box.get('xPct')},{box.get('yPct')},{box.get('widthPct')},{box.get('heightPct')}%"
        use = ",".join(region.get("useFor") or []) or "task_reference"
        ignore = ",".join(region.get("ignoreFor") or []) or "none"
        segments.append(f"{name}{box_text}: use={use}; ignore={ignore}")
    detail = " | ".join(segments) or "task_reference"
    return f"{role}/{priority}: {detail}"


def _identity_lines(profile: dict) -> tuple[list[str], list[str], list[str]]:
    lock = profile.get("identityLock") or {}
    critical: list[str] = []
    major: list[str] = []
    minor: list[str] = []
    for feat in lock.get("features") or []:
        value = feat.get("value")
        target = feat.get("target") or feat.get("field")
        line = f"{target}={json.dumps(value, ensure_ascii=False)}"
        sev = feat.get("severity")
        (critical if sev == "critical" else major if sev == "major" else minor).append(line)
    return critical, major, minor


def _brief_evidence(profile: dict, brief: dict) -> tuple[list[dict], list[dict]]:
    by_id = {e.get("evidenceId"): e for e in profile.get("evidence") or [] if e.get("evidenceId")}
    visual: list[dict] = []
    copy: list[dict] = []
    usage = brief.get("evidenceUsage") or []
    for u in usage:
        e = by_id.get(u.get("evidenceId"))
        if not e:
            continue
        if u.get("purpose") == "visual_proof" and e.get("visualProvable") is True:
            visual.append(e)
        elif u.get("purpose") in {"copy_support", "identity_only"}:
            copy.append(e)
    return visual, copy


def _safe_area_text(areas: list[dict]) -> str:
    if not areas:
        return "不预留正式文字区；画面保持主体清晰。"
    parts = []
    for a in areas:
        parts.append(
            f"{a.get('purpose','文字')} 区域 x={a.get('xPct')}%, y={a.get('yPct')}%, w={a.get('widthPct')}%, h={a.get('heightPct')}%，"
            f"清洁度={_cn(a.get('cleanliness'), {'strict':'严格干净','moderate':'适度干净'})}"
        )
    return "；".join(parts) + "。这些区域保持低纹理、低对比、无遮挡，供程序后期排版。"


def _generation_size(aspect: str) -> str:
    mapping = {
        "1:1": "2048x2048",
        "3:4": "1536x2048",
        "4:3": "2048x1536",
        "9:16": "1440x2560",
        "16:9": "2560x1440",
    }
    return mapping.get(aspect or "", "2048x2048")




def _cn(value: Any, mapping: dict[str, str]) -> str:
    key = str(value or "")
    return mapping.get(key, key)


def _camera_cn(camera: dict) -> tuple[str, str, str, str]:
    return (
        _cn(camera.get("shot"), {"extreme_closeup":"极近微距","closeup":"近景","medium_closeup":"中近景","medium":"中景","full_product":"完整商品展示","wide":"广景","macro":"微距"}),
        _cn(camera.get("height"), {"low":"低机位","slight_low":"轻微低机位","eye_level":"平视机位","slight_high":"轻微高机位","high":"高机位","top_down":"俯拍"}),
        _cn(camera.get("focalLengthFeel"), {"macro":"微距镜头感","wide_35mm":"35mm轻广角镜头感","normal_50mm":"50mm自然镜头感","product_85mm":"85mm商品摄影镜头感"}),
        _cn(camera.get("perspective"), {"neutral":"自然透视","mild":"轻微透视","strong":"强透视"}),
    )


def _facing_cn(value: str) -> str:
    return _cn(value, {"front":"正面朝向镜头","three_quarter_left":"左前3/4朝向","three_quarter_right":"右前3/4朝向","left_side":"左侧面","right_side":"右侧面","back":"背面"})


def _quality_guidance(brief: dict, spec: dict) -> str:
    typ = brief.get("type")
    shot = ((spec.get("camera") or {}).get("shot") or "")
    if typ == "main_image":
        return "这是搜索货架/主图级资产：缩略图下轮廓必须一眼清楚，商品与背景有明确分离，避免小碎道具、复杂纹理和过多装饰；画面第一视觉必须是商品本体。"
    if typ == "detail_section":
        return "这是纵向详情页模块：视觉重点要能承接上下文信息节奏，主体、证据与留白形成清楚层级；同一套详情页保持统一色温、材质表现和商业摄影语法。"
    if shot in {"closeup", "extreme_closeup", "macro"}:
        return "这是证据型细节资产：目标结构必须处于清晰焦点，边缘、连接关系和数量可核对；浅景深只能弱化非目标区域，不能把证据部位虚化。"
    return "这是可复用商品素材：画面干净、结构准确、商业摄影质感稳定，避免一次性噱头和会妨碍后续排版/裁切的复杂装饰。"

def evaluate_prompt_readiness(profile: dict, mode: str = "live") -> dict:
    """Judge whether a production prompt has enough product-specific visual truth.

    This intentionally does not score aesthetics. It only prevents a seemingly
    rich production prompt from being compiled when the product evidence layer
    is effectively empty.
    """
    refs = (profile.get("identityLock") or {}).get("references") or []
    fact_refs = [r for r in refs if (r.get("sourceRole") or "PRODUCT_TRUTH") in PRODUCT_FACT_SOURCE_ROLES]
    confirmed = [str(x).strip() for x in (profile.get("confirmedFacts") or []) if str(x).strip()]
    identity = [x for x in ((profile.get("identityLock") or {}).get("features") or []) if isinstance(x, dict)]
    surfaces = [x for x in (profile.get("surfaceAppearance") or []) if isinstance(x, dict)]
    blockers: list[str] = []
    warnings: list[str] = []
    if mode == "demo":
        return {
            "schemaVersion":"prompt-readiness.v1", "status":"PREVIEW_ONLY",
            "counts":{"productFactReferences":len(fact_refs),"confirmedVisualFacts":len(confirmed),"identityFeatures":len(identity),"surfaceAppearance":len(surfaces)},
            "blockers":[], "warnings":["Demo/Preview 未执行生产级视觉证据识别；不可据此评价最终生图质量。"],
        }
    if not fact_refs:
        blockers.append("没有 PRODUCT_TRUTH / PRODUCT_DETAIL / PACKAGING_TRUTH 商品事实参考图")
    if len(confirmed) + len(identity) + len(surfaces) == 0:
        blockers.append("商品视觉证据为空：confirmedFacts / IdentityLock / SurfaceAppearance 均不可用")
    if not identity:
        warnings.append("IdentityLock.features 为空，商品结构保真能力较弱")
    if not surfaces:
        warnings.append("SurfaceAppearance 为空，材质/表面表现只能保守依赖参考图")
    if not confirmed:
        warnings.append("confirmed visual facts 为空，资产级 visual_proof 可用信息有限")
    status = "BLOCKED" if blockers else "WARNING" if warnings else "PASS"
    return {
        "schemaVersion":"prompt-readiness.v1", "status":status,
        "counts":{"productFactReferences":len(fact_refs),"confirmedVisualFacts":len(confirmed),"identityFeatures":len(identity),"surfaceAppearance":len(surfaces)},
        "blockers":blockers, "warnings":warnings,
    }


def _product_evidence_summary_lines(profile: dict) -> list[str]:
    lines: list[str] = []
    facts = [str(x).strip() for x in (profile.get("confirmedFacts") or []) if str(x).strip()]
    if facts:
        lines.append("Confirmed visual facts: " + "；".join(facts[:10]) + "。")
    features = (profile.get("identityLock") or {}).get("features") or []
    if features:
        compact = []
        for f in features[:10]:
            compact.append(f"{f.get('target') or f.get('field')}={json.dumps(f.get('value'), ensure_ascii=False)} [{f.get('severity') or 'major'}]")
        lines.append("Identity features: " + "；".join(compact) + "。")
    surfaces = profile.get("surfaceAppearance") or []
    if surfaces:
        compact = []
        for x in surfaces[:8]:
            compact.append(f"{x.get('targetPartId') or 'visible region'}:{x.get('appearanceClass')}/{x.get('finish')}, reflectance={x.get('reflectance')}, transparency={x.get('transparency')}")
        lines.append("Surface appearance: " + "；".join(compact) + "。")
    if not lines:
        lines.append("No production-grade visual evidence available; do not substitute category conventions for product truth.")
    return lines


def _surface_render_lines(profile: dict, refs: list[dict]) -> list[str]:
    selected = {r.get("imageId") for r in refs if r.get("imageId")}
    surfaces = profile.get("surfaceAppearance") or []
    if selected:
        scoped = [x for x in surfaces if x.get("imageId") in selected]
        if scoped:
            surfaces = scoped
    lines: list[str] = []
    for item in surfaces[:8]:
        target = item.get("targetPartId") or "可见商品区域"
        parts = [
            str(item.get('appearanceClass') or 'unknown'),
            str(item.get('finish') or 'unknown'),
            f"{item.get('reflectance') or 'unknown'} reflectance",
            str(item.get('transparency') or 'unknown'),
            str(item.get('edgeCharacter') or 'unknown') + " edges",
        ]
        if item.get("texture"):
            parts.append(str(item.get("texture")))
        if item.get("microDetail"):
            parts.append(str(item.get("microDetail")))
        lines.append(f"{item.get('imageId')} / {target}: " + ", ".join(parts) + ".")
    return lines


def _creative_reference_blocks(profile: dict, refs: list[dict]) -> list[str]:
    selected = {r.get("imageId") for r in refs if r.get("imageId")}
    profiles = profile.get("creativeReferenceProfiles") or []
    if selected:
        scoped = [x for x in profiles if x.get("imageId") in selected]
        if scoped:
            profiles = scoped
    out: list[str] = []
    for item in profiles[:3]:
        p = item.get("profile") or {}
        extras = []
        if p.get("surfaceSystem"):
            extras.append(f"surface={p.get('surfaceSystem')}")
        if p.get("propSystem"):
            extras.append(f"props={p.get('propSystem')}")
        if p.get("depthPattern"):
            extras.append(f"depth={p.get('depthPattern')}")
        suffix = "；".join(extras) if extras else "视觉方法已编译进 Style Lock"
        out.append(f"{item.get('imageId')} / {item.get('sourceRole')}：{suffix}。")
    return out


def compile_image_prompt_package(project: dict, profile: dict, brief: dict, directed: dict, upstream_hash: str, style_lock: dict | None = None, master_scene_lock: dict | None = None) -> dict:
    """Compile one image asset into an execution-oriented commercial shot brief.

    Upstream models decide facts and visual specifications. This compiler is
    deterministic: it only restructures those decisions, adds category craft
    guidance, and makes preserve/restriction boundaries explicit.
    """
    master_scene_lock = master_scene_lock or build_master_scene_lock(project, profile, ((project.get("creative_plan") or {}).get("strategy") or {}))
    spec = apply_visual_role_contract(brief, directed.get("visualSpec") or {})
    spec = apply_master_scene_to_visual_spec(brief, spec, master_scene_lock)
    refs = directed.get("referenceAssignments") or directed.get("referenceMap") or []
    visual_ev, copy_ev = _brief_evidence(profile, brief)
    critical, major, minor = _identity_lines(profile)
    lock = profile.get("identityLock") or {}
    global_forbidden = lock.get("forbiddenGlobalChanges") or []
    negatives = list(dict.fromkeys(
        (brief.get("prohibitions") or brief.get("negative") or [])
        + (directed.get("negative") or [])
        + global_forbidden
    ))

    style_lock = style_lock or build_campaign_style_lock(project, profile, ((project.get("creative_plan") or {}).get("strategy") or {}))
    craft = category_render_guide(project, profile)
    scaffold = asset_scaffold(brief, spec)

    camera = spec.get("camera") or {}
    product = spec.get("product") or {}
    composition = spec.get("composition") or {}
    depth = spec.get("depth") or {}
    env = spec.get("environment") or {}
    light = spec.get("lighting") or {}
    human = spec.get("human") or {}
    props = spec.get("props") or []
    safe_areas = spec.get("safeAreas") or []
    color = spec.get("colorDirection") or {}
    output = spec.get("output") or {}
    aspect = output.get("aspectRatio") or "1:1"

    def block(title: str, lines: list[str]) -> str:
        clean = [str(x).strip() for x in lines if str(x or "").strip()]
        return f"[{title}]\n" + "\n".join(clean)

    sections: list[str] = []
    sections.append(block("ASSET ROLE", [
        f"拼多多移动端电商｜{scaffold.get('role')}｜{brief.get('title') or brief.get('assetId')}。",
        f"唯一主要任务：{scaffold.get('goal')}。商品真实性与可识别性优先。",
    ]))

    business_lines = [
        f"Goal: {brief.get('goal') or brief.get('purpose') or '准确展示商品'}；visual task: {brief.get('visualTask') or brief.get('visualIntent') or brief.get('keyMessage') or '准确展示商品'}。",
    ]
    if brief.get("proofIntent"):
        business_lines.append(f"证据任务：{brief.get('proofIntent')}。只证明这一项，不扩展成功效、性能或参数结论。")
    business_lines += ["本资产必须满足：" + "；".join(scaffold.get("must") or []) + "。"]
    sections.append(block("BUSINESS GOAL", business_lines))
    role_contract = visual_role_contract(brief.get("assetId"))
    if role_contract:
        sections.append(block("VISUAL ROLE CONTRACT", [
            f"visualRole={role_contract.get('visualRole')}；detailRole={role_contract.get('detailRole') or 'n/a'}。",
            f"不可替换的画面职责：{role_contract.get('purpose')}。",
            "这一职责优先于通用类目模板；禁止与其他 assetId 收敛成同一景别/焦段/裁切组合。",
        ]))

    sections.append(block("CAMPAIGN STYLE LOCK", style_lock_lines(style_lock)))

    scene_policy = scene_policy_for_asset(brief, spec)
    sections.append(block("MASTER SCENE LOCK", master_scene_lines(master_scene_lock, scene_policy)))

    creative_lines = _creative_reference_blocks(profile, refs)
    if creative_lines:
        sections.append(block("CREATIVE REFERENCE PROFILE", creative_lines + [
            "只迁移视觉方法；禁止继承参考图的商品、品牌、Logo、包装、文字、参数或卖点。"
        ]))

    truth_lines = [f"商品：{profile.get('productName') or project.get('name')}。"]
    if visual_ev:
        truth_lines.append("画面允许直接证明：" + "；".join(e.get("fact", "") for e in visual_ev if e.get("fact")) + "。")
    else:
        truth_lines.append("无额外 visual_proof；只展示已锁定身份，不补事实。")
    if copy_ev:
        truth_lines.append("仅允许用于后期文案、不得由画面伪造：" + "；".join(e.get("fact", "") for e in copy_ev if e.get("fact")) + "。")
    sections.append(block("PRODUCT TRUTH", truth_lines))
    sections.append(block("PRODUCT EVIDENCE SUMMARY", _product_evidence_summary_lines(profile)))

    if refs:
        ref_lines = []
        for idx, ref in enumerate(refs, 1):
            ref_lines.append(f"Image {idx} / {ref.get('imageId')} / SourceRole={ref.get('sourceRole') or 'PRODUCT_TRUTH'}：{_format_reference(ref)}。只承担声明的 useFor；ignoreFor 中的内容不得继承。")
        ref_lines.append("事实图负责商品；创意参考只负责视觉方法。禁止继承参考案例的商品、品牌、文字、参数。")
    else:
        ref_lines = ["本资产未分配商品参考图。不得暗中使用其他源图补位；若当前执行模式要求参考图，应在生成前阻塞。"]
    sections.append(block("REFERENCE ROLES", ref_lines))

    preserve_critical = critical or ["没有可用 critical IdentityLock；不得把未知字段当成已确认事实"]
    sections.append(block("IDENTITY PRESERVE — CRITICAL", preserve_critical + ["只允许改变 VisualSpec 明确允许改变的环境、构图或非商品元素；不得重新设计商品。"]))
    if major:
        sections.append(block("IDENTITY PRESERVE — MAJOR", major))
    if minor:
        sections.append(block("IDENTITY PRESERVE — MINOR", minor))

    shot_cn, height_cn, focal_cn, perspective_cn = _camera_cn(camera)
    rotation_axis_cn = _cn(product.get("rotationAxis"), {"none":"不主动旋转","vertical":"绕垂直轴","horizontal":"绕水平轴"})
    crop_cn = _cn(product.get("crop"), {"full":"完整保留商品，不裁切关键结构","allowed_minor":"允许轻微裁切非关键边缘","intentional_detail":"有意裁切，只呈现当前证据部位"})
    sections.append(block("SHOT BRIEF", [
        f"{shot_cn}，{height_cn}，水平 {camera.get('horizontalAngleDeg',0)}° / 垂直 {camera.get('verticalAngleDeg',0)}°，{focal_cn}，{perspective_cn}。",
        f"商品：{_facing_cn(product.get('facing','front'))}，{rotation_axis_cn}，旋转 {product.get('rotationDeg',0)}°，倾斜 {product.get('tiltDeg',0)}°；occupancy {product.get('occupancyPct',60)}%；anchor ({((product.get('anchor') or {}).get('xPct',50))}%, {((product.get('anchor') or {}).get('yPct',50))}%)。",
        f"Crop: {crop_cn}；top/bottom/left/right={((product.get('cropBoundary') or {}).get('top','keep'))}/{((product.get('cropBoundary') or {}).get('bottom','keep'))}/{((product.get('cropBoundary') or {}).get('left','keep'))}/{((product.get('cropBoundary') or {}).get('right','keep'))}。",
    ]))

    sections.append(block("COMPOSITION", [
        f"Layout: {composition.get('layout','主体优先、信息层级清楚')}；negative space: {composition.get('negativeSpace','按文字安全区留白')}。",
        "Hierarchy: " + " > ".join(composition.get("visualHierarchy") or ["商品主体", "辅助环境"]) + "；商品始终为第一视觉。",
    ]))

    actual_surface_lines = _surface_render_lines(profile, refs)
    if actual_surface_lines:
        material_lines = ["以下为当前商品从事实参考图提取的可见表面外观，优先级高于通用类目经验："] + actual_surface_lines
        material_lines += [
            "严格按这些可见表面特征控制高光、反射、透明度、纹理和边缘；不要把视觉外观升级成未经证实的化学材质成分。",
            "商品自身颜色必须忠于事实参考图；保持自然接触阴影，商品不得漂浮。",
        ]
    else:
        material_lines = [
            "当前没有可用的 Surface Appearance 证据；不要猜具体材质成分。",
            *list(craft.get("materialCues") or [])[:2],
            "只按可见参考图控制表面反射、边缘和接触阴影；未知材质不命名、不升级。",
        ]
    sections.append(block("MATERIAL RENDERING", material_lines))

    lighting_lines = [
        f"Key: {light.get('key') or craft.get('lighting')}；fill: {light.get('fill','轻柔补光')}；rim: {light.get('rim','克制')}。",
        f"Direction: {light.get('direction','前上方')}；temperature: {_cn(light.get('temperature'), {'cool':'偏冷','neutral':'中性','warm':'偏暖'})}；contrast: {_cn(light.get('contrast'), {'low':'低对比','medium':'中等对比','high':'高对比'})}；highlight: {light.get('highlightControl','受控高光')}。",
    ]
    sections.append(block("LIGHTING", lighting_lines))

    prop_text: list[str] = []
    for p in props:
        if isinstance(p, dict):
            prop_text.append(f"{p.get('name')}｜位置={p.get('position')}｜大小={p.get('size')}｜用途={p.get('purpose')}")
        else:
            prop_text.append(str(p))
    sections.append(block("ENVIRONMENT & PROPS", [
        f"Background: {env.get('background','干净中性商业摄影背景')}；surface: {env.get('surface','简洁真实承托面')}；logic: {env.get('sceneLogic','环境只服务商品')}。",
        f"Depth: {_cn(depth.get('depthOfField'), {'deep':'深景深','medium':'中等景深','shallow':'浅景深'})}；foreground={_cn(depth.get('foreground'), {'none':'无前景遮挡','clean':'干净前景','blurred_prop':'轻虚化前景道具'})}；background={_cn(depth.get('backgroundDepth'), {'flat':'平整低层次','soft_depth':'柔和层次','environment_depth':'真实纵深'})}。",
        (("Props: " + "；".join(prop_text) + "。") if prop_text else "Props: none."),
        "道具不得遮挡商品身份结构或安全区。",
    ]))

    if human.get("allowed"):
        human_lines = [
            f"只允许：{human.get('scope')}。",
            f"动作：{human.get('action')}；手部位置：{human.get('handPosition')}；持握点：{human.get('gripPoint')}。",
            "人物/手部只用于解释真实使用关系，不得自由增加动作，不得遮挡关键身份结构。",
        ]
    else:
        human_lines = ["不出现人物、手部、人脸或人体局部。"]
    sections.append(block("HUMAN RULE", human_lines))

    sections.append(block("SAFE AREA", ["文字安全区：" + _safe_area_text(safe_areas)]))

    sections.append(block("POST-RENDER POLICY", [
        "图片模型只生成视觉底图。正式中文、价格、参数、尺寸、认证、促销全部由程序后期渲染；保留商品原包装已有文字。",
        "禁止新增可读卖点/参数/促销/二维码/水印；禁止把视觉估算当真实规格。",
    ]))

    quality = _quality_guidance(brief, spec)
    quality_lines = [
        quality,
        f"Color: {_cn(color.get('temperature'), {'cool':'偏冷','neutral':'中性','warm':'偏暖'})} / {_cn(color.get('contrast'), {'low':'低对比','medium':'中等对比','high':'高对比'})} / {_cn(color.get('saturation'), {'low':'低饱和','medium':'中等饱和','high':'高饱和'})}；结构清楚、材质可信、移动端可读。",
        f"Output: {aspect}, {output.get('recommendedSize') or _generation_size(aspect)}。",
    ]
    sections.append(block("QUALITY TARGET", quality_lines))

    standard_negative = [
        "改变商品轮廓或比例", "重新设计商品", "改变 Logo 内容或位置", "改变按钮/接口/组件数量或位置",
        "凭空新增包装、附件、配件或不存在的结构", "重复商品、双主体、产品融合",
        "商品弯曲、断裂、融化、拉伸、悬浮或非物理形变", "错误文字、乱码、水印、二维码、价格、促销、认证、参数文字",
        "彩色光污染导致商品真实颜色改变", "过曝高光、脏污阴影、廉价塑料质感、不真实反射",
        "复杂背景、强纹理、装饰物遮挡商品或文字安全区", "无证据的医疗/功效/性能可视化",
    ]
    standard_negative.extend(scaffold.get("avoid") or [])
    standard_negative.extend(craft.get("avoid") or [])
    if not human.get("allowed"):
        standard_negative += ["人物", "手部", "人脸"]
    negatives = list(dict.fromkeys(standard_negative + [str(x) for x in negatives if str(x).strip()]))

    positive_prompt = "\n\n".join(sections)
    negative_prompt = "；".join(negatives)
    final_prompt = positive_prompt + "\n\n[STRICT NEGATIVE CONSTRAINTS]\n" + negative_prompt + "。"

    # safeAreas are composition constraints. They are not an API mask.
    requested_capabilities = {
        "referenceImage": bool(refs),
        "multiReference": len(refs) > 1,
        "mask": False,
        "seed": False,
    }
    package = {
        "assetId": brief.get("assetId"),
        "modelRole": "image",
        "promptCompilerVersion": "prompt-compiler.v2.4",
        "promptReadiness": evaluate_prompt_readiness(profile, project.get("mode") or "live"),
        "visualRoleContract": role_contract,
        "scaffold": scaffold,
        "styleLock": style_lock,
        "masterSceneLock": master_scene_lock,
        "scenePolicy": scene_policy,
        "visualSpec": spec,
        "positivePrompt": positive_prompt,
        "negativePrompt": negative_prompt,
        "references": refs,
        "requestedCapabilities": requested_capabilities,
        "generationParams": {"aspectRatio": aspect, "size": output.get("recommendedSize") or _generation_size(aspect)},
        "qcContract": directed.get("qcChecklist") or brief.get("qcFocus") or [],
        "provenance": {
            "evidenceIds": [u.get("evidenceId") for u in brief.get("evidenceUsage") or [] if u.get("evidenceId")],
            "identityFeatureIds": [f.get("featureId") for f in lock.get("features") or [] if f.get("featureId")],
            "assetBriefVersion": "asset-brief.v2",
            "visualSpecVersion": "visual-spec.v2",
            "styleLockVersion": "campaign-style-lock.v1.1",
            "masterSceneLockVersion": "master-scene-lock.v1",
            "upstreamHash": upstream_hash,
            "compiledAt": utc_now(),
        },
        "finalPrompt": final_prompt,
    }
    package["provenance"]["contentHash"] = canonical_hash({
        "assetId": package["assetId"], "positivePrompt": package["positivePrompt"], "negativePrompt": package["negativePrompt"],
        "references": package["references"], "requestedCapabilities": requested_capabilities,
        "generationParams": package["generationParams"], "qcContract": package["qcContract"], "upstreamHash": upstream_hash,
    })
    return package

def compile_video_prompt_package(project: dict, profile: dict, brief: dict, video_plan: dict, upstream_hash: str) -> dict:
    lock = profile.get("identityLock") or {}
    critical, major, _ = _identity_lines(profile)
    shots = video_plan.get("shots") or []
    if not shots:
        raise ValueError("VideoPlanV2.shots 为空：禁止使用隐藏 fallback 视频模板")

    ref_ids: list[str] = []
    for shot in shots:
        for rid in shot.get("referenceImages") or []:
            if rid and rid not in ref_ids:
                ref_ids.append(rid)
    profile_refs = {r.get("imageId"): r for r in lock.get("references") or [] if r.get("imageId")}
    refs = [profile_refs[rid] for rid in ref_ids if rid in profile_refs]

    visual_ev, copy_ev = _brief_evidence(profile, brief)
    positive = [
        f"生成 {video_plan.get('durationSec',10)} 秒 {video_plan.get('aspectRatio','9:16')} 竖屏电商商品短视频。",
        f"商品：{profile.get('productName') or project.get('name')}。业务目标：{brief.get('goal') or ''}。",
        "全片商品身份必须连续一致，商品保真优先于镜头炫技；不重新设计商品。",
        "每个 shot 只允许一个主要镜头运动；不得旋转到当前参考图未覆盖的背面/内部结构，也不得把生成视角冒充真实3D重建。",
    ]
    if visual_ev:
        positive.append("允许画面证明的事实：" + "；".join(e.get("fact", "") for e in visual_ev if e.get("fact")) + "。")
    if copy_ev:
        positive.append("仅供后期文案使用、画面不得伪造的主张：" + "；".join(e.get("fact", "") for e in copy_ev if e.get("fact")) + "。")
    if critical:
        positive.append("全片必须精确保持：" + "；".join(critical) + "。")
    if major:
        positive.append("全片必须保持视觉一致：" + "；".join(major) + "。")
    hook = video_plan.get("hook") or {}
    positive.append(f"前3秒钩子：类型={hook.get('type')}，目标={hook.get('goal')}，必须展示商品={'是' if hook.get('mustShowProduct',True) else '否'}。")

    positive.append("按以下时间轴逐镜执行；每镜只完成自己的任务，严格在切点切镜：")
    for s in shots:
        cam = s.get("camera") or {}
        prod = s.get("product") or {}
        human = s.get("human") or {}
        positive.append(
            f"[{s.get('startSec')}–{s.get('endSec')}s] {s.get('shotId')}：目的={s.get('purpose')}；主体={s.get('subject')}；"
            f"参考图={','.join(s.get('referenceImages') or []) or '无'}；景别={_cn(cam.get('shot'), {'closeup':'近景','medium_closeup':'中近景','medium':'中景','full_product':'完整商品展示','macro':'微距'})}，"
            f"机位={_cn(cam.get('height'), {'low':'低机位','slight_low':'轻微低机位','eye_level':'平视','slight_high':'轻微高机位','high':'高机位','top_down':'俯拍'})}，水平角={cam.get('horizontalAngleDeg',0)}°，"
            f"运镜={_cn(cam.get('movement'), {'static':'固定机位','push_in':'缓慢推进','pull_out':'缓慢拉远','pan_left':'向左平移','pan_right':'向右平移','orbit':'轻微环绕','tilt':'轻微俯仰'})}，幅度={_cn(cam.get('movementAmount'), {'micro':'微幅','small':'小幅','medium':'中幅'})}，速度={_cn(cam.get('speed'), {'slow':'慢速','medium':'中速'})}；"
            f"商品朝向={_facing_cn(prod.get('facing'))}，占画面约{prod.get('occupancyPct')}%，允许商品运动={','.join(prod.get('allowedMotion') or ['none'])}；"
            f"动作={s.get('action')}；人物={_cn(human.get('scope','none'), {'none':'不出现人物','hand_only':'仅手部','upper_body':'仅上半身','full_body':'全身'})}，手部位置={human.get('handPosition') or '无'}，持握点={human.get('gripPoint') or '无'}；"
            f"转场={s.get('transitionOut','cut')}。"
        )
    pacing = video_plan.get("pacingCurve") or []
    if pacing:
        positive.append("节奏曲线：" + "；".join(f"{x.get('shotId')}={x.get('intensity')}" for x in pacing) + "。Hook清楚但不过度快速，证据镜头适度放慢，结尾稳定收束。")
    audio = video_plan.get("audioPlan") or {}
    bgm = audio.get("bgm") or {}
    if bgm.get("required"):
        positive.append(f"后期音频方向：BGM={bgm.get('style')}，BPM约{(bgm.get('bpmRange') or ['',''])[0]}–{(bgm.get('bpmRange') or ['',''])[1]}；本次视频模型不生成中文口播文本。")

    standard_negative = [
        "跨镜改变商品轮廓、Logo、按钮、接口、颜色区域或组件数量",
        "商品在镜间突然变形、融化、伸缩、变厚、变细、换款",
        "未经证据出现包装、附件、配件或第二个商品",
        "无意义大幅旋转、快速甩镜、镜头抖动、强运动模糊遮挡商品结构",
        "错误中文、乱码、水印、二维码、价格、促销、认证、参数文字",
        "夸张粒子、能量光束、医疗功效可视化、不可验证性能特效",
        "手指数量异常、手部穿模、错误持握、人体遮挡关键结构",
    ]
    extra_neg = brief.get("prohibitions") or brief.get("negative") or []
    extra_neg += video_plan.get("negative") or []
    extra_neg += lock.get("forbiddenGlobalChanges") or []
    negative_prompt = "；".join(list(dict.fromkeys(standard_negative + [str(x) for x in extra_neg if x])))
    positive_prompt = "\n".join(positive)
    final_prompt = positive_prompt + "\n\n严格避免：" + negative_prompt + "。"

    package = {
        "assetId": "video_01",
        "modelRole": "video",
        "positivePrompt": positive_prompt,
        "negativePrompt": negative_prompt,
        "references": refs,
        "requestedCapabilities": {"referenceImage": bool(refs), "multiReference": len(refs) > 1, "timestampControl": False},
        "generationParams": {"aspectRatio": video_plan.get("aspectRatio", "9:16"), "durationSec": video_plan.get("durationSec", 10)},
        "qcContract": video_plan.get("qcChecklist") or brief.get("qcFocus") or [],
        "videoPlan": video_plan,
        "provenance": {
            "evidenceIds": [u.get("evidenceId") for u in brief.get("evidenceUsage") or [] if u.get("evidenceId")],
            "identityFeatureIds": [f.get("featureId") for f in lock.get("features") or [] if f.get("featureId")],
            "assetBriefVersion": "asset-brief.v2",
            "visualSpecVersion": "video-plan.v2",
            "upstreamHash": upstream_hash,
            "compiledAt": utc_now(),
        },
        "finalPrompt": final_prompt,
    }
    package["provenance"]["contentHash"] = canonical_hash({
        "assetId": package["assetId"],
        "positivePrompt": package["positivePrompt"],
        "negativePrompt": package["negativePrompt"],
        "references": package["references"],
        "generationParams": package["generationParams"],
        "qcContract": package["qcContract"],
        "videoPlan": package["videoPlan"],
        "upstreamHash": upstream_hash,
    })
    return package


def compile_prompt_bundle(project: dict, profile: dict, evidence: dict, plan: dict, directed: dict, mode: str) -> dict:
    strategy = plan.get("strategy") or {}
    style_lock = build_campaign_style_lock(project, profile, strategy)
    master_scene_lock = build_master_scene_lock(project, profile, strategy)
    upstream = {
        "evidence": evidence,
        "profile": profile,
        "strategy": strategy,
        "plan": {k: plan.get(k) for k in ["mainImages", "assetImages", "detailSections", "video"]},
        "directed": directed,
        "platform": PDD_PLATFORM_RULES,
        "styleLock": style_lock,
        "masterSceneLock": master_scene_lock,
    }
    upstream_hash = canonical_hash(upstream)
    by_id = {x.get("assetId"): x for x in directed.get("items") or [] if x.get("assetId")}
    briefs: list[dict[str, Any]] = []
    for group in IMAGE_TYPES:
        briefs.extend(plan.get(group) or [])
    if plan.get("video"):
        briefs.append(plan["video"])

    items = []
    for brief in briefs:
        aid = brief.get("assetId")
        d = by_id.get(aid) or {}
        if brief.get("type") == "video":
            pkg = compile_video_prompt_package(project, profile, brief, d.get("videoPlan") or d, upstream_hash)
            refs = pkg.get("references") or []
            visual = pkg.get("videoPlan") or {}
        else:
            pkg = compile_image_prompt_package(project, profile, brief, d, upstream_hash, style_lock, master_scene_lock)
            refs = pkg.get("references") or []
            visual = pkg.get("visualSpec") or d.get("visualSpec") or {}
        items.append({
            "assetId": aid,
            "type": brief.get("type"),
            "title": brief.get("title"),
            "purpose": brief.get("purpose"),
            "executionMode": brief.get("executionMode", "normal"),
            "referenceMap": refs,  # UI compatibility alias
            "referenceAssignments": refs,
            "visualSpec": visual,
            "negative": brief.get("prohibitions") or brief.get("negative") or [],
            "qcChecklist": pkg.get("qcContract") or [],
            "positivePrompt": pkg.get("positivePrompt"),
            "negativePrompt": pkg.get("negativePrompt"),
            "promptPackage": pkg,
            "generationParams": pkg.get("generationParams") or {},
            "finalPrompt": pkg.get("finalPrompt"),
        })

    readiness = evaluate_prompt_readiness(profile, mode)
    bundle = {
        "version": "prompt-pipeline.v2.4",
        "schemaVersion": "prompt-bundle.v2",
        "mode": mode,
        "reviewRequired": True,
        "promptReadiness": readiness,
        "platformRuleProfile": PDD_PLATFORM_RULES,
        "campaignStyleLock": style_lock,
        "masterSceneLock": master_scene_lock,
        "commerceValidation": validate_commerce_plan(plan, profile),
        "upstreamHash": upstream_hash,
        "contentHash": "",
        "approvedContentHash": None,
        "warning": "DEMO PREVIEW：未执行真实视觉证据识别，不可当作生产 Prompt。" if mode == "demo" else "Live Prompt v2.4 已基于 Product Evidence、VisualRole、SourceRole、Surface Appearance、CreativeReferenceProfile、MasterSceneLock、IdentityLock、AssetBrief 与 VisualSpec 编译，仍需人工确认。",
        "items": items,
    }
    hashable = deepcopy(bundle)
    hashable.pop("contentHash", None)
    hashable.pop("approvedContentHash", None)
    bundle["contentHash"] = canonical_hash(hashable)
    return bundle


def validate_commerce_plan(plan: dict, profile: dict) -> dict:
    issues: list[dict] = []
    all_items = (plan.get("mainImages") or []) + (plan.get("assetImages") or []) + (plan.get("detailSections") or [])
    if plan.get("video"):
        all_items.append(plan["video"])
    if len(all_items) != 14:
        issues.append({"severity": "critical", "code": "asset_count", "detail": f"需要14个资产，实际{len(all_items)}"})

    evidence = {e.get("evidenceId"): e for e in profile.get("evidence") or [] if e.get("evidenceId")}
    stages = {str(x.get("conversionStage") or "") for x in all_items}
    for must in {"click", "trust", "decision"}:
        if must not in stages:
            issues.append({"severity": "major", "code": "coverage", "detail": f"资产组合缺少 {must} 阶段明确任务"})

    seen_visual_tasks: dict[str, list[str]] = {}
    seen_visual_roles: dict[str, list[str]] = {}
    for item in all_items:
        aid = item.get("assetId")
        task = str(item.get("visualTask") or item.get("visualIntent") or "").strip()
        expected_role = str((visual_role_contract(aid) or {}).get("visualRole") or "")
        actual_role = str(item.get("visualRole") or expected_role or "")
        if expected_role and actual_role != expected_role:
            issues.append({"severity":"critical","code":"visual_role_contract","assetId":aid,"detail":f"visualRole 必须为 {expected_role}，实际 {actual_role}"})
        if actual_role:
            seen_visual_roles.setdefault(actual_role, []).append(aid)
        if task:
            seen_visual_tasks.setdefault(task, []).append(aid)
        for usage in item.get("evidenceUsage") or []:
            eid = usage.get("evidenceId")
            ev = evidence.get(eid)
            if not ev:
                issues.append({"severity": "critical", "code": "unknown_evidence", "assetId": aid, "detail": f"引用不存在证据 {eid}"})
            elif usage.get("purpose") == "visual_proof" and ev.get("visualProvable") is not True:
                issues.append({"severity": "critical", "code": "invalid_visual_proof", "assetId": aid, "detail": f"{eid} 不能作为 visual_proof"})
        key = str(item.get("keyMessage") or "")
        if any(token in key.lower() for token in ["待确认", "placeholder", "tbd"]):
            issues.append({"severity": "critical", "code": "placeholder", "assetId": aid, "detail": "keyMessage 含占位词"})

    for task, ids in seen_visual_tasks.items():
        if len(ids) >= 3:
            issues.append({"severity": "major", "code": "homogeneous_assets", "detail": f"多个资产视觉任务完全相同：{ids}"})
    for role, ids in seen_visual_roles.items():
        if len(ids) > 1:
            issues.append({"severity":"major","code":"duplicate_visual_role","detail":f"视觉角色重复：{role} → {ids}"})

    detail_roles = {x.get("assetId"):x.get("visualRole") for x in (plan.get("detailSections") or [])}
    if len({detail_roles.get("detail_03"),detail_roles.get("detail_04"),detail_roles.get("detail_05")}) < 3:
        issues.append({"severity":"critical","code":"detail_role_collapse","detail":"detail_03/detail_04/detail_05 必须保持三个不同视觉角色"})

    status = "FAIL" if any(i["severity"] == "critical" for i in issues) else "WARNING" if issues else "PASS"
    return {"schemaVersion": "commerce-validation.v2", "status": status, "issues": issues}


def _clamp_num(value: Any, lo: float = 0, hi: float = 100) -> float | None:
    try:
        return max(lo, min(hi, float(value)))
    except Exception:
        return None


def normalize_box(box: Any) -> dict | None:
    if not isinstance(box, dict):
        return None
    x = _clamp_num(box.get("xPct")); y = _clamp_num(box.get("yPct")); w = _clamp_num(box.get("widthPct")); h = _clamp_num(box.get("heightPct"))
    if None in {x, y, w, h} or w == 0 or h == 0:
        return None
    if x + w > 100: w = max(0, 100 - x)
    if y + h > 100: h = max(0, 100 - y)
    if w <= 0 or h <= 0: return None
    return {"xPct": round(x, 2), "yPct": round(y, 2), "widthPct": round(w, 2), "heightPct": round(h, 2)}


def normalize_evidence_bundle(raw: dict, registry: list[dict]) -> dict:
    assets = raw.get("assets") or raw.get("images") or []
    reg_by_id = {r["imageId"]: r for r in registry}
    normalized_assets = []
    for idx, r in enumerate(registry, 1):
        src = next((x for x in assets if x.get("imageId") == r["imageId"]), {})
        parts = []
        raw_parts = src.get("productParts") or src.get("visibleProductParts") or []
        part_id_map: dict[str, str] = {}
        for j, p in enumerate(raw_parts, 1):
            if isinstance(p, str):
                p = {"partType": p}
            normalized_part_id = f"{r['imageId']}_part_{j:02d}"
            raw_part_id = str(p.get("partId") or "").strip()
            if raw_part_id:
                part_id_map[raw_part_id] = normalized_part_id
            pos = p.get("position") if isinstance(p.get("position"), dict) else {}
            parts.append({
                "partId": normalized_part_id,
                "partType": str(p.get("partType") or p.get("name") or "unknown"),
                "count": p.get("count") if isinstance(p.get("count"), int) else None,
                "shape": p.get("shape"),
                "position": {
                    "relativeTo": pos.get("relativeTo"),
                    "vertical": pos.get("vertical") or "unknown",
                    "horizontal": pos.get("horizontal") or "unknown",
                },
                "dominantColor": p.get("dominantColor"),
                "sizeRelative": p.get("sizeRelative") or "unknown",
                "visibleRegion": p.get("visibleRegion") or "partial",
                "boundingBox": normalize_box(p.get("boundingBox")),
                "confidence": p.get("confidence") if p.get("confidence") in {"high","medium","low"} else "low",
            })
        valid_part_ids = {p["partId"] for p in parts}
        def map_part_id(value: Any) -> str:
            key = str(value or "").strip()
            if key in valid_part_ids:
                return key
            return part_id_map.get(key, "")

        # Preserve relations only when both endpoints can be mapped to normalized ids.
        relations = []
        for rel in src.get("spatialRelations") or []:
            if not isinstance(rel, dict):
                continue
            subject = map_part_id(rel.get("subjectPartId"))
            obj = map_part_id(rel.get("objectPartId"))
            if not subject or not obj:
                continue
            relations.append({
                "subjectPartId": subject,
                "relation": rel.get("relation") or "unknown",
                "objectPartId": obj,
                "confidence": rel.get("confidence") if rel.get("confidence") in {"high","medium","low"} else "low",
            })
        colors = []
        for j, c in enumerate(src.get("colorRegions") or [], 1):
            if not isinstance(c, dict):
                continue
            colors.append({
                "regionId": f"{r['imageId']}_color_{j:02d}",
                "targetPartId": map_part_id(c.get("targetPartId")),
                "color": c.get("color") or "",
                "position": c.get("position") or "",
                "boundingBox": normalize_box(c.get("boundingBox")),
                "confidence": c.get("confidence") if c.get("confidence") in {"high","medium","low"} else "low",
            })
        surfaces = []
        for j, item in enumerate(src.get("surfaceAppearance") or [], 1):
            if not isinstance(item, dict):
                continue
            target_part = map_part_id(item.get("targetPartId"))
            surfaces.append({
                "surfaceId": f"{r['imageId']}_surface_{j:02d}",
                "targetPartId": target_part,
                "regionBox": normalize_box(item.get("regionBox")),
                "appearanceClass": item.get("appearanceClass") or "unknown",
                "finish": item.get("finish") or "unknown",
                "texture": str(item.get("texture") or "").strip(),
                "reflectance": item.get("reflectance") or "unknown",
                "transparency": item.get("transparency") or "unknown",
                "microDetail": str(item.get("microDetail") or "").strip(),
                "edgeCharacter": item.get("edgeCharacter") or "unknown",
                "confidence": item.get("confidence") if item.get("confidence") in {"high","medium","low"} else "low",
            })

        texts = []
        source_texts = src.get("textItems") or src.get("visibleText") or []
        for j, t in enumerate(source_texts, 1):
            if isinstance(t, str): t = {"text": t}
            texts.append({
                "textId": f"{r['imageId']}_text_{j:02d}",
                "text": t.get("text") or "",
                "kind": t.get("kind") if t.get("kind") in {"product","packaging","background","watermark"} else "background",
                "location": t.get("location") or "",
                "boundingBox": normalize_box(t.get("boundingBox")),
                "confidence": t.get("confidence") if t.get("confidence") in {"high","medium","low"} else "low",
            })
        q = src.get("quality") or {}
        source_role = normalize_source_role(r.get("sourceRole"))
        creative_profile = src.get("creativeReferenceProfile") if isinstance(src.get("creativeReferenceProfile"), dict) else None
        if source_role not in CREATIVE_REFERENCE_ROLES:
            creative_profile = None
        normalized_assets.append({
            **r,
            "sourceRole": source_role,
            "assetRole": src.get("assetRole") or src.get("roleGuess") or "unknown",
            "view": src.get("view") if isinstance(src.get("view"), dict) else {"direction": "unknown", "elevation": "unknown"},
            "productParts": parts if source_role in PRODUCT_FACT_SOURCE_ROLES else [],
            "surfaceAppearance": surfaces if source_role in PRODUCT_FACT_SOURCE_ROLES else [],
            "spatialRelations": relations if source_role in PRODUCT_FACT_SOURCE_ROLES else [],
            "proportions": [
                {
                    **x,
                    "subjectPartId": map_part_id(x.get("subjectPartId")),
                    "relativeToPartId": map_part_id(x.get("relativeToPartId")),
                }
                for x in (src.get("proportions") or [])
                if source_role in PRODUCT_FACT_SOURCE_ROLES and isinstance(x, dict) and map_part_id(x.get("subjectPartId")) and map_part_id(x.get("relativeToPartId"))
            ],
            "colorRegions": colors if source_role in PRODUCT_FACT_SOURCE_ROLES else [],
            "textItems": texts if source_role in PRODUCT_FACT_SOURCE_ROLES else [],
            "creativeReferenceProfile": creative_profile,
            "packagingEvidence": src.get("packagingEvidence") if isinstance(src.get("packagingEvidence"), dict) else {"status": "visible" if src.get("packaging") else "uncertain", "notes": src.get("packaging") or []},
            "accessoryEvidence": src.get("accessoryEvidence") if isinstance(src.get("accessoryEvidence"), dict) else {"status": "visible" if src.get("attachments") else "uncertain", "notes": src.get("attachments") or []},
            "recommendedUse": src.get("recommendedUse") or [],
            "ignoreFor": src.get("ignoreFor") or [],
            "quality": {
                "sharpness": q.get("sharpness") or "usable",
                "occlusion": q.get("occlusion") or "partial",
                "distortion": q.get("distortion") or "minor",
            },
        })
    cross = raw.get("crossAsset") or raw.get("crossImage") or {}
    creative_profiles = [
        {"imageId": a.get("imageId"), "sourceRole": a.get("sourceRole"), "profile": a.get("creativeReferenceProfile")}
        for a in normalized_assets
        if a.get("sourceRole") in CREATIVE_REFERENCE_ROLES and a.get("creativeReferenceProfile")
    ]
    return {
        "schemaVersion": "evidence.v2.1",
        "mode": raw.get("mode") or "live",
        "assets": normalized_assets,
        "crossAsset": {
            "consistentFeatures": cross.get("consistentFeatures") or [],
            "conflicts": cross.get("conflicts") or [],
            "masterReferences": cross.get("masterReferences") or ({"structure": cross.get("masterReferenceSuggestion")} if cross.get("masterReferenceSuggestion") else {}),
            "missingViews": cross.get("missingViews") or [],
            "creativeReferenceProfiles": creative_profiles,
        },
        "unresolved": raw.get("unresolved") or raw.get("uncertain") or [],
    }


def normalize_product_profile(raw: dict, project: dict, evidence_bundle: dict) -> dict:
    raw = deepcopy(raw or {})
    raw["schemaVersion"] = "product-profile.v2"
    raw["productName"] = raw.get("productName") or project.get("name") or ""
    raw["category"] = raw.get("category") or project.get("category") or ""
    raw["brand"] = raw.get("brand") or project.get("brand") or ""
    raw["price"] = raw.get("price") or project.get("price") or ""
    raw["confirmedFacts"] = [str(x).strip() for x in (raw.get("confirmedFacts") or []) if str(x).strip()]
    raw["userClaims"] = [str(x).strip() for x in (raw.get("userClaims") or project.get("selling_points") or []) if str(x).strip()]
    raw["parameters"] = raw.get("parameters") if isinstance(raw.get("parameters"), dict) else (project.get("product_params") or {})
    raw["unknownFacts"] = [str(x).strip() for x in (raw.get("unknownFacts") or []) if str(x).strip()]
    raw["forbiddenClaims"] = [str(x).strip() for x in (raw.get("forbiddenClaims") or []) if str(x).strip()]
    raw["source"] = raw.get("source") or "live"

    evidence_assets = evidence_bundle.get("assets") or []
    valid_images = {a.get("imageId") for a in evidence_assets if a.get("imageId")}
    product_fact_images = {a.get("imageId") for a in evidence_assets if a.get("imageId") and a.get("sourceRole") in PRODUCT_FACT_SOURCE_ROLES}
    evidence = []
    local_key_to_eid: dict[str, str] = {}
    visual_i = user_i = inferred_i = 0
    for item in raw.get("evidence") or []:
        if not isinstance(item, dict) or not str(item.get("fact") or "").strip():
            continue
        st = item.get("sourceType") if item.get("sourceType") in {"visual","user_provided","inferred"} else "inferred"
        if st == "visual": visual_i += 1; eid = f"ev_visual_{visual_i:03d}"
        elif st == "user_provided": user_i += 1; eid = f"ev_user_{user_i:03d}"
        else: inferred_i += 1; eid = f"ev_inferred_{inferred_i:03d}"
        src_img = item.get("sourceImage") if item.get("sourceImage") in valid_images else ""
        confidence = item.get("confidence") if item.get("confidence") in {"high","medium","low"} else "low"
        visual_provable = bool(item.get("visualProvable")) and st == "visual" and bool(src_img) and src_img in product_fact_images and confidence in {"high","medium"}
        local_key = str(item.get("localKey") or "").strip()
        if local_key:
            local_key_to_eid[local_key] = eid
        evidence.append({
            "evidenceId": eid,
            "fact": str(item.get("fact") or "").strip(),
            "sourceType": st,
            "sourceImage": src_img,
            "sourcePartIds": item.get("sourcePartIds") or [],
            "visibleEvidence": item.get("visibleEvidence") or ("用户输入" if st == "user_provided" else ""),
            "confidence": confidence,
            "visualProvable": visual_provable,
        })

    # Deterministically preserve every explicit user claim/parameter even if the
    # model omitted it. These are never promoted to visual proof.
    existing_user_facts = {e["fact"] for e in evidence if e["sourceType"] == "user_provided"}
    for claim in raw["userClaims"]:
        if claim not in existing_user_facts:
            user_i += 1
            evidence.append({"evidenceId": f"ev_user_{user_i:03d}", "fact": claim, "sourceType": "user_provided", "sourceImage": "", "sourcePartIds": [], "visibleEvidence": "用户输入", "confidence": "high", "visualProvable": False})
    for k, v in raw["parameters"].items():
        fact = f"{k}: {v}"
        if fact not in {e["fact"] for e in evidence if e["sourceType"] == "user_provided"}:
            user_i += 1
            evidence.append({"evidenceId": f"ev_user_{user_i:03d}", "fact": fact, "sourceType": "user_provided", "sourceImage": "", "sourcePartIds": [], "visibleEvidence": "用户输入参数", "confidence": "high", "visualProvable": False})
    raw["evidence"] = evidence
    raw["confirmedFacts"] = [e["fact"] for e in evidence if e.get("sourceType") == "visual" and e.get("visualProvable") is True]
    ev_by_id = {e["evidenceId"]: e for e in evidence}

    # Carry visual surface evidence and creative reference profiles deterministically.
    raw["surfaceAppearance"] = [
        {"imageId": a.get("imageId"), "sourceRole": a.get("sourceRole"), **surface}
        for a in evidence_assets if a.get("sourceRole") in PRODUCT_FACT_SOURCE_ROLES
        for surface in (a.get("surfaceAppearance") or [])
        if surface.get("confidence") in {"high", "medium"}
    ]
    raw["creativeReferenceProfiles"] = [
        {"imageId": a.get("imageId"), "sourceRole": a.get("sourceRole"), "profile": a.get("creativeReferenceProfile")}
        for a in evidence_assets
        if a.get("sourceRole") in CREATIVE_REFERENCE_ROLES and a.get("creativeReferenceProfile")
    ]

    lock = raw.get("identityLock") if isinstance(raw.get("identityLock"), dict) else {}
    features = []
    for feat in lock.get("features") or []:
        if not isinstance(feat, dict):
            continue
        refs = []
        for token in feat.get("evidenceRefs") or []:
            if token in ev_by_id:
                refs.append(token)
            elif token in local_key_to_eid:
                refs.append(local_key_to_eid[token])
        # If linkage was omitted, conservatively recover only from explicit source images.
        if not refs:
            source_images = [x for x in (feat.get("sourceImages") or []) if x in product_fact_images]
            refs = [e["evidenceId"] for e in evidence if e["sourceType"] == "visual" and e["sourceImage"] in source_images and e["visualProvable"]]
        visual_refs = [rid for rid in refs if ev_by_id[rid]["sourceType"] == "visual" and ev_by_id[rid]["visualProvable"]]
        if not visual_refs:
            continue
        features.append({
            "featureId": f"lf_{len(features)+1:03d}",
            "field": feat.get("field") or "other",
            "target": feat.get("target") or "",
            "value": feat.get("value"),
            "evidenceRefs": visual_refs,
            "sourceImages": sorted(set(ev_by_id[r]["sourceImage"] for r in visual_refs if ev_by_id[r]["sourceImage"])),
            "sourceType": "visual",
            "visualProvable": True,
            "severity": feat.get("severity") if feat.get("severity") in {"critical","major","minor"} else "major",
            "tolerance": feat.get("tolerance") if isinstance(feat.get("tolerance"), dict) else {"type": "visual_match", "value": None},
            "forbiddenChanges": feat.get("forbiddenChanges") or [],
        })

    raw_refs = lock.get("references") or []
    references = []
    for asset in [a for a in evidence_bundle.get("assets") or [] if a.get("imageId")]:
        image_id = asset.get("imageId")
        source_role = normalize_source_role(asset.get("sourceRole"))
        src = next((r for r in raw_refs if r.get("imageId") == image_id), {})
        rr = []
        for region in src.get("regionResponsibilities") or []:
            if not isinstance(region, dict):
                continue
            rr.append({
                "sourceRegion": region.get("sourceRegion") or "full_product",
                "regionBox": normalize_box(region.get("regionBox")),
                "useFor": region.get("useFor") or [],
                "ignoreFor": region.get("ignoreFor") or [],
            })
        if source_role in CREATIVE_REFERENCE_ROLES:
            creative_use = {
                "STYLE_REFERENCE": ["style", "lighting", "color_relationship"],
                "LAYOUT_REFERENCE": ["composition", "visual_hierarchy", "negative_space", "copy_zone"],
                "SCENE_REFERENCE": ["environment", "surface", "prop_relationship", "depth"],
            }[source_role]
            rr = [{
                "sourceRegion": "full_image", "regionBox": None,
                "useFor": creative_use,
                "ignoreFor": ["product_identity", "product_structure", "logo", "label_text", "parameters", "packaging_facts", "accessories"],
            }]
            role_name = {"STYLE_REFERENCE":"style_reference","LAYOUT_REFERENCE":"layout_reference","SCENE_REFERENCE":"scene_reference"}[source_role]
        else:
            if not rr:
                rr = [{"sourceRegion": "full_product", "regionBox": None, "useFor": asset.get("recommendedUse") or ["product_identity"], "ignoreFor": asset.get("ignoreFor") or ["background", "watermark"]}]
            role_name = src.get("role") or ("packaging_reference" if source_role == "PACKAGING_TRUTH" else "detail_reference")
        references.append({
            "imageId": image_id,
            "sourceRole": source_role,
            "role": role_name,
            "priority": src.get("priority") if src.get("priority") in {"primary","secondary","supporting"} else ("secondary" if source_role in CREATIVE_REFERENCE_ROLES else "supporting"),
            "regionResponsibilities": rr,
        })
    raw["identityLock"] = {
        "schemaVersion": "identity-lock.v2",
        "features": features,
        "references": references,
        "forbiddenGlobalChanges": lock.get("forbiddenGlobalChanges") or ["不得新增未确认包装、附件、配件或商品结构", "不得改变已锁定商品身份"],
        "unresolvedIdentityFields": lock.get("unresolvedIdentityFields") or [],
    }

    # Legacy display compatibility. Authoritative data is identityLock.
    raw["visualIdentity"] = {
        "summary": (raw.get("visualIdentity") or {}).get("summary") if isinstance(raw.get("visualIdentity"), dict) else "",
        "lockedFeatures": [f"{f['field']}:{f.get('target','')}={f.get('value')}" for f in features],
        "forbiddenChanges": raw["identityLock"]["forbiddenGlobalChanges"],
    }
    raw["referenceMap"] = [
        {"imageId": r["imageId"], "role": r["role"], "useFor": [u for region in r["regionResponsibilities"] for u in region.get("useFor", [])], "ignoreFor": [u for region in r["regionResponsibilities"] for u in region.get("ignoreFor", [])]}
        for r in references
    ]
    return raw


def normalize_strategy(raw: dict, project: dict) -> dict:
    raw = deepcopy(raw or {})
    raw["schemaVersion"] = "commerce-strategy.v2"
    for key in ["audience","purchaseContext","clickDrivers","trustDrivers","purchaseDrivers","objections","evidenceAvailable","evidenceMissing","kpiTargets","guardrails"]:
        raw.setdefault(key, [])
    raw.setdefault("visualPositioning", {"tone": [], "avoid": []})
    raw.setdefault("categoryVisualGrammar", {"presentationConventions": [], "searchThumbnailPriorities": [], "avoidCliches": []})
    raw.setdefault("contentArchitecture", {"mainImages": [], "materials": [], "detailFlow": [], "videoObjective": ""})
    proposal = raw.get("masterSceneProposal") if isinstance(raw.get("masterSceneProposal"), dict) else {}
    proposal["sceneContext"] = str(proposal.get("sceneContext") or "").strip()
    proposal["background"] = str(proposal.get("background") or "").strip()
    proposal["surface"] = str(proposal.get("surface") or "").strip()
    proposal["fixedElements"] = [str(x).strip() for x in (proposal.get("fixedElements") or []) if str(x).strip()][:3]
    light = proposal.get("lightingIntent") if isinstance(proposal.get("lightingIntent"), dict) else {}
    proposal["lightingIntent"] = {
        "direction": str(light.get("direction") or "").strip(),
        "quality": str(light.get("quality") or "").strip(),
        "temperature": str(light.get("temperature") or "neutral").strip(),
    }
    proposal["colorFamily"] = [str(x).strip() for x in (proposal.get("colorFamily") or []) if str(x).strip()][:5]
    proposal["depthSystem"] = str(proposal.get("depthSystem") or "").strip()
    proposal["rationale"] = str(proposal.get("rationale") or "").strip()
    raw["masterSceneProposal"] = proposal
    # UI compatibility view.
    raw["targetAudience"] = raw.get("audience") or []
    raw["positioning"] = "；".join(x.get("statement", "") for x in (raw.get("clickDrivers") or [])[:1] if isinstance(x, dict)) or "以真实商品证据驱动点击、信任与决策。"
    raw["conversionGoal"] = "覆盖 click / trust / decision 三阶段，移动端优先。"
    tones = raw.get("visualPositioning", {}).get("tone") or []
    raw["visualDirection"] = {
        "mood": "、".join(tones),
        "scene": "、".join(raw.get("purchaseContext") or []),
        "palette": "忠于商品自身颜色，背景服务商品识别",
        "compositionPrinciple": "一张图一个转化任务；商品真实性优先；移动端快速识别。",
    }
    raw["missingInputs"] = raw.get("evidenceMissing") or []
    return raw


def normalize_asset_brief_items(raw: dict, batch: str, asset_ids: list[str], profile: dict) -> list[dict]:
    items = raw.get("items") if isinstance(raw, dict) else None
    items = items if isinstance(items, list) else []
    by_id = {x.get("assetId"): x for x in items if isinstance(x, dict) and x.get("assetId")}
    evidence = {e.get("evidenceId"): e for e in profile.get("evidence") or [] if e.get("evidenceId")}
    typ = {"main":"main_image","material":"asset_image","detail":"detail_section","video":"video"}[batch]
    out = []
    for aid in asset_ids:
        x = deepcopy(by_id.get(aid) or {})
        x["assetId"] = aid; x["type"] = typ
        x["title"] = str(x.get("title") or aid)
        x["priority"] = x.get("priority") if x.get("priority") in {"primary","secondary","supporting"} else "supporting"
        x["businessPriority"] = x.get("businessPriority") if x.get("businessPriority") in {"revenue_critical","conversion_critical","supporting"} else ("conversion_critical" if batch in {"main","detail","video"} else "supporting")
        x["conversionStage"] = x.get("conversionStage") if x.get("conversionStage") in {"click","recognition","trust","understanding","decision","closing"} else "understanding"
        x["purpose"] = str(x.get("purpose") or x["conversionStage"])
        x["goal"] = str(x.get("goal") or "")
        role_contract = visual_role_contract(aid)
        x["visualRole"] = str(role_contract.get("visualRole") or x.get("visualRole") or "")
        x["detailRole"] = str(role_contract.get("detailRole") or x.get("detailRole") or "")
        x["roleIntent"] = str(role_contract.get("purpose") or "")
        x["scenePolicy"] = str(role_contract.get("scenePolicy") or x.get("scenePolicy") or "")
        x["proofIntent"] = x.get("proofIntent") or None
        x["visualTask"] = str(x.get("visualTask") or "")
        x["keyMessage"] = str(x.get("keyMessage") or "")
        usages = []
        for u in x.get("evidenceUsage") or []:
            if not isinstance(u, dict): continue
            eid = u.get("evidenceId"); purpose = u.get("purpose")
            if eid not in evidence or purpose not in {"visual_proof","copy_support","identity_only"}: continue
            if purpose == "visual_proof" and evidence[eid].get("visualProvable") is not True:
                purpose = "copy_support"
            usages.append({"evidenceId": eid, "purpose": purpose})
        x["evidenceUsage"] = usages
        x["requestedReferences"] = [r for r in (x.get("requestedReferences") or []) if isinstance(r, dict)]
        x["safeAreaRequirement"] = x.get("safeAreaRequirement") if isinstance(x.get("safeAreaRequirement"), dict) else {"required": True, "purpose": "title"}
        x["platformCompliance"] = x.get("platformCompliance") if isinstance(x.get("platformCompliance"), dict) else {"formalTextByProgram": True, "forbidUnverifiedPriceOrPromo": True, "forbidUnverifiedPackaging": True, "mobileFirst": True}
        x["prohibitions"] = [str(v) for v in (x.get("prohibitions") or []) if str(v).strip()]
        x["qcFocus"] = [str(v) for v in (x.get("qcFocus") or []) if str(v).strip()]
        x["executionMode"] = x.get("executionMode") if x.get("executionMode") in {"normal","neutral_fallback","blocked"} else "blocked"
        x["fallbackRule"] = x.get("fallbackRule") if isinstance(x.get("fallbackRule"), dict) else {"when": ["insufficient_evidence"], "action": "human_review"}
        # Legacy UI aliases.
        x["evidenceRefs"] = [u["evidenceId"] for u in usages]
        x["referencePlan"] = [f"{r.get('purpose')} → {r.get('preferredRole')}" for r in x["requestedReferences"]]
        x["visualIntent"] = x["visualTask"]
        x["safeAreaIntent"] = x["safeAreaRequirement"].get("purpose") or "none"
        x["negative"] = x["prohibitions"]
        if batch == "video":
            x["duration"] = int(x.get("duration") or 10); x["ratio"] = x.get("ratio") or "9:16"
        out.append(x)
    return out


def normalize_visual_items(raw: dict, briefs: list[dict], profile: dict, master_scene_lock: dict | None = None) -> list[dict]:
    items = raw.get("items") if isinstance(raw, dict) else None
    items = items if isinstance(items, list) else []
    by_id = {x.get("assetId"): x for x in items if isinstance(x, dict) and x.get("assetId")}
    ref_catalog = {r.get("imageId"): r for r in (profile.get("identityLock") or {}).get("references") or [] if r.get("imageId")}
    valid_refs = set(ref_catalog)
    out = []
    for brief in briefs:
        aid = brief["assetId"]; x = deepcopy(by_id.get(aid) or {})
        refs = []
        for r in x.get("referenceAssignments") or x.get("referenceMap") or []:
            if not isinstance(r, dict) or r.get("imageId") not in valid_refs:
                continue
            catalog_ref = ref_catalog.get(r.get("imageId")) or {}
            source_role = catalog_ref.get("sourceRole") or "PRODUCT_TRUTH"
            if source_role in CREATIVE_REFERENCE_ROLES:
                responsibilities = deepcopy(catalog_ref.get("regionResponsibilities") or [])
            else:
                responsibilities = [
                    {"sourceRegion": rr.get("sourceRegion") or "full_product", "regionBox": normalize_box(rr.get("regionBox")), "useFor": rr.get("useFor") or [], "ignoreFor": rr.get("ignoreFor") or []}
                    for rr in (r.get("regionResponsibilities") or []) if isinstance(rr, dict)
                ] or deepcopy(catalog_ref.get("regionResponsibilities") or [])
            if not responsibilities:
                responsibilities = [{"sourceRegion":"full_product","regionBox":None,"useFor":["product_identity"],"ignoreFor":["background","watermark"]}]
            refs.append({
                "imageId": r.get("imageId"),
                "sourceRole": source_role,
                "role": catalog_ref.get("role") if source_role in CREATIVE_REFERENCE_ROLES else (r.get("role") or catalog_ref.get("role") or "detail_reference"),
                "priority": r.get("priority") if r.get("priority") in {"primary","secondary","supporting"} else (catalog_ref.get("priority") or "supporting"),
                "regionResponsibilities": responsibilities,
            })
        spec = x.get("visualSpec") if isinstance(x.get("visualSpec"), dict) else {}
        # Clamp the few numeric controls that directly affect layout stability.
        product = spec.get("product") if isinstance(spec.get("product"), dict) else {}
        product["occupancyPct"] = int(_clamp_num(product.get("occupancyPct"), 20, 90) or 60)
        anchor = product.get("anchor") if isinstance(product.get("anchor"), dict) else {"xPct":50,"yPct":50}
        anchor["xPct"] = _clamp_num(anchor.get("xPct")) or 50; anchor["yPct"] = _clamp_num(anchor.get("yPct")) or 50
        product["anchor"] = anchor; spec["product"] = product
        spec["safeAreas"] = [
            {**sa, "xPct": _clamp_num(sa.get("xPct")) or 0, "yPct": _clamp_num(sa.get("yPct")) or 0, "widthPct": _clamp_num(sa.get("widthPct")) or 0, "heightPct": _clamp_num(sa.get("heightPct")) or 0}
            for sa in (spec.get("safeAreas") or []) if isinstance(sa, dict)
        ]
        spec = apply_visual_role_contract(brief, spec)
        if master_scene_lock:
            spec = apply_master_scene_to_visual_spec(brief, spec, master_scene_lock)
        out.append({"assetId": aid, "referenceAssignments": refs, "referenceMap": refs, "visualSpec": spec, "negative": x.get("negative") or brief.get("prohibitions") or [], "qcChecklist": x.get("qcChecklist") or brief.get("qcFocus") or []})
    return out


def normalize_video_plan(raw: dict, profile: dict, brief: dict) -> dict:
    raw = deepcopy(raw or {})
    raw["assetId"] = "video_01"
    duration = int(raw.get("durationSec") or brief.get("duration") or 10)
    duration = max(8, min(12, duration)); raw["durationSec"] = duration
    raw["aspectRatio"] = "9:16"
    valid_refs = {
        r.get("imageId") for r in (profile.get("identityLock") or {}).get("references") or []
        if r.get("imageId") and (r.get("sourceRole") or "PRODUCT_TRUTH") in PRODUCT_FACT_SOURCE_ROLES
    }
    valid_features = {f.get("featureId") for f in (profile.get("identityLock") or {}).get("features") or [] if f.get("featureId")}
    shots = []
    for i, s in enumerate(raw.get("shots") or [], 1):
        if not isinstance(s, dict): continue
        try: start = float(s.get("startSec")); end = float(s.get("endSec"))
        except Exception: continue
        if end <= start: continue
        s["shotId"] = s.get("shotId") or f"s{i}"
        s["referenceImages"] = [x for x in (s.get("referenceImages") or []) if x in valid_refs]
        s["identityLocks"] = [x for x in (s.get("identityLocks") or []) if x in valid_features]
        product = s.get("product") if isinstance(s.get("product"), dict) else {}
        product["occupancyPct"] = int(_clamp_num(product.get("occupancyPct"), 25, 90) or 60); s["product"] = product
        shots.append(s)
    if not shots:
        return {**raw, "shots": [], "blockedReason": "VideoPlanV2 没有可执行 shots[]"}
    shots.sort(key=lambda x: float(x["startSec"]))
    # Hard continuity validation: no hidden filler or gap.
    cursor = 0.0
    for s in shots:
        if abs(float(s["startSec"]) - cursor) > 0.15:
            return {**raw, "shots": shots, "blockedReason": f"视频时间轴存在空档/重叠，期望下一镜从 {cursor}s 开始"}
        cursor = float(s["endSec"])
    if abs(cursor - duration) > 0.2:
        return {**raw, "shots": shots, "blockedReason": f"shots 结束于 {cursor}s，与 durationSec={duration} 不一致"}
    hook = raw.get("hook") if isinstance(raw.get("hook"), dict) else {}
    hook_id = hook.get("shotId")
    hook_shot = next((x for x in shots if x.get("shotId") == hook_id), None)
    if not hook_shot:
        return {**raw, "shots": shots, "blockedReason": "VideoPlanV2 hook.shotId 未指向真实镜头"}
    if float(hook_shot.get("startSec", 99)) >= 3.0:
        return {**raw, "shots": shots, "blockedReason": "VideoPlanV2 前3秒没有有效 hook"}
    if hook.get("mustShowProduct") is not True:
        return {**raw, "shots": shots, "blockedReason": "VideoPlanV2 hook 必须在前3秒展示商品"}
    raw["hook"] = hook
    raw["shots"] = shots
    return raw
