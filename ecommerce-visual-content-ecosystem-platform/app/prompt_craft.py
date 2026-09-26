from __future__ import annotations

from typing import Any




SOURCE_ROLES = {
    "PRODUCT_TRUTH": "商品事实主参考",
    "PRODUCT_DETAIL": "商品细节事实参考",
    "PACKAGING_TRUTH": "包装事实参考",
    "STYLE_REFERENCE": "视觉风格参考",
    "LAYOUT_REFERENCE": "构图版式参考",
    "SCENE_REFERENCE": "场景氛围参考",
}

PRODUCT_FACT_SOURCE_ROLES = {"PRODUCT_TRUTH", "PRODUCT_DETAIL", "PACKAGING_TRUTH"}
CREATIVE_REFERENCE_ROLES = {"STYLE_REFERENCE", "LAYOUT_REFERENCE", "SCENE_REFERENCE"}


def normalize_source_role(value: Any) -> str:
    role = str(value or "PRODUCT_TRUTH").upper().strip()
    return role if role in SOURCE_ROLES else "PRODUCT_TRUTH"


def creative_profile_lines(profile: dict[str, Any] | None) -> list[str]:
    if not profile:
        return []
    keys = [
        ("compositionPattern", "构图模式"),
        ("productOccupancy", "主体占比"),
        ("cameraPattern", "镜头/视角模式"),
        ("backgroundGeometry", "背景几何"),
        ("surfaceSystem", "承托面"),
        ("propSystem", "道具系统"),
        ("lightDirection", "光线方向"),
        ("lightQuality", "光线质感"),
        ("contrastPattern", "对比关系"),
        ("colorRelationship", "色彩关系"),
        ("depthPattern", "空间层次"),
        ("negativeSpacePattern", "留白模式"),
        ("visualHierarchy", "视觉层级"),
        ("copyZonePattern", "文案留白模式"),
    ]
    out = []
    for key, label in keys:
        value = profile.get(key)
        if value not in (None, "", [], {}):
            out.append(f"{label}: {value}")
    return out
CATEGORY_RENDER_GUIDE: dict[str, dict[str, Any]] = {
    "electronics": {
        "keywords": ["3c", "数码", "电子", "耳机", "手机", "键盘", "鼠标", "充电", "家电", "电器", "牙刷"],
        "materialCues": [
            "若证据中可见金属，保留真实表面处理与拉丝/喷砂方向，使用受控高光而非镜面塑料反光",
            "若证据中可见哑光塑料，保留低反射、细腻表面，不做玩具式高亮",
            "玻璃或透明件保持边缘折射、透光与真实厚度感，不发灰、不乳化",
        ],
        "lighting": "方向明确的商品摄影主光，优先侧上方或前侧上方；中等对比，保留结构边缘与真实高光，配合柔和补光和接触阴影",
        "avoid": ["无意义蓝紫霓虹", "科幻粒子包围商品", "凭空芯片/电路爆炸视觉", "强彩色光污染改变商品真实颜色", "悬浮且无接触阴影"],
    },
    "beauty": {
        "keywords": ["护肤", "美妆", "面霜", "精华", "香水", "口红", "粉底", "个护"],
        "materialCues": [
            "玻璃瓶体保持通透、边缘折射和真实高光，不做过曝白边",
            "哑光或磨砂包装保持柔和低反射，标签区域不变形",
            "液体/膏体只有在原始证据明确可见时才表现其真实质地，不凭空推断配方",
        ],
        "lighting": "柔和大面积主光配轻侧向塑形，低到中等对比，受控高光，避免玻璃炸白和塑料化反射",
        "avoid": ["无证据功效可视化", "医学实验室伪认证", "过度液体飞溅", "无来源成分植物", "皮肤塑料化"],
    },
    "fashion": {
        "keywords": ["服装", "女装", "男装", "裙", "衬衫", "裤", "鞋", "包", "配饰", "纺织"],
        "materialCues": [
            "保留真实织物纹理、缝线、接缝、褶皱和自然垂坠",
            "不把哑光织物渲染成塑料或镜面材质",
            "五金件仅按证据表现真实数量、位置和光泽",
        ],
        "lighting": "柔和侧光或前侧光，帮助读取纹理、褶皱和轮廓；避免平光抹掉面料结构",
        "avoid": ["凭空改变版型", "新增图案/logo", "过度硬挺不符合面料重量", "人台或肢体遮挡关键商品结构"],
    },
    "food": {
        "keywords": ["食品", "零食", "饮料", "咖啡", "茶", "坚果", "饼干", "酒", "餐饮"],
        "materialCues": [
            "包装保持真实印刷区域、封口、透明窗和结构",
            "内容物只有原图或用户资料确认时才出现，颜色、份量和形态不得夸大",
            "液体与食物表面反射、湿润度、蒸汽等只在符合真实状态时使用",
        ],
        "lighting": "自然暖侧光或侧逆光突出真实纹理与体积，保持包装颜色准确，避免过饱和",
        "avoid": ["凭空食材", "虚构营养数据", "夸张份量", "不真实蒸汽/飞溅", "包装文字重绘"],
    },
    "home": {
        "keywords": ["家居", "家具", "日用", "生活用品", "厨具", "收纳", "家纺"],
        "materialCues": [
            "木材保留真实木纹方向与表面处理",
            "陶瓷/石材/塑料按证据保留真实反射率和边缘结构",
            "软材质保持真实厚度、褶皱与接触关系",
        ],
        "lighting": "中性或微暖漫射主光配真实环境补光，接触阴影自然，避免 showroom 式漂浮",
        "avoid": ["不必要奢华大理石", "无证据材质升级", "比例失真", "道具遮挡", "复杂场景抢商品"],
    },
    "jewelry": {
        "keywords": ["珠宝", "首饰", "项链", "戒指", "耳环", "手表"],
        "materialCues": [
            "金属表面保持真实颜色与抛光/拉丝状态，控制镜面高光",
            "宝石切面、透明度与数量必须忠于证据，不新增宝石",
            "细小扣件、爪镶、链节必须保持结构一致",
        ],
        "lighting": "小面积聚光与柔光结合，保留金属轮廓和宝石高光，但避免炸白与过度星芒",
        "avoid": ["新增宝石", "改变镶嵌结构", "夸张星芒", "镜面高光覆盖细节", "第三方奢侈品牌语言"],
    },
    "generic": {
        "keywords": [],
        "materialCues": [
            "所有材质只按参考图和明确事实表现；未知材质不命名、不升级",
            "保留真实表面处理、边缘、反射和接触阴影",
            "商品自身颜色忠于参考图，不用彩色光改变真实色相",
        ],
        "lighting": "方向明确的商业商品摄影主光 + 克制补光 + 真实接触阴影，中性白平衡优先",
        "avoid": ["无意义粒子", "强视觉特效", "商品悬浮", "无证据材质升级", "复杂背景抢主体"],
    },
}


