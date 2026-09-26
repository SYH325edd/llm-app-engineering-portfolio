# Stage 05A Freeze Report

Status: **FROZEN-05A**

Frozen Stage: PVB Character Candidate
Upstream: Story Bible **FROZEN-01**
Baseline: Stage 04 **FROZEN-04** + Core v1.3 Frozen

## Audit Findings

1. Runtime still asked the model to generate `character_id/source/status/version` although all are mechanical metadata.
2. PVB status/source authority was therefore duplicated between model and Runtime.
3. Old Stage code and generic PVB structure validation existed beside the new per-character Runtime contract.
4. Unknown model fields were not isolated cleanly at the PVB Unit boundary.
5. Candidate/confirmed/locked lifecycle needed a stage boundary: Stage 05A should produce only candidate/skipped/optional_absent.
6. Story Bible authority and accessory optional semantics were already correct in Core and had to be preserved.
7. Frozen PVB template permits empty candidate values; Runtime must not invent a stricter non-empty rule.

## Changes in this freeze

- Added `runtime/stages/pvb.py` as the sole Stage 05A contract authority.
- Model output reduced to the ten canonical visual values only.
- Runtime exclusively constructs ID/source/status/version metadata.
- Story Bible-owned fields are always rebuilt as `skipped`.
- Empty non-owned `wardrobe.accessory` becomes `optional_absent`; this status is not expanded to any other field.
- All other non-owned canonical fields become `candidate + production_design`, preserving Frozen Core allowance for empty candidate values.
- Unknown/downstream fields are rejected at the PVB Unit boundary.
- Added a representation-only compatibility shim for old full-leaf model output; only `value` survives, all legacy metadata is discarded.
- Removed the obsolete orchestrator PVB canonicalizer / generic PVB unit validation path.
- Runtime production wiring now uses the Stage 05A contract directly.
- No changes to PSB, Style, Director, Frozen Core, or downstream automatic lock behavior.

## Verification

- Stage 05A contract tests: PASS
- Old-format provider metadata override regression: PASS
- Missing source/status production wiring regression: PASS with `repair_count=0`
- Story Bible authority suppression: PASS
- accessory optional_absent semantics: PASS
- Runtime unitization / checkpoint compatibility tests: PASS
- Full regression before freeze docs: **135 tests PASS**

## Explicit Non-Scope

This freeze does **not** decide whether Runtime should automatically confirm/lock all PVB candidates before compilation. That lifecycle step remains unchanged for now and must be audited in deterministic asset consumption / Stage 08.

## Next Stage

Stage 05B PSB remains `PENDING RE-AUDIT`.
No PSB/Style/Director/Frozen Core contract change is included in FROZEN-05A.
