# Director Camera Authority Structural Closeout v17.6

Contracts: `director_shot.v17_6` · `consumption_v2i` · `production_readiness.v4_6`.

## Root cause

Recent v17.x patches repeatedly expanded Camera Grammar because `camera_execution.framing_note` was both free natural language and a hard story-authority surface. That combination is unstable: phrases such as `抽屉与手部动作`, `行人`, `环境主体`, `空间感`, or `视觉引导` are legitimate camera prose but are not stable Story Bible entities. Parsing them back into hard entities created recurring false positives.

## New authority boundary

Hard camera facts are structured only:

- `visual_target`
- `visual_focus`
- `execution_framing.framing_type`
- `execution_framing.foreground_character_refs`
- `camera_execution.shot_size`
- `camera_execution.camera`
- `camera_execution.movement`

`framing_note` is non-authoritative prose. It may help rendering only when its content can be safely accepted.

## Hard vs soft

Hard E027 remains for deterministic ownership leakage:

- dialogue in camera prose;
- visible performance action in camera prose;
- psychology/emotion explanation in camera prose;
- scene lighting/time-light prose in camera prose.

Free-text entity/fact authority that cannot be proven is not a Repair target. It becomes `W021_CAMERA_NOTE_AUTHORITY_UNRESOLVED`; Compiler removes the note from final `摄法`, while structured camera fields still render.

## Performance execution alignment

The same principle now applies to `movement / action_transition / end_state` natural acting language. `outside_performance_modulation_grammar` is soft (`W022`) unless an objective story action/fact is actually introduced. E028 remains hard for objective action, injury, weapon, external trigger, or other unsupported story-state changes.

## Why this is safer

This design no longer tries to prove every noun phrase inside open Chinese camera prose. It also does not allow an invented note to reach Seedance: unresolved note authority is filtered at compile time. Structured refs remain the hard source of truth.
