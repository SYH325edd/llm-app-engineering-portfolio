# Stage 01 — Story Bible Contract (FROZEN-01)

## 目标

把小说原文转换为**唯一叙事事实源**。本 Stage 不做 Scene Plan、Script、Storyboard、Director 或生产设计。

## Input Contract

模型语义输入只有：

```json
{
  "source_text": "<完整小说原文>",
  "output_template": {},
  "output_contract": {},
  "contract_version": "story_bible.v4"
}
```

`output_template/output_contract` 是格式约束，不是新的叙事事实。

禁止输入：Scene Plan、Script、Storyboard、PVB/PSB、Director、旧 Story Bible 输出。

## Ownership

### 模型拥有

- characters/scenes/props/narrative_contexts 的**语义实体与源文顺序**
- canonical_name / aliases / role_type
- explicit_facts / inferred_facts
- identity_lock
- 原文明示的 visual_lock
- source_evidence
- narrative context 的 reality_status / temporal_mode / representation_mode

### 程序拥有

- `bible_id`
- `project_id`
- `version`
- `character_id`
- `scene_id`
- `prop_id`
- `context_id`

程序按模型数组中的首次出现顺序确定性分配：

```text
char_001...
scene_001...
prop_001...
context_001...
```

模型生成的 ID 永远不进入 canonical checkpoint。

## Canonical Output

### Top level

```text
bible_id
project_id
version
characters[]
scenes[]
props[]
narrative_contexts[]
```

### Character

```text
character_id
canonical_name
aliases[]
role_type
explicit_facts[]
inferred_facts[]
identity_lock{}
visual_lock{}
source_evidence[{quote}]
```

`role_type`：`main | supporting | background | referenced_only`。

Character `visual_lock` 只允许：

```text
age_appearance face hair body skin
default outerwear shirt footwear accessory
```

### Physical Scene

```text
scene_id
canonical_name
name
time
weather
explicit_facts[]
visual_lock{}
source_evidence[{quote}]
```

Scene `visual_lock` 只允许：

```text
space layout materials lighting color environment
```

### Prop

```text
prop_id
canonical_name
name
aliases[]
narrative_importance
visual_presence
visual_asset_required: boolean
explicit_facts[]
source_evidence[{quote}]
```

### Narrative Context

```text
context_id
reality_status
temporal_mode
representation_mode
source_evidence[{quote}]
```

没有真实上下文变化时必须为 `[]`。

## Validation Order

```text
Provider JSON parse
→ program-owned metadata/ID canonicalization
→ container Shape Gate
→ required scalar/list/object checks
→ exact duplicate canonical entity check
→ role/visual-lock authority checks
→ source_evidence.quote exact source containment
→ checkpoint
```

### Evidence rule

每个 Story entity/context 至少有一条 `source_evidence`。
`quote` 必须是非空字符串，并且是 `source_text` 的逐字子串。

### Duplicate rule

只拦截**完全相同 canonical_name** 的 character/physical scene/prop。
不做模糊实体合并，不根据相似名称擅自认定同一实体。

## Checkpoint Contract

Checkpoint 保存的是 canonical Story Bible，不保存 raw model ID。
`input_hash` 只由：

```text
contract_version + source_text + output contract/template
```

决定。

Story Bible contract 变化时旧 checkpoint 自动失效；下游 checkpoint 由上游 hash 级联判断是否重算。

## Consumers

只有以下 Stage 可以读取 canonical Story Bible：

- Scene Plan
- Script context selection
- PVB
- PSB
- Style Guide
- Director ContextBuilder
- Frozen Compiler

任何下游不得读取 Story Bible raw model response。

## v4 exact-field gate

Story Bible canonical output 使用精确字段集合。顶层、character/scene/prop/context entity 以及 `source_evidence` 对象出现未声明字段时，当前 Unit 直接报 `extra_story_bible_field` 并定点 Repair。`identity_lock` 内部键不做机械白名单，但仍必须服从原文事实与证据边界。


## v7 targeted semantic repair

`story_bible_fact_not_supported` is not treated as a generic evidence-format error. The validator now returns the exact `target_path`, `evidence_path`, `source_refs` and a repair action. Repair first preserves the source-facing fact surface: if person/entity reference, subject/object roles, or action direction were normalized without direct evidence, only that factual leaf is rewritten into source-faithful wording. Evidence is expanded only when the fact wording is already source-faithful but its smallest supporting window is incomplete; truly unsupported facts are corrected or removed only at the validator-targeted leaf. All unrelated facts remain frozen.

Initial extraction also keeps `explicit_facts` source-faithful: preserve source person/perspective where possible and do not merge separately evidenced clauses into one fact without binding all required source refs.

In `story_bible.v11`, every evidence-bound factual leaf must be established by a minimal contiguous source-evidence window. The runtime may deterministically widen the current evidence by up to four adjacent source units when a conservative bigram-support gate proves the widened window supports all leaves bound to that evidence item. This handles local ellipsis, speaker/coreference context, and immediately adjacent facts without stitching distant evidence. If no such window exists, targeted Repair may correct/shrink/remove only the failing factual leaf. `scene.visual_lock.environment` remains limited to source-established visible/stated environment elements and spatial relations.

### v11 identity-lock authority correction

`identity_lock` is a normalized, source-derived identity attribute layer rather than a verbatim fact surface. Every nonempty identity leaf must still have valid local `source_evidence` and `supports`, but weak lexical overlap between the normalized value and the source wording is advisory (`story_bible_identity_lock_weak_lexical_anchor`) rather than a hard validation failure. `explicit_facts` and `visual_lock` retain their existing hard source-support behavior.
