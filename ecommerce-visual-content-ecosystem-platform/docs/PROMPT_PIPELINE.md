# Prompt Pipeline Contract v2.4

Current main chain:

`SourceRoleV1 → EvidenceBundleV2.1 → ProductProfileV2 + IdentityLockV2 + SurfaceAppearance + CreativeReferenceProfileV1 → CommerceStrategyMap + MasterSceneProposal → CampaignStyleLockV1.1 + MasterSceneLockV1 → AssetBriefV2 + VisualRoleContract → ReferenceAssignmentV2 → VisualSpecV2 / VideoPlanV2 → PromptCompilerV2.4 → Prompt Review Gate → Generation → QC / Retry → Deterministic Renderer → Final Asset QC → Delivery Gate`

## 1. SourceRoleV1

Every uploaded image has an authoritative role. Product fact roles may prove product identity; creative reference roles only teach visual methods. Changing a source role invalidates Evidence/Profile/Plan/Prompt and requires re-analysis.

## 2. EvidenceBundleV2.1

The vision stage still follows “observe, do not infer”. Product fact images additionally extract observable surface appearance; creative reference images extract a CreativeReferenceProfile. Unknown material composition, unseen back structure, performance, efficacy, certification and numerical specifications are never invented.

## 3. ProductProfileV2 + IdentityLockV2

Only visual evidence from product-fact SourceRoles with sufficient confidence may become `visualProvable=true`. `confirmedFacts` are rebuilt from validated visual evidence. Creative reference facts are deterministically excluded.

`surfaceAppearance` and `creativeReferenceProfiles` are carried forward deterministically from EvidenceBundleV2.1 instead of being re-authored by the reasoning model.

## 4. CampaignStyleLockV1.1

If a CreativeReferenceProfile exists, its composition, camera, background, lighting and color relationships can influence the campaign style language. It cannot change product truth. Product color and confirmed surface appearance remain locked.

## 5. PromptCompilerV2.4

The compiler favors product-specific information over generic category advice. Actual SurfaceAppearance becomes material rendering instructions. CreativeReferenceProfile becomes visual-method language. Reference roles remain explicit in the final prompt.

Prompt 前新增 `PromptReadinessV1`：Live 商品视觉证据实质为空时 BLOCKED，不允许继续生产规划/编译。每个资产还带固定 `VisualRoleContract`，防止不同用途收敛成相同镜头。

Prompt sections:

1. ASSET ROLE
2. BUSINESS GOAL
3. VISUAL ROLE CONTRACT
4. CAMPAIGN STYLE LOCK
5. MASTER SCENE LOCK
6. CREATIVE REFERENCE PROFILE (when present)
7. PRODUCT TRUTH
8. PRODUCT EVIDENCE SUMMARY
9. REFERENCE ROLES
10. IDENTITY PRESERVE
11. SHOT BRIEF
12. COMPOSITION
13. MATERIAL RENDERING
14. LIGHTING
15. ENVIRONMENT & PROPS
16. HUMAN RULE
17. SAFE AREA
18. POST-RENDER POLICY
19. QUALITY TARGET
20. STRICT NEGATIVE CONSTRAINTS

The compiler avoids adjective stacking and repetitive “high-end/cinematic/8K” language. Specific subject, surface, camera, light, environment and preserve constraints take priority.

## 6. Reference enforcement

- No hidden all-source fallback.
- Creative references cannot become product-identity responsibilities after normalization.
- If a task requires a product reference but no product-fact reference is assigned, Live generation blocks.
- Video references only accept product-fact SourceRoles.

## 7. Formal text/spec policy

Image models generate visual bases. Formal Chinese copy, price, parameters, dimensions, certifications and promotions are program-rendered from verified data only. Missing data stays missing.

## 8. Validation boundary

Local tests validate contracts and compilation behavior. Actual “high-quality output” requires real Seedream Live generation with real products and a fixed A/B benchmark set.
