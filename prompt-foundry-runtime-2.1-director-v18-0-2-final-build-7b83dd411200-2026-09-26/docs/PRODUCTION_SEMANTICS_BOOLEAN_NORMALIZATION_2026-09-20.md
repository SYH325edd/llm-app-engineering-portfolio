# Production Semantics Boolean Representation Normalization — 2026-09-20

## Failure reproduced

Real Ark output can preserve the intended boolean meaning while drifting at the JSON representation layer, for example:

- `"offscreen": "false"`
- `"offscreen": 0`
- `"required_visible": "true"`

The previous canonicalizer converted invalid `dialogue.offscreen` representations to `null`, which guaranteed a hard validation failure and could consume a repair without adding semantic value.

## Contract decision

Semantic booleans remain hard contracts. The runtime only normalizes **unambiguous representation drift**:

- `true`, `"true"`, `1`, `"1"` -> `true`
- `false`, `"false"`, `0`, `"0"` -> `false`

Ambiguous or missing values such as `null`, `"可能"`, arbitrary text, arrays or objects are **not guessed** and still fail validation.

The same representation rule is applied before hard validation to:

- Story Bible `props[].visual_asset_required`
- Scene Plan `scenes[].continuous_with_previous`
- Storyboard `shots[].continuity.continuous_with_previous`
- Production Semantics `dialogue[].offscreen`
- Production Semantics `diegetic_text[].required_visible`

This is representation normalization only. It does not change narrative semantics or relax downstream validators.

## Regression coverage

The runtime regression intentionally returns `"offscreen": "false"` from the Production Semantics model and verifies that the run reaches `completed` without consuming a repair. Separate tests verify ambiguous values remain invalid.
