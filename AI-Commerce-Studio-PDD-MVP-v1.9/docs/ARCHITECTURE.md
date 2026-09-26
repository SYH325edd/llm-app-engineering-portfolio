# MVP Architecture v1.9 — Prompt Specificity + Anti-Homogeneity

## 1. Business pipeline

```text
Uploaded Assets + Merchant Facts
→ SourceRoleV1
→ EvidenceBundleV2.1
→ ProductProfileV2 + IdentityLockV2 + SurfaceAppearance
→ PromptReadinessV1
→ CommerceStrategyMap + MasterSceneProposal
→ CampaignStyleLockV1.1 + MasterSceneLockV1
→ AssetBriefV2 + VisualRoleContract
→ ReferenceAssignmentV2
→ VisualSpecV2 / VideoPlanV2
→ PromptCompilerV2.4
→ Prompt Review Gate
→ Seedream / Seedance
→ Generation QC / Targeted Retry
→ Deterministic Renderer / Final Asset QC
→ Detail Composer / Final Detail QC
→ Delivery Gate
→ PDD Material Package → Human Upload
```

## 2. PromptReadinessV1

Live 模式必须存在商品事实参考图，并且 `confirmedFacts / IdentityLock.features / SurfaceAppearance` 不能全部为空。否则直接 BLOCKED，禁止生成通用但看似完整的生产 Prompt。

## 3. VisualRoleContract

13 张图片的角色由程序固定。模型可以优化局部构图，但不得改掉角色或把不同资产重新收敛成同一种 closeup/macro。D3/D4/D5 有独立镜头签名硬约束。

## 4. Strategy-derived Master Scene

CommerceStrategy 输出 `masterSceneProposal`。MasterSceneLock 合并优先级：Creative/Scene Reference → Strategy Proposal → Category Fallback。类目模板不再是默认最终场景。

## 5. Product-specific Prompt

PromptCompilerV2.4 新增 `[PRODUCT EVIDENCE SUMMARY]` 与 `[VISUAL ROLE CONTRACT]`。真实商品事实、身份特征和 SurfaceAppearance 优先于类目经验。

## 6. Existing closure

ReferenceAssignment、程序排字/参数、Generation QC、Targeted Retry、Final Asset QC、Detail Composer Gate、Final Detail QC、Delivery Gate 保持不变。
