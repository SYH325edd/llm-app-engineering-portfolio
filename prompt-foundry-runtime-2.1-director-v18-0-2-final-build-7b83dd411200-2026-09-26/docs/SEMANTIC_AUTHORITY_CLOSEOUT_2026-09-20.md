# Semantic Authority Closeout — 2026-09-20

This closeout keeps the Runtime 2.1 production chain unchanged while moving hard validation to factual authority boundaries and relaxing representation-only drift.

## Frozen chain

Source → Story Bible → Scene Plan → Script → Storyboard → PVB/PSB/Style → Production Semantics → Director → State/ShotSpec → Shot Consumption Manifest → Compile/Eval.

## Hard boundaries added

- Story Bible v7: explicit facts, identity locks and visual locks require fact-level `supports` to real source evidence in fresh Runtime runs. Evidence that exists in the novel but does not support the claimed fact is rejected. `story_bible_fact_not_supported` now exposes the exact entity/fact/evidence target; Repair first rebinds insufficient `source_refs`, and only when the source truly does not support the fact may it correct/remove that one validator-targeted fact while preserving all unrelated facts.
- Scene Plan v6: every Beat has source provenance in fresh runs; Beat descriptions must remain anchored to those source units.
- Script v6: high-confidence speaker attribution is frozen when the source contains a known character name plus an explicit speech verb, including common unquoted `角色说：对白。` prose.
- Storyboard: a legal evidence quote is no longer sufficient by itself; the Shot description must remain anchored to that evidence.
- Production Semantics: visual events must remain anchored to current-Shot evidence. Fixed context/impact/story-change/environment-carrier fields are program-owned. Production-design audio may not smuggle music or new high-semantic story events.
- Director: every performance action needs current-Shot evidence; persistent `action_delta` uses a positive whitelist instead of arbitrary custom keys.

## Soft/representation handling

- Exact boolean/numeric/common camera enum encodings are normalized deterministically when unambiguous.
- Downstream evidence quotes are deterministically re-anchored when only whitespace/quotation/punctuation representation differs. Semantic paraphrase is not repaired this way.
- `scene_description` remains an editorial summary; event-level Beat descriptions carry the hard provenance boundary.
- `inferred_facts` remain stored in Story Bible but are not promoted into downstream production-model authority. Downstream payloads use explicit facts and frozen identity/visual locks.

## Source coverage

The Source Index remains deterministic and immutable. Ordinary comma clauses remain one source unit. A sentence with explicit physical-space transition clauses such as `走出卧室，穿过走廊，来到客厅。` is conservatively split at those transition boundaries so adjacent physical Scenes can own distinct source refs without duplicating one source unit.

## Acceptance / mutation tests

The regression suite now actively attacks the Runtime with:

- real evidence attached to a fabricated Story Bible fact;
- valid source refs attached to a fabricated Beat;
- correct dialogue text assigned to the wrong high-confidence speaker;
- valid Script evidence attached to an invented Storyboard action;
- valid Shot evidence attached to an invented Production Semantics visual event;
- music/new-story-event sound hidden as production-design audio;
- missing Director performance evidence;
- arbitrary persistent Director state keys;
- string booleans/numeric durations/Chinese camera enums;
- representation-only downstream evidence drift;
- inferred facts leaking into downstream model payloads;
- one sentence crossing several physical locations.

All of these are now either rejected at the owning Stage or deterministically normalized when the semantics are unambiguous.

## Non-claim

Passing the deterministic/Mock/API regression corpus proves framework contract closure, not a statistical 99% success rate against arbitrary live-model novels. Live Ark corpus testing remains the evidence required for that product-level claim.
