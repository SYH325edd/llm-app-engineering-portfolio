# Stage 05B Freeze Report

Status: **FROZEN-05B**

Frozen Stage: PSB Scene Candidate
Upstream: Story Bible **FROZEN-01**
Baseline: PVB **FROZEN-05A** + Core v1.3 Frozen

## Audit Findings

1. Runtime asked the PSB model to generate scene_id/source/status/version although these are mechanical metadata.
2. Story Bible authority was therefore duplicated between model output and Runtime canonicalization.
3. Old generic PSB structure validation and local prompt code formed a parallel path instead of a single Stage-owned contract.
4. Top-level/leaf unknown fields were not isolated at the Unit boundary.
5. Stage 05B needed an explicit distinction from PVB: there is no optional_absent, and non-Story-owned candidate values must be nonempty.
6. Frozen Scene Compiler already correctly suppresses PSB when Story Bible owns the same visual field and must remain untouched.

## Changes in this freeze

- Added `runtime/stages/psb.py` as the sole Stage 05B contract authority.
- Model output reduced to six canonical scene visual values only.
- Runtime exclusively constructs scene_id/source/status/version metadata.
- Story Bible-owned fields are rebuilt as `skipped`.
- Every non-owned field requires a nonempty string and becomes `candidate + production_design`.
- `optional_absent`, confirmed, and locked are excluded from the Stage 05B candidate checkpoint.
- Unknown/downstream fields are rejected.
- Added representation-only compatibility for old full-leaf PSB output; only value survives.
- Removed the old local PSB prompt/payload and old orchestrator canonicalizer/generic Unit validation path.
- Production Runtime now uses Stage 05B directly.
- No PVB/Style/Director/Frozen Core or Scene Compiler behavior changed.

## Verification

- Stage 05B contract tests: PASS
- values-only PSB production wiring: PASS with `repair_count=0`
- old full-leaf provider compatibility: PASS
- Story Bible lighting authority suppression: PASS
- PSB metadata ownership regression: PASS
- Runtime unitization regression: PASS
- Full regression before freeze docs: **141 tests PASS**

## Explicit Non-Scope

The later candidate→locked lifecycle remains unchanged and is not audited in Stage 05B. It will be reviewed with deterministic asset consumption / Stage 08.

## Next Stage

Stage 05C Style Guide remains `PENDING AUDIT`.
No Style/Director/Frozen Core contract change is included in FROZEN-05B.
