# Director Natural Language Gate Closeout v17.5

Contracts: `director_shot.v17_5` · `consumption_v2i` · `production_readiness.v4_5`.

## Purpose

Unify Director natural-language validation across camera and dialogue delivery. Open-ended director phrasing is not treated as a finite lexical Hard grammar.

## Rule

- Explicit story/event/entity leakage stays Hard.
- Unauthorized gaze targets stay Hard.
- Natural emotion/volume/pace/pause/delivery wording that is outside the current positive grammar but contains no story/authority leak becomes `W020_DIALOGUE_DELIVERY_GRAMMAR_UNRECOGNIZED`.
- Safe unknown delivery wording is preserved by the Compiler.
- Final Production Readiness repeats only the hard authority check and does not re-harden W020.

## Checkpoint identity

Validation semantics changed, so Director contract identity advances from `director_shot.v17_4` to `director_shot.v17_5`. Upstream contracts are unchanged.

## Verification

- Full regression: `600/600 PASS`.
- App-instance persisted-pause recovery: `5/5 PASS`.