ASSET_SCAFFOLDS: dict[str, dict[str, Any]] = {
    "main_image": {
        "role": "搜索货架/主图级资产",
        "goal": "移动端缩略图中先识别商品本体与轮廓；一图只完成一个主要点击/识别任务",
        "must": ["完整或有意受控的商品轮廓", "商品为第一视觉", "主体与背景清楚分离", "低背景噪声", "真实接触阴影"],
        "avoid": ["复杂剧情", "碎道具堆叠", "强纹理背景", "无意义粒子/炫光", "商品过小"],
    },
    "asset_image": {
        "role": "可复用商品素材资产",
        "goal": "兼顾商品真实性、后续裁切和排版复用；避免一次性噱头",
        "must": ["结构准确", "裁切空间充足", "商业摄影光线稳定", "商品边缘清楚"],
        "avoid": ["过度装饰", "抢主体道具", "只适合一次活动的强主题元素"],
    },
    "detail_evidence": {
        "role": "单一证据细节资产",
        "goal": "只证明一个真实可见结构或表面证据；目标区域必须可核对",
        "must": ["证据部位清晰对焦", "数量/边缘/连接关系可核对", "浅景深只弱化非目标区域"],
        "avoid": ["同时讲多个卖点", "证据部位虚化", "新增不存在结构", "用视觉伪造性能/功效"],
    },
    "scene_image": {
        "role": "真实使用关系/场景资产",
        "goal": "用受控环境、人物或手部解释商品与真实使用关系，商品仍为主角",
        "must": ["人物/手部范围明确", "接触关系明确", "道具数量受控", "不遮挡关键身份结构"],
        "avoid": ["模型自由选择人物动作", "环境抢主体", "无证据功效演示", "错误握持/尺寸关系"],
    },
    "detail_section": {
        "role": "移动端详情页视觉底图",
        "goal": "承接上下屏信息节奏，并为程序化中文/参数排版预留稳定区域",
        "must": ["继承整套 Style Lock", "主体/证据/留白层级明确", "正式文字安全区低纹理低对比"],
        "avoid": ["单屏风格漂移", "生成正式参数文字", "安全区被主体或道具占据"],
    },
    "spec_base": {
        "role": "规格/参数信息底图",
        "goal": "只提供商品与信息承载空间，真实参数由程序后期渲染",
        "must": ["商品位置稳定", "大块严格安全区", "背景低纹理", "不自行生成数字/单位/认证"],
        "avoid": ["视觉估算尺寸并当真", "生成参数表文字", "假认证/假图标", "复杂背景"],
    },
    "cgi_style": {
        "role": "CGI/3D质感商品视觉",
        "goal": "在不声称真实三维建模的前提下，用受控透视、光影和空间表现强化商品体积感",
        "must": ["只使用有参考覆盖的可见结构", "结构与比例保持", "材质与光影物理关系可信"],
        "avoid": ["把生成视角冒充真实3D模型", "猜测不可见背面", "凭空内部结构", "无证据360度展示"],
    },
}



