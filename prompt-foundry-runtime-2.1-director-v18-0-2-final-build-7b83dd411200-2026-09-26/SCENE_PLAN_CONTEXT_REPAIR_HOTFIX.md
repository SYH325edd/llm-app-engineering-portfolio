# Scene Plan Context Repair Hotfix

Build: `f3ec169b5185`
Date: 2026-09-22
Contract remains: `scene_plan.v8`

## Fixed failure

`context_switch_same_context` / `context_enter_same_context` previously emitted no field path. The generic repair policy therefore degraded the repair target to `$`, so a temperature-0 repair could return the same normalized Scene Plan and trigger `repair_no_effect`.

## Change

- Keep `context_ref`, Scene/Beat boundaries, source refs, and story facts model-owned and unchanged.
- Same-context `switch` now exposes exact target `scenes[i].context_transition`, repair action `change_same_context_switch_to_continue`, and allowed value `["continue"]`.
- Same-context `enter` uses the equivalent exact repair contract.
- Scene Planner repair instructions explicitly require this minimal transition-label correction and forbid inventing a new context.
- No contract version bump: JSON shape and ownership are unchanged; this is validator/repair metadata hardening only.

## Verification

- Full regression: 528 / 528 PASS.
- New regression coverage verifies exact repair targets for same-context `switch` and `enter`.
