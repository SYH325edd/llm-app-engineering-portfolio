# Stage 03 Freeze Report

Status: **FROZEN-03**

Frozen Stage: Script
Upstream: Story Bible **FROZEN-01**, Scene Plan **FROZEN-02**
Baseline: Prompt Foundry Runtime 2.0.2 architecture + Core v1.3 Frozen

## Audit Findings

1. Script IDs/refs were still copied by the model even though they are fully determined by Scene Plan.
2. Runtime Prompt required `character_name/source_evidence`, diverging from the Frozen Script template.
3. Dialogue speakers were validated against global Story Bible only, not current Scene character refs.
4. Verbatim dialogue validation did not enforce source order.
5. Beat count/alignment, required scalars and unknown-field authority were not fully frozen at the Script Unit boundary.
6. Old Runtime tests were coupled to the removed `_script_scene_errors` helper instead of the Stage contract.

## Changes in this freeze

- Added `runtime/stages/script.py` as the sole Stage 03 contract authority.
- Model no longer owns `scene_id/location_ref/context_ref/beat_id`; Runtime injects them from FROZEN-02.
- Canonical dialogue shape is exactly `character_id + line`; removed Runtime-only `character_name/source_evidence` requirements.
- Script Unit payload retains read-only `required_scene_id/location/context/beat_ids` constraints for provider guidance.
- Enforced one Script Beat per Scene Plan Beat by array order.
- Enforced current-Scene speaker membership and `background` no-dialogue rule.
- Enforced verbatim source dialogue and source-order consumption.
- Rejected unknown Scene/Beat/dialogue fields so downstream Storyboard cannot receive authority leakage.
- Removed obsolete `_script_scene_errors` production helper and old Script prompt constant.
- Migrated the old boundary regression test to the FROZEN-03 validator rather than restoring duplicate logic.

## Explicit Non-Claim

FROZEN-03 does **not** claim programmatic proof that every source dialogue line was included. Without an upstream source-span/dialogue inventory, omission detection cannot be made reliable without changing the architecture. The Prompt still forbids omissions; emitted lines are strictly verified for verbatimness and order.

## Verification

- Stage 03 contract tests: PASS
- Production wiring with deliberately bad model-owned Scene/Beat refs: PASS with `repair_count=0`
- Full regression: **118 tests PASS**
- Frozen Core SHA regression: PASS
- Python compile: PASS
- JavaScript syntax: PASS

## Next Stage

Stage 04 Storyboard Base remains `PENDING AUDIT`.
No Storyboard, PVB/PSB, Director or Frozen Core contract changes are included in this checkpoint.