ASSET_VISUAL_ROLE_CONTRACTS: dict[str, dict[str, Any]] = {
    "main_01": {
        "visualRole": "catalog_identity_hero",
        "purpose": "用完整、干净、强识别的商品外观建立货架第一印象",
        "camera": {"shot":"full_product","height":"eye_level","focalLengthFeel":"product_85mm","horizontalAngleDeg":0,"verticalAngleDeg":0},
        "product": {"occupancyPct":72,"crop":"full","facing":"front"},
        "humanAllowed": False, "scenePolicy": "catalog_exempt",
    },
    "main_02": {
        "visualRole": "master_scene_usage_hero",
        "purpose": "在母场景中解释真实使用关系，不承担细节微距任务",
        "camera": {"shot":"medium","height":"eye_level","focalLengthFeel":"normal_50mm","horizontalAngleDeg":20,"verticalAngleDeg":0},
        "product": {"occupancyPct":52,"crop":"full","facing":"three_quarter_right"},
        "humanAllowed": True, "scenePolicy": "inherit_master_scene",
    },
    "main_03": {
        "visualRole": "single_proof_closeup",
        "purpose": "只证明一个最重要的可视结构/表面证据，不重复场景使用图",
        "camera": {"shot":"closeup","height":"eye_level","focalLengthFeel":"macro","horizontalAngleDeg":0,"verticalAngleDeg":0},
        "product": {"occupancyPct":78,"crop":"intentional_detail","facing":"front"},
        "humanAllowed": False, "scenePolicy": "derived_from_master_scene",
    },
    "asset_01": {
        "visualRole": "reusable_full_product",
        "purpose": "形成可复用的完整商品素材，保留后续裁切空间",
        "camera": {"shot":"full_product","height":"eye_level","focalLengthFeel":"product_85mm","horizontalAngleDeg":10,"verticalAngleDeg":0},
        "product": {"occupancyPct":62,"crop":"full","facing":"three_quarter_right"},
        "humanAllowed": False, "scenePolicy": "derived_from_master_scene",
    },
    "asset_02": {
        "visualRole": "surface_detail_macro",
        "purpose": "展示一个真实材质/表面/结构细节，作为证据型素材",
        "camera": {"shot":"macro","height":"eye_level","focalLengthFeel":"macro","horizontalAngleDeg":0,"verticalAngleDeg":0},
        "product": {"occupancyPct":82,"crop":"intentional_detail","facing":"front"},
        "humanAllowed": False, "scenePolicy": "derived_from_master_scene",
    },
    "asset_03": {
        "visualRole": "usage_relationship_asset",
        "purpose": "用受控手部/人物关系解释真实使用，不与主图重复同一构图",
        "camera": {"shot":"medium_closeup","height":"slight_high","focalLengthFeel":"normal_50mm","horizontalAngleDeg":35,"verticalAngleDeg":8},
        "product": {"occupancyPct":42,"crop":"full","facing":"three_quarter_left"},
        "humanAllowed": True, "scenePolicy": "inherit_master_scene",
    },
    "asset_04": {
        "visualRole": "information_base",
        "purpose": "生成低干扰信息承载底图，商品与大留白并存",
        "camera": {"shot":"full_product","height":"eye_level","focalLengthFeel":"product_85mm","horizontalAngleDeg":5,"verticalAngleDeg":0},
        "product": {"occupancyPct":40,"crop":"full","facing":"three_quarter_right"},
        "humanAllowed": False, "scenePolicy": "derived_from_master_scene",
    },
    "detail_01": {
        "visualRole": "detail_opening_hero",
        "detailRole": "认知首屏",
        "purpose": "首屏建立商品与母场景关系，完整展示商品，不做微距",
        "camera": {"shot":"medium","height":"eye_level","focalLengthFeel":"product_85mm","horizontalAngleDeg":15,"verticalAngleDeg":0},
        "product": {"occupancyPct":60,"crop":"full","facing":"three_quarter_right"},
        "humanAllowed": False, "scenePolicy": "inherit_master_scene",
    },
    "detail_02": {
        "visualRole": "detail_usage_context",
        "detailRole": "使用语境",
        "purpose": "在同一母场景中展示一个真实使用动作或尺度关系",
        "camera": {"shot":"medium","height":"slight_high","focalLengthFeel":"normal_50mm","horizontalAngleDeg":28,"verticalAngleDeg":8},
        "product": {"occupancyPct":48,"crop":"full","facing":"three_quarter_right"},
        "humanAllowed": True, "scenePolicy": "inherit_master_scene",
    },
    "detail_03": {
        "visualRole": "detail_primary_proof",
        "detailRole": "第一证据",
        "purpose": "用微距只证明一个主证据部位，证据区域必须清晰可核对",
        "camera": {"shot":"macro","height":"eye_level","focalLengthFeel":"macro","horizontalAngleDeg":0,"verticalAngleDeg":0},
        "product": {"occupancyPct":82,"crop":"intentional_detail","facing":"front"},
        "humanAllowed": False, "scenePolicy": "derived_from_master_scene",
    },
    "detail_04": {
        "visualRole": "detail_decision_reason",
        "detailRole": "决策理由",
        "purpose": "以完整/半完整商品视角承载第二决策理由；不得重复 D3 微距语法",
        "camera": {"shot":"medium_closeup","height":"slight_high","focalLengthFeel":"normal_50mm","horizontalAngleDeg":32,"verticalAngleDeg":10},
        "product": {"occupancyPct":56,"crop":"allowed_minor","facing":"three_quarter_left"},
        "humanAllowed": False, "scenePolicy": "derived_from_master_scene",
    },
    "detail_05": {
        "visualRole": "detail_structure_verification",
        "detailRole": "结构核对",
        "purpose": "从完整商品结构视角核对轮廓、部件数量与关系；不得使用微距裁切",
        "camera": {"shot":"full_product","height":"slight_high","focalLengthFeel":"product_85mm","horizontalAngleDeg":0,"verticalAngleDeg":6},
        "product": {"occupancyPct":66,"crop":"full","facing":"front"},
        "humanAllowed": False, "scenePolicy": "derived_from_master_scene",
    },
    "detail_06": {
        "visualRole": "detail_specs_closing",
        "detailRole": "规格与收束",
        "purpose": "商品缩至一侧，预留大规格信息区；参数只由程序后期渲染",
        "camera": {"shot":"full_product","height":"eye_level","focalLengthFeel":"product_85mm","horizontalAngleDeg":8,"verticalAngleDeg":0},
        "product": {"occupancyPct":36,"crop":"full","facing":"three_quarter_right"},
        "humanAllowed": False, "scenePolicy": "derived_from_master_scene",
    },
}


