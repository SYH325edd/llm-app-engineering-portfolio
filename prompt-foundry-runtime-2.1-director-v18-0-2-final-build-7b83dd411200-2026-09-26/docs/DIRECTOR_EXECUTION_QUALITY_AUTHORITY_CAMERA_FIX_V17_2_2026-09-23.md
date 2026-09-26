# Director Execution Quality Authority + Camera Fix v17.2

Build: `8ee26d3dec53`

Contracts:
- Director `director_shot.v17_2`
- Compiler `consumption_v2h`
- Production Readiness `production_readiness.v4_2`

## Scope

No new Stage and no new model call. Upstream Story Bible / Scene Plan / Script / Storyboard / Production Semantics contracts are unchanged. Director and deterministic downstream outputs regenerate because acceptance semantics changed.

## 1. Field-level performance authority

A real evidence quote no longer authorizes an entire free-form `performance_logic` item. Final rendering and baseline carry use only individually authorized fields:

- `base_emotion` / `emotion_delta`: current authority must explicitly support the affect concept.
- `trigger`: must be a direct current-authority event phrase.
- `behavior_goal`: must be directly stated in current authority.
- `behavior_tendency`: performance-only modulation such as gaze/body/breath/action rhythm; plot actions such as killing, stealing, fleeing, attacking, calling police, contacting others, forcing an apology, etc. are not renderable unless represented as objective upstream events rather than free Director logic.

Unsupported fields stay available for debug/audit but do not seed `performance_baseline` and do not render into Seedance Prompt.

## 2. Camera Grammar

E027 no longer uses single-character action blacklist rules. `framing_note` is accepted only when each clause carries a composition/spatial signal such as subject placement, foreground/background relation, negative space, depth, occlusion, OTS relation or environment ratio. High-confidence dialogue, performance, psychology and lighting semantics remain forbidden.

Examples accepted:
- `人物偏左，走廊尽头保留负空间`
- `双人中景，背景连接门口与窗户形成纵深`

Example rejected:
- `人物皱眉，身体前倾，手指收紧`

## 3. Character gaze

If the Shot has no visible character, final output is exactly `人物视线：无`. Legacy fixtures without explicit visibility metadata retain compatibility fallback.

## Acceptance

- Full regression: `576 / 576 PASS`
- Targeted Director v17.2 regression: `22 / 22 PASS`
- Persisted-pause app-restart recovery: `5 / 5 PASS`
- Neutral-evidence attack test confirms invented current event / goal / plot tendency / unsupported emotion do not reach baseline or final Prompt.

Real Ark and Seedance generation remain the final production acceptance layer.
