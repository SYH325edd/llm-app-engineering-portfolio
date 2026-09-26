> 历史文档：Storyboard v14 行为。自 Storyboard v16 起，Dialogue 不再以整条 Script line 作为唯一 atomic 粒度，而由 Runtime 在完整强句界生成句级 FrozenTextUnit。

# Storyboard FrozenTextUnit v14

## 目标

Stage 4 不再让模型抄写或任意切分 Script dialogue / narration。Script 是文本唯一权威；Storyboard 只决定完整冻结文本单元分配到哪个 Shot。

## FrozenTextUnit

- Dialogue：每条 Script dialogue line 是一个不可拆分单元。
- Narration：仅在 `。！？；!?;` 等强语义边界、且不位于未闭合引号内部时切分。
- 逗号不是切分边界。
- unit_id 确定性生成，例如 `FTU_B014_N002`。

模型输出：

- `dialogue_unit_refs: string[]`
- `narration_unit_refs: string[]`

模型不输出 dialogue / narration 正文。Runtime 在 canonicalize 阶段根据 unit_id 还原 exact Script text 和 speaker，然后删除 unit refs，使下游仍消费既有 canonical `dialogue` / `narration` 结构。

## Hard Gate

每个 Beat 的 FrozenTextUnit 必须：

1. 只引用当前 Beat；
2. channel 正确；
3. 按原顺序；
4. 恰好出现一次；
5. 不重复；
6. 不遗漏；
7. 不拆 unit。

因此 `他停了一秒，又走了。` 不允许再被拆成 `他停了一秒，` + `又走了。`。

## 兼容边界

Provider JSON Schema v14 使用 unit ref 数组。为旧 fixture / json_object fallback 保留窄兼容路径：若模型仍输出 raw dialogue/narration，则只有在其天然已经等于完整 FrozenTextUnit 时才允许通过；任意 mid-unit split 继续 hard fail。

## 下游

Canonical Storyboard 不保留 FTU ID；Production Semantics、Director、State/ShotSpec、Consumption v2c 继续消费原有 `dialogue` / `narration` 字段，因此无需改下游 schema。
