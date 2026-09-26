# Director Execution Quality Acceptance Fix v17.1

This closeout keeps the Runtime 2.1 stage topology and Director v17 JSON family unchanged while tightening the acceptance semantics found during independent production review.

## Fixed acceptance gaps

1. High-density visible-character Shots (`action` / `emotional_peak` / `reveal` or equivalent high density) may not pass final readiness with zero `performance_execution` signals merely because legacy `performance_actions` are present. Final readiness raises `E025_PERFORMANCE_NOT_EXECUTABLE`; density remains observable through `W014`.
2. A real evidence quote is necessary but no longer sufficient to render/carry arbitrary performance logic. New biography, relationship history, secrets, betrayal/incarceration/marriage history, revenge/punishment claims are filtered unless the current authority explicitly contains the corresponding fact. Unsafe logic stays debug-only, cannot seed `performance_baseline`, and cannot enter the final Prompt.
3. Low-density Shots no longer receive the mechanical continuity filler “natural breathing / blinking / slight weight shift”. If no performance is required, the renderer emits no extra performance prose.
4. `performance_execution.gaze` is the overall gaze path; `dialogue_delivery.gaze_during_line` is rendered with explicit “during dialogue” scope rather than concatenated as a competing global gaze.
5. All non-empty dialogue delivery cues are retained; FrozenText dialogue remains the only text authority.
6. W005 prompt complexity now includes Director v17 density and execution-signal load so high-conflict Shots are not classified as `simple` only because legacy action count is low.

## Contract/checkpoint identity

The semantic contract is `director_shot.v17_2`. The JSON family remains compatible with v17, but the contract identity changes intentionally so completed v17 Director checkpoints cannot bypass the stricter v17.1 validator/readiness behavior. Upstream unchanged contracts remain reusable; Director and downstream deterministic outputs regenerate under the new contract. Production Readiness is `production_readiness.v4_2`.

## Verification

- 570/570 local regression tests
- persisted-pause/app-restart recovery repeated 5/5
- compileall + Runtime `/api/health` smoke required on the packaged artifact
- real Ark + Seedance A/B remains the product-level freeze criterion
