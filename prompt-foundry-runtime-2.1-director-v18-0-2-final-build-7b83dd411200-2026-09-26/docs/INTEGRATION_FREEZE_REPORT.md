# Prompt Foundry Runtime 2.1 — Integration Freeze Report

Target: App `2.1.0` / Runtime `2.1` / Core `1.3-frozen`.

## Frozen execution order

```text
FROZEN-01 Story Bible
→ FROZEN-02 Scene Plan
→ FROZEN-03 Script
→ FROZEN-04 Storyboard Base
→ FROZEN-05A PVB candidate
→ FROZEN-05B PSB candidate
→ FROZEN-05C Style candidate
→ FROZEN-06 Director per Shot
→ FROZEN-07 State + ShotSpec
→ FROZEN-08 Production Lock + Compilers + Static Evaluation
```

Stage 08 does not run early. Final Character / Scene / Shot prompts appear only after Director and State/ShotSpec succeed.

## Cross-stage invariants

- Downstream consumes canonical checkpoints only.
- Raw model output never crosses Stage boundaries.
- Models do not own stable IDs or deterministic state mechanics.
- Program normalization is mechanical and cannot silently repair semantic Director decisions.
- Candidate production design remains separate from production-locked copies.
- Failed semantic work is repaired at the smallest Unit.
- Frozen Core stays byte-stable under SHA regression.
- Final production output contains only Character / Scene / Shot prompt classes.

## Verification evidence

- Automated regression: **160 / 160 PASS**.
- Frozen Core SHA regression: **PASS**.
- Python compile: **PASS**.
- Web JavaScript syntax: **PASS**.
- Runtime production-path legacy scan: **PASS**.
- Local Uvicorn/FastAPI smoke: `/`, `/api/health`, `/api/config` all `200`.
- Health identity: `2.1.0 / 2.1 / 1.3-frozen`.

## External boundary

Live Volcengine Ark with a private user credential and Seedance real-video quality are outside this local freeze evidence.
