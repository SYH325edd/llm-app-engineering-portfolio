# Director Validation Global Closeout v17.4

Contracts: `director_shot.v17_4` · `consumption_v2i` · `production_readiness.v4_4`.

## Root cause

The v17.3 series correctly introduced Director execution authority, but two validation design choices caused repeated false pauses:

1. open-ended natural camera language was treated as an exhaustively enumerable hard grammar;
2. deterministic stabilizers ran only when *every* current error was already classified as stabilizable.

This caused valid phrases to be rejected one by one and allowed an unrelated framing error to prevent automatic repair of a deterministic shot-size/focus contradiction.

## v17.4 policy

### Hard
- schema/type/stable-ref violations;
- exact evidence and state/continuity violations;
- Production Semantics / execution authority violations;
- camera field contains dialogue, acting, psychology or lighting;
- camera framing names unauthorized people, props, places, injuries or events;
- structured purpose/target/focus/framing contradictions.

### Deterministic self-heal
- precision body focus incompatible with a required wide establishing shot;
- valid prop accidentally placed in character-only primary subject refs;
- evidence-deterministic performance owner correction;
- reaction bundle cases with same-character evidence or no supported target;
- readable reaction shot scale.

The stabilizer runs before model Repair even when unrelated errors coexist.

### Soft quality
- unknown-but-nonleaking camera wording (`W016`);
- three-shot camera repetition (`W017`);
- scene-level camera grammar monoculture (`W018`);
- scene-level camera/movement concentration (`W019`);
- existing v17 performance quality warnings.

## Principle

A hard pause must be justified by an objective contract invariant. A heuristic inability to recognize natural directing language is not evidence of invalid output.
