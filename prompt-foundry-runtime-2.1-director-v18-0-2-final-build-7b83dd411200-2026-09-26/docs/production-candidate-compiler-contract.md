# Production Candidate Compiler Closeout Contract

Status: frozen for Runtime 2.1 Production Candidate closeout.
Scope: Director validation, deterministic ShotSpec/Consumption Compiler, final renderer/readiness. No new Stage or model call.

## Frozen terms

1. **Minimal Sufficient Anchor** — the smallest canonical identity subset needed for one Shot prompt to remain independently generatable. It is selected from canonical assets; it is not invented from per-shot prose.
2. **Visibility-aware Anchor** — anchor selection follows what the current framing/focus can actually show. Face crops prioritize hair/face identity; medium/full framing may include silhouette/body and wardrobe; local detail uses the relevant local canonical feature. Invisible detail is not copied merely for completeness.
3. **Continuity Budget** — character anchors + scene anchor + effective scene state. Global visual style remains rendered in every self-contained Shot but is not counted as continuity state. Warning budget: `min(240, max(120, 105 + visible_character_count * 35))`.
4. **Subject Ownership** — `performance_action.character_ref` is the declared actor. E021 v1 detects either (a) an exact *other visible canonical_name* before the first recognized action verb, or (b) the declared canonical_name immediately followed by a redundant third-person pronoun (e.g. 角色甲他…). No alias, nickname, relationship-title, free pronoun resolution or fuzzy matching.
5. **Self-contained Shot** — a final 13-field Shot prompt can be consumed independently, without previous-shot prose, UI-hidden context or external explanation.

## Shared Visible Character definition

`visible_character_refs` is shared by E021, W009, W010 and character-anchor selection:

- `primary_subject_refs`
- union `reaction_target_refs`
- union current-shot characters with an explicit resolved `position`

It excludes a character that exists only in the broad `character_refs` allow-list, an off-screen dialogue-only speaker, or a narration-only mention. Legacy checkpoints without Director visibility fields may use the compatibility fallback only to preserve old data readability.

## Time authority

`authoritative_scene_time` is resolved in this order:

1. `ShotSpec.authoritative_scene_time`
2. Scene Plan time copied deterministically into ShotSpec
3. explicit `state_in.environment.time_of_day|daypart|time`
4. unresolved: W008 is disabled

W008 uses a short high-confidence time-group conflict table. Ambiguous but plausible expressions such as afternoon + sunset are not hard conflicts and are not auto-rewritten.

## Frozen diagnostics

- `E021_DIRECTOR_PERFORMANCE_SUBJECT_MISMATCH` — metadata code on the Director hard validation `director_performance_subject_mismatch`; Repair is scoped to the current `performance_actions[i].action`.
- `E022_RENDERED_PROMPT_IR_LEAKAGE` — final top-level fields differ from the frozen 13-field whitelist, or `画面内容` contains an unapproved renderer-owned inline label. Approved inline labels are visible canonical character names plus `场景状态 / 整体视觉基调 / 画面内文字`.
- `E023_SHOT_NOT_SELF_CONTAINED` — first applicable self-containment requirement fails; one E023 is emitted per Shot evaluation pass.
- `W008_TIME_INCONSISTENCY` — high-confidence conflict against authoritative scene time.
- `W009_CONTINUITY_BUDGET_HIGH` — continuity budget exceeds the visible-character-adjusted limit.
- `W010_ACTION_AMBIGUOUS_SUBJECT` — ambiguous third-person action subject under the frozen deterministic conditions; warning only.
- `W011_NON_CHINESE_ASSET_FIELD` — pre-existing asset-language warning moved from W008 to avoid code collision.

## E023 evaluation order

1. Required: scene identity -> shot framing -> camera instruction -> shot-specific visual/action content. First missing item returns E023.
2. Conditional: visible character -> identity anchor; authoritative time -> effective scene state; dialogue/narration -> exact text survives compilation. First failed applicable condition returns E023.
3. Otherwise pass.

## Renderer whitelist

Final prompt top-level fields, in order, are exactly:

`镜号 / 时长 / 场景 / 人物空间站位 / 景别 / 摄法 / 画面内容 / 旁白 / 台词 / 动作音效 / 环境音效 / 氛围音效 / 配乐`

Internal IR field names are never rendered as additional top-level fields or nested `画面内容` labels. Appearance overlays are rendered as visual deltas, not as a `人物阶段` field.

## Director distribution Repair

`director_scene_design_monoculture` provides precise `repair_targets`, `must_change_any_of_paths`, current values and allowed alternatives. A Repair must change at least one listed dominant execution path while preserving plot facts, dialogue, shot purpose and visual target. The adjacent camera/movement distribution-pressure gate uses the same precise any-of Repair semantics. Returning every listed value unchanged is not a Repair.

## Cross-build resume

When a paused run was produced by a different `build_id`, validator-specific `source_repair_hints` are discarded before execution resumes. Completed semantic checkpoints are not eagerly deleted and remain eligible for normal input/contract reuse. The failed Unit is therefore regenerated/revalidated under the current Repair contract without replaying stale target metadata from the previous build. Same-build retries keep their repair hints.


## Scene-anchor closeout

Each Shot remains independently consumable. Stable scene continuity renders at most:

1. one concise structural space descriptor when it adds information beyond the scene name;
2. two stable layout landmarks (environment fallback only when needed);
3. one compact primary color summary.

Landmark material micro-detail and plot-prop accent colors do not enter the repeated scene anchor. Scene time/lighting is owned exclusively by `scene_state_anchor`; explicit environmental-light modifiers are stripped from appearance overlays, performance text and spatial blocking before final rendering.