def visual_role_contract(asset_id: str) -> dict[str, Any]:
    return dict(ASSET_VISUAL_ROLE_CONTRACTS.get(str(asset_id or "")) or {})


def apply_visual_role_contract(brief: dict, spec: dict | None) -> dict[str, Any]:
    """Enforce the minimum visual difference that makes each asset useful.

    The director may still decide composition details, props and safe areas, but
    these role-level camera/product axes are authoritative so that different
    assets cannot collapse into the same macro/closeup recipe.
    """
    from copy import deepcopy
    out = deepcopy(spec or {})
    role = visual_role_contract(brief.get("assetId"))
    if not role:
        return out
    camera = out.get("camera") if isinstance(out.get("camera"), dict) else {}
    camera.update(role.get("camera") or {})
    product = out.get("product") if isinstance(out.get("product"), dict) else {}
    product.update(role.get("product") or {})
    out["camera"] = camera
    out["product"] = product
    out["visualRoleContract"] = {
        "visualRole": role.get("visualRole"),
        "detailRole": role.get("detailRole"),
        "purpose": role.get("purpose"),
        "scenePolicy": role.get("scenePolicy"),
    }
    human = out.get("human") if isinstance(out.get("human"), dict) else {}
    if role.get("humanAllowed") is False:
        human = {"allowed": False, "scope": "none", "action": "", "handPosition": "", "gripPoint": ""}
    elif role.get("humanAllowed") is True:
        human.setdefault("allowed", True)
        if human.get("allowed") is not True:
            human["allowed"] = True
        if not human.get("scope") or human.get("scope") == "none":
            human["scope"] = "hand_only"
        human.setdefault("action", "一个真实、克制的使用动作")
        human.setdefault("handPosition", "靠近商品可持握区域")
        human.setdefault("gripPoint", "不得遮挡关键结构")
    out["human"] = human

    aid = str(brief.get("assetId") or "")
    composition = out.get("composition") if isinstance(out.get("composition"), dict) else {}
    depth = out.get("depth") if isinstance(out.get("depth"), dict) else {}
    safe = out.get("safeAreas") if isinstance(out.get("safeAreas"), list) else []
    if aid == "detail_03":
        composition.update({"layout":"单一证据微距占主画面，证据部位居中偏下","negativeSpace":"顶部短标题区","visualHierarchy":["主证据部位","商品其余弱化区域"]})
        depth.update({"depthOfField":"shallow","foreground":"none","backgroundDepth":"flat"})
        safe = [{"purpose":"title","xPct":5,"yPct":4,"widthPct":90,"heightPct":17,"cleanliness":"strict"}]
    elif aid == "detail_04":
        composition.update({"layout":"商品位于左/中部，右侧形成一个明确决策信息区；保持半完整商品关系","negativeSpace":"右侧约35%干净信息区","visualHierarchy":["商品整体关系","单一决策证据","程序文字区"]})
        depth.update({"depthOfField":"medium","foreground":"clean","backgroundDepth":"soft_depth"})
        safe = [{"purpose":"title","xPct":62,"yPct":12,"widthPct":33,"heightPct":72,"cleanliness":"strict"}]
    elif aid == "detail_05":
        composition.update({"layout":"完整商品居中，结构轮廓和已知部件关系全部可核对","negativeSpace":"四周保留均匀呼吸边距","visualHierarchy":["完整商品结构","必要结构提示区"]})
        depth.update({"depthOfField":"deep","foreground":"none","backgroundDepth":"flat"})
        safe = [{"purpose":"subtitle","xPct":5,"yPct":4,"widthPct":90,"heightPct":15,"cleanliness":"moderate"}]
    elif aid == "detail_01":
        composition.update({"layout":"详情首屏英雄构图，商品与母场景关系清晰","negativeSpace":"上部/侧部保留首屏标题区","visualHierarchy":["商品","母场景","程序标题区"]})
        safe = [{"purpose":"title","xPct":5,"yPct":4,"widthPct":90,"heightPct":20,"cleanliness":"strict"}]
    elif aid == "detail_02":
        composition.update({"layout":"同一母场景中的单一使用关系，人物/手部只承担尺度与使用解释","negativeSpace":"另一侧留说明区","visualHierarchy":["商品与使用关系","母场景","说明区"]})
        safe = [{"purpose":"subtitle","xPct":5,"yPct":5,"widthPct":42,"heightPct":25,"cleanliness":"strict"}]
    elif aid == "detail_06":
        composition.update({"layout":"商品固定在左侧/下侧，右侧大面积规格信息区","negativeSpace":"右侧严格低纹理参数区","visualHierarchy":["商品","程序参数区"]})
        depth.update({"depthOfField":"deep","foreground":"none","backgroundDepth":"flat"})
        safe = [{"purpose":"spec","xPct":49,"yPct":9,"widthPct":47,"heightPct":82,"cleanliness":"strict"}]
    elif aid == "main_02":
        composition.update({"layout":"场景型主图，商品仍为第一视觉，使用关系只做辅助","negativeSpace":"保留一处干净短文案区","visualHierarchy":["商品","使用关系","母场景"]})
    elif aid == "asset_03":
        composition.update({"layout":"辅助使用素材，采用与 main_02 不同的偏侧/轻高机位构图","negativeSpace":"局部留白，不复制主图文案区","visualHierarchy":["使用动作","商品","母场景"]})

    out["composition"] = composition
    out["depth"] = depth
    out["safeAreas"] = safe
    return out

