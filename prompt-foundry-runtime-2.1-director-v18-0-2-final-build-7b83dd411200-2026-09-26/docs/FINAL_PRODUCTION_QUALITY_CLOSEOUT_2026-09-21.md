# Final Production Quality Closeout — 2026-09-21

## Scope

This closeout changes only the final consumption path. Story Bible, Scene Plan, Script, Storyboard, Production Semantics and Director semantic ownership remain unchanged.

## Compiler contract

Current compiler: `consumption_v2d`.

The Shot prompt is standalone, so every Shot keeps a compact stable identity/scene/style anchor. It does **not** copy complete PVB/PSB/Style text.

### v2c rules

1. Character identity is reduced to stable visible anchors; time-bound lighting/environment phrasing is removed.
2. Scene assets are cleaned with the same deterministic asset rules used by scene-asset compilation. Time-specific lighting belongs to Script/Shot time, not stable scene assets.
3. Layout/material/environment clauses are selected only when lexically relevant to the current Shot's visible context.
4. A relevant environment sublocation may be surfaced as `当前子空间` without changing the upstream scene ID.
5. Style Guide is reduced to executable visual traits such as 写实生活流、低饱和、暖调、轻微胶片颗粒、克制自然. Story facts and narrative background are not serialized into the Shot prompt.
6. `Director.dramatic_intent` is not rendered into the final video prompt. Visible `performance_actions` remain.
7. If `人物空间站位` and `composition` are textually identical, the composition is not repeated in the camera line.
8. W005 remains a diagnostic warning; the expected fix is reduced context tax, not a higher warning threshold.

## Explicit non-scope

- Narration semantic sentence-boundary allocation remains a Storyboard concern. v2c does not silently move narration between Shots.
- Embedded/quoted dialogue mode requires an upstream dialogue semantic field; v2c does not infer quoted speech from wording.
- W003 duration estimation is not recalibrated in this closeout.


## Director v16.1 + Consumption v2d

- Director 先决定 shot purpose，再决定 framing / shot size / camera / movement；支持 over-shoulder、reaction、detail、environment 等明确镜头语法。
- Runtime 额外提供当前 Scene 的设计统计，抑制无叙事理由的中近景 + 平视 + 固定单一化。
- Consumption v2d 保留每镜独立生成所需的稳定人物身份、肤色、默认服装与场景空间骨架；当前站位、动作、表演只输出本镜增量，避免镜内复述。
- `shot_spatial_context` 独立保留当前子空间，最终 13 字段格式不增加字段。
