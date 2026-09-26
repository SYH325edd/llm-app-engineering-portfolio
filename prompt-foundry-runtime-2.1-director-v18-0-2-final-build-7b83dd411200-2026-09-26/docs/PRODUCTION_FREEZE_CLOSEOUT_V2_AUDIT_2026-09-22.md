# Production Freeze Closeout v2 — Plan vs Implementation Audit

Build: `08e87cc13d3f`

## Plan-to-code comparison

| Planned item | Actual implementation | Result |
|---|---|---|
| Asset Source-of-Truth Enforcement | Canonical character/scene records, asset hashes, Shot provenance verification | PASS |
| Scene Stable / Scene State separation | Stable space/material/layout vs time/transient lighting/spatial state | PASS |
| Continuity Anchor v2 | Readable compact anchor compiled from canonical registry; no bare-ID-only final prompts | PASS |
| W005 information budget | continuity / shot delta / dialogue / audio metrics and targeted warnings | PASS |
| Beat / Utterance integrity | FrozenText ref reconstruction + speaker integrity gate | PASS |
| Performance evidence completion | explicit Storyboard/spatial motion before generic fallback | PASS |
| Visual/Dialogue cross-field hygiene | normalized quoted-dialogue removal from visual performance | PASS |
| Director repetition gate | recent-shot + scene distribution hard validation, contract v16.2 | PASS |
| Cache dependency integrity | asset/anchor/state/target/framing/FrozenText/dialogue/narration in consumption input hash | PASS |
| Production Readiness final gate | source-of-truth, duration, text, performance, repetition and distribution checks | PASS |

## Production-code scope relative to bbc60bd5bd02

Changed production files:

1. `runtime/consumption_compiler.py`
2. `runtime/shot_manifest.py`
3. `runtime/production_readiness.py`
4. `runtime/stages/compile_eval.py`
5. `runtime/stages/director.py`
6. `runtime/orchestrator.py`

No production changes under `apps/`.

Frozen Core under `packages/prompt_foundry_v13/src` is byte-identical to the baseline.

The following generation stages remain byte-identical to the baseline:

- Story Bible
- Scene Plan
- Storyboard
- Production Semantics
- State/ShotSpec
- Storyboard overload feedback

No W003 formula change was made in this closeout.

## Regression evidence derived from the real “钥匙” output

Generic tests explicitly cover the observed production failure classes:

- `等身高` schema residue is canonicalized before both global asset and Shot anchor output.
- stable wardrobe does not duplicate an outer garment across default/outerwear sections.
- stable scene identity excludes transient “现在变成…” state.
- temporal lighting is selected by current Scene time and cannot contaminate another time period.
- `师傅，` + `那柜子呢？` reconstructs as one FrozenText utterance without rewriting source Script.
- explicit spatial motion (e.g. pushing a tricycle forward) cannot fall back to generic breathing.
- quoted exact dialogue inside performance text is removed from the visual track.
- stale asset hashes block Production Freeze.
- scene-level eye-level/static monoculture across several narrative purposes is a hard readiness error with a minimum recoverable Director-unit set.

## Historical “钥匙” evidence check

The uploaded `run_590f694663eb` Markdown was re-scanned as historical evidence. It contains 12 W005 warnings, 0 W003 warnings, 12 `等身高` residues, 5 generic performance fallbacks and 37 `平视机位，固定镜头` occurrences. These counts are not claimed as v2 output; they define the concrete regressions covered by the v2 generic tests.

## Validation

- Full regression: `526 / 526 PASS`
- Python compileall: PASS
- Web JavaScript syntax: PASS
- Final ZIP extraction regression: `526 / 526 PASS`

## Not claimed

No real Seedance 2.5 rendering was performed. No exact recompile of `run_590f694663eb` was claimed because only its rendered Markdown output is available in this working session, not the structured persisted run artifacts.