def category_key(project: dict, profile: dict | None = None) -> str:
    text = " ".join([
        str((profile or {}).get("category") or ""),
        str(project.get("category") or ""),
        str(project.get("name") or ""),
    ]).lower()
    for key, guide in CATEGORY_RENDER_GUIDE.items():
        if key == "generic":
            continue
        if any(word.lower() in text for word in guide.get("keywords", [])):
            return key
    return "generic"


def category_render_guide(project: dict, profile: dict | None = None) -> dict[str, Any]:
    key = category_key(project, profile)
    return {"categoryKey": key, **CATEGORY_RENDER_GUIDE[key]}


def _palette_for_category(key: str) -> list[str]:
    return {
        "electronics": ["中性白", "浅冷灰", "商品自身主色"],
        "beauty": ["暖白", "低饱和浅灰/米色", "商品自身品牌色"],
        "fashion": ["暖白", "浅灰/米灰", "商品自身颜色"],
        "food": ["暖中性色", "包装自身主色", "少量自然食物色"],
        "home": ["暖白", "浅米灰", "商品自身材质色"],
        "jewelry": ["中性白/深灰二选一", "商品金属本色", "克制强调色"],
    }.get(key, ["中性白", "浅灰", "商品自身主色"])



MASTER_SCENE_BASELINES: dict[str, dict[str, Any]] = {
    "electronics": {
        "sceneContext": "明亮现代的家庭桌面/日常使用区",
        "background": "浅灰白墙面与简洁收纳层次，背景保持克制且可重复",
        "surface": "浅中性色哑光桌面",
        "fixedElements": ["一处低存在感的远景收纳/几何层次"],
        "lighting": {"direction": "左上方约45°", "quality": "柔和但方向明确的自然/商业混合光", "temperature": "neutral"},
        "colorFamily": ["中性白", "浅灰", "商品自身主色"],
        "depthSystem": "真实轻纵深，背景只做柔和层次，不更换场地",
    },
    "beauty": {
        "sceneContext": "明亮整洁的家庭梳妆台/浴室护理区",
        "background": "暖白墙面与低纹理护理空间，背景元素固定且克制",
        "surface": "浅色石材或哑光梳妆台面",
        "fixedElements": ["一处低存在感的护理空间背景层次"],
        "lighting": {"direction": "左上方约45°", "quality": "大面积柔和自然光，带轻微侧向塑形", "temperature": "neutral_warm"},
        "colorFamily": ["暖白", "浅米灰", "商品自身品牌色"],
        "depthSystem": "浅到中等纵深，护理空间保持同一方向与层次",
    },
    "fashion": {
        "sceneContext": "简洁统一的试衣/编辑展示空间",
        "background": "低纹理暖白或浅灰背景面，空间结构固定",
        "surface": "中性地面或简洁展示承托面",
        "fixedElements": ["固定的一处背景几何/墙面层次"],
        "lighting": {"direction": "左前上方", "quality": "柔和侧向塑形光", "temperature": "neutral"},
        "colorFamily": ["暖白", "浅灰/米灰", "商品自身颜色"],
        "depthSystem": "中等纵深，保持同一空间轴线",
    },
    "food": {
        "sceneContext": "明亮真实的家庭厨房/餐桌用餐区",
        "background": "暖白厨房背景与自然家居层次，固定同一空间",
        "surface": "浅色自然木桌或浅色石材台面",
        "fixedElements": ["一处固定的远景厨房层次"],
        "lighting": {"direction": "左上方/左侧窗光", "quality": "自然暖侧光，阴影真实", "temperature": "warm"},
        "colorFamily": ["暖白", "浅木色", "包装/商品自身主色"],
        "depthSystem": "真实家居纵深，背景可虚化但不换场地",
    },
    "home": {
        "sceneContext": "明亮现代的家庭厨房/餐桌早餐区",
        "background": "暖白墙面与浅色厨房柜体，左后方保持同一窗光方向",
        "surface": "浅色自然木桌面",
        "fixedElements": ["远景一处绿色植物或低存在感家居元素，位置保持稳定"],
        "lighting": {"direction": "左上方窗光约45°", "quality": "柔和自然日光，真实接触阴影", "temperature": "neutral_warm"},
        "colorFamily": ["暖白", "浅木色", "少量自然绿色", "商品自身颜色"],
        "depthSystem": "真实家庭空间纵深，背景可柔焦但不得换成另一套厨房/桌面",
    },
    "jewelry": {
        "sceneContext": "统一的简洁珠宝展示/梳妆台空间",
        "background": "中性浅色或深灰展示背景，整套只选一种并保持",
        "surface": "哑光展示台或细腻石材承托面",
        "fixedElements": ["固定的一处低存在感展示层次"],
        "lighting": {"direction": "左上方主光 + 固定轻补光", "quality": "小面积受控高光与柔光组合", "temperature": "neutral"},
        "colorFamily": ["中性白/深灰二选一", "商品金属本色", "克制强调色"],
        "depthSystem": "浅景深但保持同一展示空间",
    },
    "generic": {
        "sceneContext": "与商品用途一致的单一真实日常使用场景",
        "background": "干净低纹理的真实环境背景，整套固定同一空间关系",
        "surface": "与商品用途一致的简洁真实承托面",
        "fixedElements": ["一处固定且低存在感的背景元素"],
        "lighting": {"direction": "左前上方约45°", "quality": "方向明确的柔和商业摄影光", "temperature": "neutral"},
        "colorFamily": ["中性白", "浅灰", "商品自身主色"],
        "depthSystem": "中等真实纵深；允许裁切/虚化，不允许更换空间",
    },
}


