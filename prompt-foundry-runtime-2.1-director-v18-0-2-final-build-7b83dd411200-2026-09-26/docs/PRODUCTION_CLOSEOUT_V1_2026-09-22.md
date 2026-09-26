# Production Closeout v1 — 2026-09-22

## Status

- Runtime: 2.1
- Core: 1.3 frozen
- Build: `bbc60bd5bd02`
- Director: `director_shot.v16_1`
- Compiler: `consumption_v2e`
- Continuity anchor: `continuity_anchor_v1`
- Production Readiness: `production_readiness.v1`

This closeout is a production-freeze candidate at the local engineering level. It does not claim real Seedance 2.5 calibration because no new Seedance render acceptance was run in this closeout.

## A. Duration Authority Integration

Duration risk is resolved before final compilation instead of being left as a W003 warning.

1. Storyboard Base is evaluated with the existing conservative W003 estimator before Production Semantics / Director.
2. Multi-unit overloaded dialogue/narration returns to the existing Storyboard redistribution fragment stage.
3. A single atomic FrozenText unit may be extended deterministically up to the current 15s shot contract.
4. After redistribution, the board is re-evaluated. Residual warning / overloaded / unknown duration risk blocks production.
5. After Director / ShotSpec, any extra visible-action cost may only extend the existing shot up to 15s. Compiler does not split shots or invent duration.
6. Resume after an automatically applied redistribution reuses the already-applied allocation and does not spend another Storyboard or redistribution model call.

Authority note: the current duration basis remains `w003_conservative_unvalidated_real_seedance`; it is a deterministic production gate, not a claim of measured Seedance timing truth.

## B. Continuity Packaging v1

Final Seedance prompts continue to carry enough character and scene continuity information for independent shot generation, but they no longer expand whole PVB / PSB payloads indiscriminately.

Character continuity keeps compact stable identity information: age appearance, core face/hair cues, body/skin cues and default wardrobe. Current emotion/action is not stored in the stable anchor.

Scene continuity keeps a canonical stable spatial anchor: space, essential layout, material, lighting and color. Current character position/action and transient shot state stay in the shot delta.

Each compiled shot records:

- `continuity_anchor_version`
- `character_anchor_hash`
- `scene_anchor_hash`
- `consumption_input_hash`

Changing a resolved character/wardrobe/scene anchor changes the deterministic consumption input hash.

## C. Asset & Text Hygiene

The implementation is generic and field-based; it does not contain story-specific replacement rules.

- normalizes common garment terms before joining fields
- deduplicates stable scene clauses across layout/material/etc.
- removes representation-only orphan enum prefixes such as a leading `等` before body adjectives
- normalizes repeated punctuation / whitespace
- strips exact spoken dialogue from visual performance text so dialogue remains in the dialogue track
- prevents story-specific names in Runtime production code

## D. Performance Coverage

Shot manifests record `performance_source`:

- `director`
- `production_semantics`
- `continuity_fallback`

Visible Director performance is preferred; Production Semantics is the deterministic fallback. Generic breathing/blinking fallback is allowed only when no explicit visible action exists.

Production Readiness blocks `speaker`, `reaction`, `emotional_peak`, `reveal`, or `action` shots that still rely only on generic continuity fallback.

## E. Production Readiness Gate

Compilation success is no longer equivalent to production readiness. The final deterministic gate checks:

- exact 13-field final prompt structure
- character continuity anchor presence when characters are visible
- scene continuity anchor presence and same-scene stability
- duplicate visual clauses / repeated tokens / malformed punctuation
- orphan representation residue and suspicious truncation
- exact dialogue leaking back into visual content
- critical-shot performance fallback
- unresolved final duration risk
- three-shot camera-language monotony (warning only; no automatic camera mutation)

`production_readiness` is materialized in artifacts and validations. Any upstream retry invalidates it together with compile outputs. Duration authority state is also invalidated when relevant upstream semantic stages change.

## Final format boundary

The user-facing Seedance prompt remains exactly 13 fields:

1. 镜号
2. 时长
3. 场景
4. 人物空间站位
5. 景别
6. 摄法
7. 画面内容
8. 旁白
9. 台词
10. 动作音效
11. 环境音效
12. 氛围音效
13. 配乐

Internal continuity hashes, refs, readiness metadata and authority reports do not leak into the final prompt.
