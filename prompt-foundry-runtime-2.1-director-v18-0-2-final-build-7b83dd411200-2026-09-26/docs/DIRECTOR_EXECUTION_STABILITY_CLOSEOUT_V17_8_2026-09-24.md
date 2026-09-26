# Director Execution Stability Closeout v17.8

Contracts: `director_shot.v17_8` · `consumption_v2j` · `production_readiness.v4_8`.

## Root cause

The SH008 failure exposed a system boundary problem, not a story-specific bad phrase.

1. `performance_execution` is a typed acting-modulation layer, but the objective-action detector treated ambiguous Chinese verbs such as `抬起/放下` as plot mutations even when attached to `嘴角/眼睛/下颌/手`.
2. Optional non-authoritative prose (`performance_execution` / `dialogue_delivery`) could still raise hard Director errors and consume the only semantic Repair. With deterministic temperature, the repair could normalize to the same output, producing `repair_no_effect`.
3. Director admitted execution language using Production Semantics + Base Shot authority, while Compiler revalidated with a narrower authority set. Legal Director content could therefore be dropped or rejected downstream.

## v17.8 authority model

- `performance_actions`: authoritative objective action; exact evidence/ref/state rules remain hard.
- `performance_logic`: interpretation layer; unsupported inference stays non-renderable/diagnostic.
- `performance_execution`: optional non-authoritative acting execution.
- `dialogue_delivery`: optional non-authoritative delivery metadata; FrozenText owns dialogue.
- `camera_execution.framing_note`: optional non-authoritative camera note.

Unsupported content in the three optional prose surfaces is warning + compiler filter, not model Repair. This matches the existing v17.7 camera-note boundary.

## False-positive fix

`抬起/放下` is exempt from objective-action classification only when the verb is locally attached to a body/performance part owned by the typed field. The exemption is proximity-scoped, so `嘴角微微抬起` passes while `肩膀放松后放下箱子` is still detected as an unauthorized object action. Weapon, injury, external-event, entry/exit and state-changing actions retain hard detection in the low-level authority classifier.

## Cross-stage parity

Compiler execution authority now mirrors Director: current evidence/Script context + Production Semantics `action/choice/description` + Base Shot `description/spatial_blocking/composition`. This removes pass-then-drop behavior caused solely by stage disagreement.

## Defense in depth

Compiler filters unsafe optional fields before rendering. Production Readiness v4.8 raises E028/E029 only when rejected optional text actually survives into the rendered manifest, which indicates a corrupted/legacy bypass. A rejected field that was successfully omitted is reported as W024/W025 rather than blocking production.

## Regression

- 616/616 tests pass.
- Python compileall passes.
- Added coverage for local-articulation false positives, true objective-action detection, unsafe execution soft-drop, unsafe dialogue-delivery soft-drop, Director/Compiler authority parity, final leakage defense, and v17.7 checkpoint invalidation.