def build_master_scene_lock(project: dict, profile: dict, strategy: dict | None = None) -> dict[str, Any]:
    """Create one physical scene system for all scene-bearing assets.

    Creative references may define how the scene looks, but never product facts.
    If no scene reference exists, use one deterministic category baseline. This
    is deliberately a *scene lock*, not a style adjective bundle.
    """
    strategy = strategy or {}
    key = category_key(project, profile)
    base = dict(MASTER_SCENE_BASELINES.get(key) or MASTER_SCENE_BASELINES["generic"])
    proposal = strategy.get("masterSceneProposal") if isinstance(strategy.get("masterSceneProposal"), dict) else {}
    creative_refs = profile.get("creativeReferenceProfiles") or []
    scene_ref = next((x for x in creative_refs if isinstance(x, dict) and x.get("sourceRole") == "SCENE_REFERENCE" and x.get("profile")), None)
    if not scene_ref:
        scene_ref = next((x for x in creative_refs if isinstance(x, dict) and x.get("profile")), None)
    ref_profile = (scene_ref or {}).get("profile") or {}

    purchase_context = next((str(x).strip() for x in strategy.get("purchaseContext") or [] if str(x).strip()), "")
    scene_context = str(proposal.get("sceneContext") or purchase_context or base["sceneContext"])
    background = str(ref_profile.get("backgroundGeometry") or proposal.get("background") or base["background"])
    surface = str(ref_profile.get("surfaceSystem") or proposal.get("surface") or base["surface"])
    fixed_elements = [str(x) for x in (proposal.get("fixedElements") or base.get("fixedElements") or []) if str(x).strip()]
    if ref_profile.get("propSystem"):
        fixed_elements = [f"参考场景固定道具关系：{ref_profile.get('propSystem')}"]
    lighting = dict(base.get("lighting") or {})
    proposed_light = proposal.get("lightingIntent") if isinstance(proposal.get("lightingIntent"), dict) else {}
    for k in ["direction", "quality", "temperature"]:
        if proposed_light.get(k):
            lighting[k] = str(proposed_light.get(k))
    if ref_profile.get("lightDirection"):
        lighting["direction"] = str(ref_profile.get("lightDirection"))
    if ref_profile.get("lightQuality"):
        lighting["quality"] = str(ref_profile.get("lightQuality"))
    colors = [str(x) for x in (proposal.get("colorFamily") or base.get("colorFamily") or []) if str(x).strip()]
    if ref_profile.get("colorRelationship"):
        colors = [f"参考场景色彩关系：{ref_profile.get('colorRelationship')}", "商品真实颜色优先"]
    depth = str(ref_profile.get("depthPattern") or proposal.get("depthSystem") or base.get("depthSystem") or "真实轻纵深")

    source = "creative_reference+strategy" if ref_profile else ("strategy" if proposal else "category_fallback")
    return {
        "schemaVersion": "master-scene-lock.v1",
        "sceneId": "master_scene_01",
        "sceneContext": scene_context,
        "background": background,
        "surface": surface,
        "lighting": lighting,
        "fixedElements": fixed_elements,
        "propPolicy": "道具只允许来自固定场景元素或单张任务明确允许的必要道具；不得随机换场地、换桌面、换窗户方向或增加无关装饰",
        "depthSystem": depth,
        "colorFamily": colors,
        "inheritanceRules": [
            "场景型主图、场景素材与详情场景必须继承同一物理场景、承托面与主光方向",
            "细节/规格资产可从母场景裁切、虚化或低纹理化，但不得引入另一套空间",
            "严格白底/目录 packshot 可显式 catalog_exempt，不强行继承物理背景",
        ],
        "sourceReferenceImageId": (scene_ref or {}).get("imageId"),
        "source": source,
        "strategyRationale": str(proposal.get("rationale") or ""),
    }


