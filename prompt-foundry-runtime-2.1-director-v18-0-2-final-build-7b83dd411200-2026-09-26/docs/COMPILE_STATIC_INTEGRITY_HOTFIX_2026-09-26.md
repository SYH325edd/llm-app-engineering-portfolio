# Compile Static Integrity Hotfix — 2026-09-26

Build: `5538bcbb7fd9`  
Runtime: `2.1`  
Director Scene: `director_scene_context.v1`  
Director Shot: `director_shot.v18_0`  
Compiler contract: `consumption_v2m`  
Readiness contract: `production_readiness.v4_11`

> **Superseded root-cause note (later on 2026-09-26):** the consumption fallback fix in this report remains valid, but subsequent production evidence showed that repeated E023 could also originate from a legacy/all-empty PVB that was valid under `pvb_character.v3`. The current contract is therefore `pvb_character.v3_1`, with an aggregate minimum identity-anchor invariant and PVB-targeted recovery. See `PVB_IDENTITY_ANCHOR_RECOVERY_CLOSEOUT_2026-09-26.md`.

## Production failure reproduced

The reported compile pause contained two independent hard failures:

- `E023_SHOT_NOT_SELF_CONTAINED`: visible characters reached the final Shot but `character_continuity_anchor` was empty.
- `exact_dialogue_repeated_in_visual_content`: SH016 serialized the same FrozenText dialogue in both the dialogue track and visual performance prose.

The fix does **not** downgrade either hard gate and does not add Shot-ID or story-specific exceptions.

## Root cause 1 — canonical identity existed but the framing selector discarded it

`visible_character_refs()` correctly identified visible characters. The defect was in the deterministic continuity compactor: a detail Shot could prefer hand/feet/body fields, then fall back only to `age_appearance` / default wardrobe. If those two leaves were empty while canonical `face`, `hair`, `skin`, `body`, `outerwear`, `shirt`, etc. existed, the compiler emitted an empty anchor and E023 fired at the final gate.

Fix: when the framing-preferred subset is empty, the compiler chooses the smallest available subset from the **same canonical asset record**. It never reads Shot prose and never invents appearance. If the canonical record itself is empty, E023 remains Hard Fail.

## Root cause 2 — Director evidence text crossed the visual/dialogue channel boundary

`performance_actions` already removed exact dialogue before rendering, but v17/v18 `performance_logic` and `performance_execution` did not apply the same channel isolation. A Director item could legitimately cite FrozenText as evidence, then the compiler rendered that quote into `visual_content`.

Fix: performance logic/execution fragments are deterministically stripped of the current frozen dialogue before visual serialization. The authoritative dialogue track is untouched. Dangling non-executable speech residue is dropped rather than rewritten.

## Short-dialogue boundary

The old literal/sub-string approach is unsafe for one-character/short Chinese utterances. Example: dialogue `好` must not mutate `状态良好`; readiness must not interpret `良好` as a repeated utterance.

The sanitizer/readiness matcher now treats short dialogue as duplicate only when it is an independent fragment, an exact quoted span, or part of an explicit speech construction. Longer dialogue remains eligible for literal duplicate detection.

## Rejected approach

A stricter PVB rule requiring every non-Story-owned visual field to be non-empty was trialed and rejected. It broke legitimate optional/skipped fields and caused upstream integration failures. The PVB contract is therefore unchanged at `pvb_character.v3`. This hotfix stays at the actual consumption/readiness boundary.

## Validation

- Full deterministic regression: **643/643 PASS**.
- Reported SH-cluster integration regression: **PASS**; zero E023 / dialogue-duplication errors.
- Identity matrix stress: **7,200** compile/readiness cases, **0 failures** when at least one canonical visual asset exists.
- Inverse boundary: no canonical visual asset -> E023 **still Hard Fails**.
- Dialogue boundary stress: **90,000** sanitizer/readiness checks, all expected classifications pass.
- Fact Spine and Frozen Core source files are unchanged from the v18 Iteration-1 delivery.

## Resume behavior

This source change creates a new Build ID. Runtime already treats a build change as a recovery boundary: stale validator-specific repair hints are cleared while completed upstream semantic checkpoints remain eligible for normal contract/input-hash reuse. A Run paused at `compile` can therefore be resumed under this build without replaying stale compile repair metadata; the failed compile unit is rebuilt using the corrected deterministic compiler/readiness code.
