# Director Execution Authority Closeout v17.3

Build: `6e731a998367`

Contracts: `director_shot.v17_3` · `consumption_v2i` · `production_readiness.v4_3`.

## Scope

No new Stage and no new model call. Upstream Story Bible / Scene Plan / Script / Storyboard / Production Assets / Production Semantics contracts remain unchanged. Director and downstream deterministic outputs regenerate because execution authority is stricter.

## Authority boundary

- `performance_logic`: field-level authority from v17.2 remains.
- `performance_execution`: acting modulation is allowed; objective action/state mutation requires current Shot authority. E028 blocks ungrounded weapons, injuries, new people/events, escape/attack, object changes and end-state changes.
- `dialogue_delivery`: controlled grammar only. FrozenText supplies dialogue text; Director may only specify bounded emotion/volume/pace/pause/vocal delivery/current legal gaze. E029 blocks story events hidden in delivery metadata.
- `camera_execution.framing_note`: positive Camera Grammar plus authority-bound concrete entities/states. Generic composition is free; concrete props/characters/locations must be current authority.
- Compiler repeats these checks defensively and does not render invalid optional Director prose.

## Acceptance

- 585 / 585 deterministic regression tests PASS.
- persisted-pause app-restart recovery 5 / 5 PASS.
- compileall PASS.
- Final product freeze still requires real Ark + Seedance A/B.