def scene_policy_for_asset(brief: dict, spec: dict | None = None) -> str:
    explicit = str(brief.get("scenePolicy") or "").strip()
    if explicit in {"catalog_exempt", "inherit_master_scene", "derived_from_master_scene"}:
        return explicit
    role_policy = str((visual_role_contract(brief.get("assetId")) or {}).get("scenePolicy") or "").strip()
    if role_policy in {"catalog_exempt", "inherit_master_scene", "derived_from_master_scene"}:
        return role_policy
    spec = spec or {}
    aid = str(brief.get("assetId") or "")
    title_task = " ".join([str(brief.get("title") or ""), str(brief.get("visualTask") or ""), str(brief.get("visualIntent") or "")]).lower()
    if aid == "main_01" or any(token in title_task for token in ["白底", "纯白", "packshot", "catalog", "目录图"]):
        return "catalog_exempt"
    scaffold = asset_scaffold(brief, spec).get("scaffoldKey")
    if scaffold == "scene_image" or (brief.get("type") == "main_image" and aid != "main_01"):
        return "inherit_master_scene"
    if scaffold in {"detail_evidence", "spec_base"} or brief.get("type") == "detail_section":
        return "derived_from_master_scene"
    return "derived_from_master_scene"


def apply_master_scene_to_visual_spec(brief: dict, spec: dict | None, master_scene: dict) -> dict[str, Any]:
    from copy import deepcopy
    out = deepcopy(spec or {})
    policy = scene_policy_for_asset(brief, out)
    out["masterSceneInheritance"] = {"sceneId": master_scene.get("sceneId"), "policy": policy}
    if policy == "catalog_exempt":
        return out

    env = out.get("environment") if isinstance(out.get("environment"), dict) else {}
    light = out.get("lighting") if isinstance(out.get("lighting"), dict) else {}
    color = out.get("colorDirection") if isinstance(out.get("colorDirection"), dict) else {}
    scene_light = master_scene.get("lighting") or {}
    fixed = master_scene.get("fixedElements") or []

    if policy == "inherit_master_scene":
        env["background"] = master_scene.get("background")
        env["surface"] = master_scene.get("surface")
        env["sceneLogic"] = f"必须位于 {master_scene.get('sceneContext')}；保持同一空间、同一承托面和同一背景关系。单张只允许改变景别、人物动作和局部构图。"
        env["fixedElements"] = fixed
    else:
        env["background"] = f"由母场景裁切/虚化/低纹理化得到：{master_scene.get('background')}"
        env["surface"] = master_scene.get("surface")
        env["sceneLogic"] = f"仍属于 {master_scene.get('sceneContext')}；允许微距裁切、背景虚化或信息区简化，但不得换成另一套空间/桌面/光向。"
        env["fixedElements"] = []

    light["direction"] = scene_light.get("direction") or light.get("direction") or "左前上方"
    light["key"] = scene_light.get("quality") or light.get("key") or "方向明确的柔和主光"
    light["temperature"] = scene_light.get("temperature") or light.get("temperature") or "neutral"
    light.setdefault("highlightControl", "保持商品真实材质与颜色，不因场景光改变商品身份")
    color["backgroundPalette"] = list(master_scene.get("colorFamily") or color.get("backgroundPalette") or [])

    out["environment"] = env
    out["lighting"] = light
    out["colorDirection"] = color
    return out


def master_scene_lines(lock: dict[str, Any], policy: str) -> list[str]:
    lighting = lock.get("lighting") or {}
    if policy == "catalog_exempt":
        return [
            f"Policy: catalog_exempt；本资产是严格目录/白底豁免，不强行使用物理场景。",
            f"但仍保持整套商品颜色与光线语法一致；母场景 sceneId={lock.get('sceneId')} 只作为系列连续性参考。",
        ]
    relation = "完整继承同一物理场景" if policy == "inherit_master_scene" else "从同一母场景派生裁切/虚化版本"
    return [
        f"Policy: {policy}；{relation}；sceneId={lock.get('sceneId')}。",
        f"Scene source: {lock.get('source') or 'unknown'}；strategy rationale: {lock.get('strategyRationale') or 'n/a'}。",
        f"Scene: {lock.get('sceneContext')}。Background: {lock.get('background')}。Surface: {lock.get('surface')}。",
        f"Lighting: direction={lighting.get('direction')}；quality={lighting.get('quality')}；temperature={lighting.get('temperature')}。",
        "Fixed elements: " + ("；".join(str(x) for x in lock.get("fixedElements") or []) or "无额外固定道具") + "。",
        f"Depth/props: {lock.get('depthSystem')}；{lock.get('propPolicy')}。",
        "禁止随机更换厨房/房间/桌面材质/窗户方向/主光方向；同一套图必须让用户感到来自同一次商品拍摄。",
    ]

