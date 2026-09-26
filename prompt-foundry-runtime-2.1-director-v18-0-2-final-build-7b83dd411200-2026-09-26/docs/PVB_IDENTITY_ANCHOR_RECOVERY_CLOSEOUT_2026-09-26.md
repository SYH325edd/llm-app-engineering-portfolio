# PVB Identity Anchor Recovery Closeout — 2026-09-26

Build: `e7f8dba910bf`  
Runtime: `2.1`  
PVB: `pvb_character.v3_1`  
Compiler: `consumption_v2m`  
Production Readiness: `production_readiness.v4_11`

## Trigger

A production Run continued to fail the same E023 cluster after the first continuity-anchor hotfix:
`SH007 / SH010 / SH016 / SH026 / SH027 / SH029 / SH036 / SH037`.
The dialogue-duplication error disappeared, proving that the dialogue fix was effective while the identity-asset root cause remained unresolved.

## Root cause

The former `pvb_character.v3` schema required every visual key to exist but allowed every model-owned value to be an empty string. Such an all-empty candidate could validate, become locked production data, and survive until final Compile. When Story Bible also had no consumable visual lock for the visible character, Consumption had no canonical identity to render and E023 correctly stopped the final surface.

A second bug made recovery ineffective: E023 carried only a `shot_id`, so Compile recovery attributed the failure to `director:SHxxx`. Re-running Director cannot create missing canonical character assets, causing a deterministic recovery loop.

## Engineering fix

1. `pvb_character.v3_1` adds one aggregate invariant only: Story-owned visual values plus PVB production-design values must jointly expose at least one consumable canonical identity cue.
2. Individual fields remain optional where previously legal. `skipped` and `optional_absent` semantics are unchanged. There is no blanket “all fields non-empty” rule.
3. Final Compile now runs a visible-character asset preflight using the exact same visibility-aware identity compaction path used by shot rendering.
4. Missing identity errors carry `target_character_refs` and `source_layer=PVB Canonical Asset Registry`.
5. Compile recovery routes these failures to `pvb:<char_id>` and marks them recoverable; it no longer defaults to Director for an asset-owned failure.
6. E023 remains as a final defensive Hard Gate. It was not downgraded or bypassed.

## Recovery acceptance

A complete Runtime Run was first allowed to finish normally. Its locked `char_001` PVB was then mutated to simulate a stale legacy all-empty asset. Re-entering Compile produced `compile_asset_preflight_failure` with `source_unit_ids=['pvb:char_001']`. Resume regenerated only `pvb:char_001`, did not rerun `director:SH001`, and the Run returned to completed with Production Readiness passing.

## Regression boundary

- Full deterministic suite: `649/649 PASS`.
- Valid identity preflight matrix: `7,200/7,200 PASS` across single canonical fields and wide/medium/close + detail hands/face/feet variants.
- Stale all-empty long-scene preflight: `1,000/1,000` shots blocked and attributed to `char_001`.
- Aggregate validator stress: `10,000` validations PASS; one usable cue remains legal while the all-empty aggregate is rejected.
- New-Run local Repair test: first all-empty PVB is repaired inside the owning PVB Unit in one semantic Repair and never reaches E023.
- Existing optional/skipped PVB tests remain green.
- A Story-owned valid visual cue is sufficient even if other PVB leaves are empty.
- One generated canonical cue is sufficient; all other optional values are not forced.
- Latin-only/non-consumable Story value with all PVB values empty is rejected as `pvb_missing_identity_anchor`.
- A truly visible character with no canonical identity still cannot compile; the system now catches it at the owning asset boundary and E023 remains the final backstop.
