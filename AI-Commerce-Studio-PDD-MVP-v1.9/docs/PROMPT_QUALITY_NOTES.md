# Prompt Quality Guardrails v1.9 / PromptCompilerV2.4

## 核心原则

高质量 Prompt 不是形容词更多，而是减少模型猜测。最终 Prompt 应优先回答：

1. 这是什么资产、只完成什么任务？
2. 哪些图片是商品事实，哪些只是视觉参考？
3. 商品真实轮廓、颜色、结构、Logo/文字、表面外观是什么？
4. 参考案例只允许迁移哪些构图/灯光/背景方法？
5. 镜头、占比、裁切、留白、背景、灯光、道具具体怎么执行？
6. 哪些事实和结构绝对不能改变？

## SourceRole 硬规则

`PRODUCT_TRUTH / PRODUCT_DETAIL / PACKAGING_TRUTH` 可提供商品事实。

`STYLE_REFERENCE / LAYOUT_REFERENCE / SCENE_REFERENCE` 只提供 CreativeReferenceProfile，不得证明用户商品身份、材质成分、结构、Logo、参数、包装或附件。

## Surface Appearance

只描述视觉可观察属性：哑光/光面、低/高反射、透明/半透明、拉丝观感、织物纹理、微细节、边缘形态等。禁止仅凭像素断定不可见的化学材质成分或具体材料牌号。

## Creative Reference

参考爆款图不是复制对象，而是方法来源。只迁移：构图、主体占比、机位模式、背景几何、承托面、道具关系、光线、对比、色彩关系、空间、留白、视觉层级与文案安全区。

## Prompt Density

避免重复写“真实、保持一致、不要改变”等同义原则。优先使用当前商品专属信息；通用类目经验只在当前商品没有表面证据时作为保守 fallback。

## Live 验证边界

本地测试只能证明契约与编译行为正确。真正判断 Prompt 是否能稳定产出高质量拼多多电商图片，必须用真实商品素材和真实 Seedream 调用做 A/B 样本验收。


## v1.9 Anti-homogeneity

- `PromptReadinessV1` blocks Live planning when product visual truth is effectively empty.
- Every image asset has one fixed VisualRoleContract.
- `detail_03 / detail_04 / detail_05` must use three different shot families: macro proof / medium-close decision / full-product structure verification.
- `main_02` and `asset_03` may both show usage, but their angle, framing and occupancy are forced apart.
- MasterScene is proposed by CommerceStrategy from ProductProfile + purchaseContext + CreativeReferenceProfile; category baseline is fallback only.
