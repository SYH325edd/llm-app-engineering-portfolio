# Stage 07 — State Resolver + ShotSpec

Status: **FROZEN-07**  
Unit: `state_shotspec`  
Contract: `state_shotspec.v1`

这是纯 deterministic Stage，不调用 LLM。

## Input

完整、已通过 FROZEN-06 Director 验证的 Storyboard。

## Processing

直接委托 Frozen Core v1.3：

- continuity_scope → `state_in`
- Director + Base Shot → ShotSpec
- Shot 顺序与数量交叉检查

Runtime 不解析自然语言 `action_delta`，不推断 `state_out`，不新增动态状态。

## Output

按 Storyboard 顺序保存 ShotSpec 数组。任何 resolver/build 错误归属 `state_shotspec` Unit，并暂停 Run。
