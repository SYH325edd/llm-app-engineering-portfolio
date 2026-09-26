# Director v16.1 + Consumption v2d — Plan vs Implementation Audit

Build: `a7410ddc8b5b`

## Target

The production target is not random camera variety or minimum prompt length. It is: clear per-shot visual intent, stable character identity, stable scene continuity, readable spatial relations, and purposeful variation comparable to a manually directed shot list.

## Plan → implementation

| Planned change | Implemented | Evidence |
|---|---|---|
| Separate voice source from visual subject | Yes | `visual_target` remains independent from `speaker_target_refs` |
| Give each shot a narrative function | Yes | `shot_purpose` with establish / relationship / speaker / reaction / detail / action / reveal / transition / emotional_peak / closing / continuity |
| Add relationship framing | Yes | `execution_framing`: single / two_shot / over_shoulder / reaction / detail / environment |
| Increase meaningful scale variation | Yes | establish requires wide/extreme-wide; detail and emotional peak require close/extreme-close; reaction requires readable close scale |
| Avoid medium-close / eye-level / static monoculture without randomization | Yes | last-two design context + `scene_design_summary` counts for shot size / camera / movement / framing / purpose |
| Keep independent-shot character consistency | Yes | v2d repeats stable age/face/hair/body/skin/default wardrobe for visible characters |
| Keep independent-shot scene consistency | Yes | v2d repeats stable space + core layout + material + color anchor per Scene |
| Preserve shot-specific differences | Yes | spatial blocking, performance actions, framing, camera and `shot_spatial_context` remain per-shot |
| Preserve final 13-field prompt format | Yes | no new final field; spatial context is compiled into scene text and retained internally in manifest |
| Remove only meaningless repetition | Yes | stable continuity anchors repeat; duplicate composition/action text inside the same shot is not repeated |

## Scope audit

Production files intentionally changed:

- `runtime/stages/director.py`
- `runtime/orchestrator.py`
- `runtime/shot_manifest.py`
- `runtime/consumption_compiler.py`
- `runtime/stages/compile_eval.py`

Frozen production files verified byte-identical to Build `ef26883d73e0` baseline:

- `runtime/stages/storyboard.py`
- `runtime/stages/script.py`
- `runtime/stages/production_semantics.py`
- `runtime/stages/state_shotspec.py`
- `runtime/consumption_lint.py`
- all Python files under frozen `packages/prompt_foundry_v13/src`

## Explicit non-goals

- no Story Bible / Scene Plan / Script redesign
- no W003 recalibration
- no new automatic storyboard redistribution behavior
- no random camera selector or quota-based shot distribution
- no weakening of FrozenText / evidence / continuity validation
- no real Seedance acceptance claim without real render quota
