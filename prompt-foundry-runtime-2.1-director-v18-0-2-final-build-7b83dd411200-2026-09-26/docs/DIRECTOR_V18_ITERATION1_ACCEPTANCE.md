# Director v18.0 Iteration 1 — Acceptance / Stress / Boundary Report

Date: 2026-09-25  
Current build after dialogue visual-channel closeout: `8e1bbfd7b445`
Original Iteration-1 acceptance build: `7e4190a7049e`

## Engineering regression

- Original Iteration-1 deterministic suite: **637/637 PASS**.
- Current dialogue-closeout build deterministic suite: **650/650 PASS**.
- Python compileall: **PASS**.
- `apps/web/app.js` Node syntax check: **PASS**.

## Design acceptance

1. **Fact Integrity** — Scene Director/Shot Director execution does not mutate Story Bible, Scene Plan, Script, Storyboard Base or Production Semantics: PASS.
2. **Fail-soft** — invalid Scene Context receives one repair; repair failure becomes `unavailable_after_repair`; Shot Director continues and Run completes: PASS.
3. **Context Consumption** — Shot Director receives Scene Context, previous design, next purpose and scene distribution; `scene_position` / `scene_context_usage` validate: PASS.
4. **Boundary authority** — Scene Context exact camera execution such as degree/distance trajectories is rejected; unknown refs and extra action fields are deterministically removed/rejected: PASS.
5. **Long Scene refs** — synthetic 120-shot Scene validates without ref drift: PASS.

## A/B surface isolation

Fresh original v17.9 ZIP and modified v18.0 project were run against the same deterministic one-shot mock source. Both completed. Final Seedance Prompt was byte-for-byte equivalent at the Unicode string level: **269 chars -> 269 chars (0% delta)**. No Scene Context/audit keys appeared in final prompt text.

This is the required proof that the new scene-level strategy does not leak into Consumption v2m.

## Stress / failure isolation

- Synthetic 400-shot/400-beat Scene Context: 5000 canonicalize+validate iterations PASS; observed ~842.9 iterations/s and ~0.13 MB tracemalloc peak in the stress process.
- 200 unique optional Scene Units forced to fail semantic validation: 400 model attempts total (generate + one repair each), 200/200 ended `unavailable_after_repair`; run error remained empty, failure history remained empty, failed optional checkpoints remained zero.
- Provider failure boundary: simulated Scene Context provider timeout -> `unavailable_provider_error`; Shot Director still executed, Run completed, `run.error` and `failure_history` stayed empty.

## Scope audit

No v18.1 Creative Continuity, v18.2 Camera Grammar, Compiler v2n Prompt Surface Composer, dual-output renderer or Scene Asset Composer was implemented in this delivery. That is intentional: these are later iterations in the approved roadmap.

The exact 《钥匙》 SC002 real-project A/B could not be executed because the supplied ZIP contains no frozen 《钥匙》 run/fixture. No substitute result is fabricated. The deterministic same-chain A/B above validates surface non-leakage; a real 《钥匙》 SC002 creative-quality A/B still requires its actual frozen upstream artifacts.


## Compile-static hotfix revalidation

The 2026-09-26 hotfix does not alter Scene Director/Shot Director contracts. It repairs deterministic consumption/readiness behavior exposed by production compile failures.

- Reported error-cluster regression: SH007/SH010/SH016/SH026/SH027/SH029/SH036/SH037 -> zero `E023_SHOT_NOT_SELF_CONTAINED`; SH016 -> zero `exact_dialogue_repeated_in_visual_content`.
- Canonical identity matrix: 7,200 compile/readiness iterations across face/hair/age/body/skin/outerwear-only assets and wide/medium/close/detail focus variants -> 0 failures.
- Inverse E023 boundary: a visible character with no canonical visual asset still fails. No fallback to character name, Shot prose or invented identity was introduced.
- Dialogue boundary stress: 90,000 sanitizer/readiness checks covering short utterances (`好/对/行/嗯`) and long utterances -> all expected safe/unsafe classifications pass.
- The earlier blanket non-empty-field approach remains rejected. The corrected contract is `pvb_character.v3_1`: individual optional/skipped fields may remain empty, but Story-owned + production-design values must jointly provide at least one consumable canonical identity cue. Compile preflight attributes any stale legacy no-anchor asset to `pvb:<char_id>` for targeted recovery.

## Dialogue visual-channel closeout revalidation

- Remaining SH016 `exact_dialogue_repeated_in_visual_content` was reproduced through the only unsanitized performance fallback: Storyboard explicit action.
- Director action, Production Semantics visual event, v18 performance logic/execution, and Storyboard explicit-action fallback now share the same FrozenText dialogue-channel invariant: visual surface excludes the exact utterance; dialogue track retains it.
- 4,000 Storyboard-fallback stress cases covering quoted/unquoted long and short dialogue pass. The short line `好` does not damage unrelated `良好`.
- The hard Production Readiness gate remains enabled; no SH016 or story-specific exception exists.

## v18.0_1 Consumption Correction supersession

The current Director contracts are `director_scene_context.v1_1` and `director_shot.v18_0_1`, Build `af52d4abaa61`. The v18.0_1 correction replaces the original coarse Beat≈Phase consumption behavior while preserving the frozen Fact/State/Compiler boundaries. Current validation is recorded in `DIRECTOR_V18_0_1_CONSUMPTION_CORRECTION_ACCEPTANCE_2026-09-26.md`. Historical v18.0 numbers above remain historical and are not rewritten.
