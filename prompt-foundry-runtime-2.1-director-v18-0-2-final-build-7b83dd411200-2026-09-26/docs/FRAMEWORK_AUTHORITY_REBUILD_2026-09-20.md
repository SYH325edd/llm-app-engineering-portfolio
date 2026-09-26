# Prompt Foundry Runtime 2.1 — Framework Authority Rebuild

## Objective

本轮不是修某一个小说，也不是为某条 validation error 增加特判。目标是解决此前连续暂停的共同根因：Stage 的生成职责、事实权威、词面启发式、Repair 和下游消费边界混在一起，导致合法的跨粒度语义转换被当成事实错误。

## Root causes closed

1. **Semantic summary ≠ extractive quote**：Scene Plan / Script 的 description 不再由 lexical similarity 充当硬事实 Gate。
2. **Semantic transform ≠ source text**：Storyboard / Production Semantics 的镜头化、生产化表达允许措辞变化；exact evidence 仍保持硬 provenance。
3. **Provider structure first**：Ark 支持时优先 `json_schema`，不支持时自动记忆并降级 `json_object`。
4. **Program-owned values stay program-owned**：例如 dialogue offscreen 由 speaker visibility 确定性派生。
5. **Repair targets are machine-readable**：模型不再从错误字符串猜目标。
6. **One semantic Repair only**：网络重试与语义修复分层，避免请求爆炸与漂移。
7. **Authority is observable**：Unit contract trace 记录 authority matrix；attempt 记录 hard/warning 类型。

## Regression guarantees

- Scene Plan summary 低词面重合：warning，主链继续。
- Storyboard 合法镜头化改写低词面重合：warning，主链继续。
- Production Semantics 合法生产化改写低词面重合：warning，主链继续。
- fabricated source quote：hard fail。
- dialogue/narration 漏字/改字/换序：hard fail。
- unknown ref / enum / type：hard fail。
- Story-changing production choice：hard fail。
- state / continuity conflict：hard fail。

## Current contracts

- Story Bible `story_bible.v11`
- Scene Plan `scene_plan.v7`
- Script `script_scene.v7`
- Storyboard `storyboard_scene.v14`
- PVB `pvb_character.v3`
- PSB `psb_scene.v5`
- Style `style_guide.v3`
- Production Semantics `production_semantics_shot.v1h`
- Director `director_shot.v15`
- State + ShotSpec `state_shotspec.v2`
- Compiler `consumption_v2b`