def build_campaign_style_lock(project: dict, profile: dict, strategy: dict | None = None) -> dict[str, Any]:
    guide = category_render_guide(project, profile)
    strategy = strategy or {}
    positioning = strategy.get("visualPositioning") or {}
    tones = positioning.get("tone") or []
    visual_direction = "commercial product photography"
    if any("cgi" in str(x).lower() or "3d" in str(x).lower() for x in tones):
        visual_direction = "controlled CGI-style commercial product visual"

    creative_refs = profile.get("creativeReferenceProfiles") or []
    ref = next((x for x in creative_refs if isinstance(x, dict) and x.get("profile")), None)
    ref_profile = (ref or {}).get("profile") or {}
    palette = _palette_for_category(guide["categoryKey"])
    if ref_profile.get("colorRelationship"):
        palette = [f"参考案例色彩关系：{ref_profile.get('colorRelationship')}", "商品自身真实颜色优先"]
    background = "干净、低纹理、移动端优先的商业背景；同一套图保持相近色相家族与材质语言"
    if ref_profile.get("backgroundGeometry"):
        background = f"参考案例的背景组织方式：{ref_profile.get('backgroundGeometry')}；只迁移空间/几何方法，不继承参考商品、品牌或文字"
    lighting = guide["lighting"]
    if ref_profile.get("lightDirection") or ref_profile.get("lightQuality"):
        lighting = f"方向={ref_profile.get('lightDirection') or '按类目基线'}；质感={ref_profile.get('lightQuality') or guide['lighting']}；商品真实颜色优先"
    layout = "商品优先、层级清楚、移动端可读；信息型资产保留稳定安全区，装饰元素不得跨屏漂移"
    layout_parts = [str(ref_profile.get(k)) for k in ("compositionPattern","negativeSpacePattern","copyZonePattern","visualHierarchy") if ref_profile.get(k)]
    if layout_parts:
        layout = "参考案例只迁移版式方法：" + "；".join(layout_parts)
    presentation = "真实比例、稳定尺度语言、清楚轮廓；角度可按单张任务变化，但不得违反参考覆盖和 IdentityLock"
    if ref_profile.get("cameraPattern") or ref_profile.get("productOccupancy"):
        presentation = f"参考案例镜头方法={ref_profile.get('cameraPattern') or '未指定'}；主体占比模式={ref_profile.get('productOccupancy') or '未指定'}；仅迁移拍摄方法，不继承参考商品结构"

    return {
        "schemaVersion": "campaign-style-lock.v1.1",
        "visualDirection": visual_direction,
        "colorPalette": palette,
        "colorTemperature": "中性为主；若类目语法或参考案例明确要求暖/冷，仅做轻微偏移，不改变商品真实颜色",
        "backgroundSystem": background,
        "lightingSystem": lighting,
        "layoutSystem": layout,
        "productPresentation": presentation,
        "lockedImmutable": ["商品真实颜色", "已确认表面外观", "整套背景色相家族", "主光方向语法", "商品优先的视觉层级"],
        "categoryRenderGuide": guide,
        "creativeReferenceSource": ref.get("imageId") if ref else None,
    }


def asset_scaffold(brief: dict, spec: dict | None = None) -> dict[str, Any]:
    typ = str(brief.get("type") or "asset_image")
    spec = spec or {}
    shot = str(((spec.get("camera") or {}).get("shot") or ""))
    aid = str(brief.get("assetId") or "")
    title = str(brief.get("title") or "")

    key = typ if typ in ASSET_SCAFFOLDS else "asset_image"
    if typ == "detail_section" and (aid.endswith("06") or "规格" in title or "参数" in title):
        key = "spec_base"
    elif shot in {"macro", "closeup", "extreme_closeup"} and typ != "main_image":
        key = "detail_evidence"
    elif ((spec.get("human") or {}).get("allowed")):
        key = "scene_image"
    elif any(token in title.lower() for token in ["3d", "cgi", "多角度"]):
        key = "cgi_style"
    return {"scaffoldKey": key, **ASSET_SCAFFOLDS[key]}


def style_lock_lines(lock: dict[str, Any]) -> list[str]:
    palette = " / ".join(str(x) for x in lock.get("colorPalette") or [])
    return [
        f"Direction: {lock.get('visualDirection','commercial product photography')}；palette={palette}；temperature={lock.get('colorTemperature','中性')}",
        f"Background: {lock.get('backgroundSystem','干净低纹理商业背景')}",
        f"Lighting: {lock.get('lightingSystem','方向明确的商业商品摄影光')}",
        f"Layout/Product: {lock.get('layoutSystem','商品优先、层级清楚')}；{lock.get('productPresentation','真实比例、稳定尺度语言')}",
        "Locked: " + "；".join(str(x) for x in lock.get("lockedImmutable") or []),
    ]
