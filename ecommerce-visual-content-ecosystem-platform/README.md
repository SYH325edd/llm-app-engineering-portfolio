# E-commerce Visual Content Ecosystem Platform v1.9

本版本继续定位为“商品事实驱动的电商内容生产系统”，不是拼多多自动上架工具。v1.9 只针对上一轮 Prompt 审计确认的四个问题做工程级修复，不新增无关功能。

核心链路：

`SourceRoleV1 → EvidenceBundleV2.1 → ProductProfileV2 + IdentityLockV2 + SurfaceAppearance → CommerceStrategyMap + MasterSceneProposal → MasterSceneLockV1 → AssetBriefV2 + VisualRoleContract → ReferenceAssignmentV2 → VisualSpecV2 / VideoPlanV2 → PromptCompilerV2.4 → Prompt Review Gate → Seedream / Seedance → QC / Retry → Renderer → Detail Composer → Delivery Gate`

## v1.9 四项 Prompt 修复

1. **PromptReadinessV1：阻止“空证据的漂亮 Prompt”**  
   Live 模式在规划/编译前检查 PRODUCT_TRUTH 参考、confirmed visual facts、IdentityLock 和 SurfaceAppearance。商品视觉证据实质为空时直接 `BLOCKED`，不再用类目套话伪装成生产级 Prompt。最终 Prompt 新增 `[PRODUCT EVIDENCE SUMMARY]`，优先写商品专属事实。

2. **VisualRoleContract：资产级反同质化**  
   13 张图片都有固定视觉职责和最低镜头差异。`main_02` 与 `asset_03` 即使都表现使用关系，也必须使用不同景别/角度/占比；Visual Director 输出后程序再次归一化，禁止不同资产重新收敛为同一 closeup/macro。

3. **详情 D1–D6 角色硬约束**  
   D1=认知首屏、D2=使用语境、D3=第一证据微距、D4=第二决策理由中近景、D5=完整结构核对、D6=规格与收束。尤其 D3/D4/D5 的 shot / focal / crop / occupancy 必须不同，并有运行时 anti-homogeneity 校验。

4. **MasterScene 从“类目模板”升级为“策略场景”**  
   CommerceStrategy 新增 `masterSceneProposal`，由商品档案、purchaseContext 和 CreativeReferenceProfile 推导场景。优先级为：SCENE/Creative Reference → Strategy Proposal → Category Fallback。类目 baseline 只在缺少策略/参考时兜底。

## 继承的生产闭环

- MasterSceneLock 保证场景型主图、素材图和详情图来自同一拍摄空间；白底 packshot 可显式豁免。
- 商品正式中文、参数、价格、认证和促销仍由程序后期渲染；模型只生成视觉底图。
- Generation QC / Targeted Retry / Final Asset QC / Detail Composer Gate / Final Detail QC / Delivery Gate 保持不变。
- ReferenceAssignment 不存在时禁止静默使用全部源图。
- CGI/3D 质感视觉不等同于真实 Mesh/NeRF/360° 三维重建。

## Demo / Live 边界

- **Demo Safe Mode** 只验证编排、Prompt、渲染/拼接和交付程序，不代表真实 Seedream 出片质量；`promptReadiness=PREVIEW_ONLY`。
- **Live** 才执行真实素材视觉理解、事实融合、策略/导演、Seedream/Seedance 与视觉 QC。生产 Prompt 若商品视觉证据为空会被阻断。

## Windows 启动

双击 `start.bat`。首次自动创建 `.venv` 并安装依赖。默认地址 `http://127.0.0.1:8000/projects`，端口占用时自动尝试后续端口。

## 当前验证等级

本版本通过本地契约、Demo、单元/集成和静态语法验证。真实商业出片质量仍必须在配置 ARK API Key 后，用真实商品素材执行 Live A/B 验收。

详细说明见 `docs/ARCHITECTURE.md`、`docs/PROMPT_PIPELINE.md`、`docs/PROMPT_QUALITY_NOTES.md`、`docs/V1.9_CHANGELOG.md`。
