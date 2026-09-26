# Director Non-Authoritative Camera Note Closeout v17.7

Contracts: `director_shot.v17_7` · `consumption_v2i` · `production_readiness.v4_7`.

## Root cause

`framing_note` was declared non-authoritative but still participated in a lexical E027 Hard Gate. This made open-ended Chinese camera prose capable of consuming the only semantic Repair budget.

## v17.7 rule

1. Structured camera fields own hard facts and refs.
2. `framing_note` never blocks Director completion.
3. Deterministic dialogue/performance/psychology/lighting leakage becomes `W023_CAMERA_NOTE_DROPPED_UNSAFE`; compiler drops the whole note.
4. Unresolved free-text entity/fact authority remains `W021_CAMERA_NOTE_AUTHORITY_UNRESOLVED`; compiler drops the note.
5. Final Production Readiness keeps E027 only as a defense against corrupted/legacy manifests that bypass normal filtering.

This closes the repeated false-positive loop without weakening final prompt safety.
