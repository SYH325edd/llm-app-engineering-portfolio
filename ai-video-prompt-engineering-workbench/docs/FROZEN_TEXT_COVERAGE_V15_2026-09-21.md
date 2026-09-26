> 历史文档：Storyboard v15 行为。自 Storyboard v16 起，dialogue utterance 可在完整句级 FrozenTextUnit 边界跨连续 Shot；utterance group 不再要求同镜。

# Frozen Text Coverage v15

## 目标

保证 Script 已冻结的 dialogue / narration 不仅“不可改写”，还必须从 Stage 4 一直到 Final Consumption Manifest 全程 100% 覆盖。

## 通用契约

1. `build_frozen_text_units()` 生成每 Beat 的 dialogue / narration unit。
2. dialogue unit 带 `utterance_group_id`。只有前一行以明确续接标点（`， , 、 ： :`）结束、且下一行 speaker 相同，才进入同一 utterance group。
3. 同一 utterance group 的全部 unit 必须分配到同一个 Shot。
4. Canonical Storyboard 增加程序字段 `frozen_text_unit_refs`，仅用于 provenance/coverage，不进入用户 Prompt。
5. State/ShotSpec 和 Final Manifest 只做 representation-preserving 透传。
6. compile 前构建 `frozen_text_coverage.v1`：
   - expected = Script inventory
   - storyboard = Canonical Storyboard refs
   - shot_specs = State/ShotSpec refs
   - compiled = Final Manifest provenance refs
7. 四层按 `scene_id::unit_id` 比较，避免 Scene 间 Beat ID 重复。
8. 每个 channel 都必须满足：0 missing / 0 duplicate / 0 unknown / 0 reorder。

## 兼容路径

旧 checkpoint 或 `json_object` fallback 若仍返回 raw dialogue/narration，Runtime 仅在文本本身已经逐字等于完整 FTU 时反推 refs。任意残句拆分、改词、改 speaker 都不能借兼容路径过 Gate。

## 明确不做

本阶段不判断 direct / quoted / voiceover；不根据具体小说词汇推断台词；不改时长、摄影、场景资产或 Style Guide。
