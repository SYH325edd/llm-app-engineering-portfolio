# Dialogue Visibility Authority Rebalance — 2026-09-20

## Root cause

The previous contracts contradicted each other:

- Storyboard required every dialogue speaker to be present in `Shot.character_refs`.
- Production Semantics then asked the model to decide `dialogue[].offscreen`.

That made `offscreen` both redundant and brittle. It also blocked a normal film grammar pattern: dialogue continuing while the picture cuts to a listener/reaction shot.

## Frozen authority

### Storyboard v11

- `Shot.character_refs` means characters visually present in the current Shot.
- Script dialogue speaker and text remain frozen and must reconstruct exactly across Shots.
- A dialogue speaker may be absent from the current Shot visuals; this is a valid offscreen/reaction-shot audio segment.
- The Storyboard must not add a speaker to `character_refs` only because their voice continues.

### Production Semantics v1f

`dialogue` is fully program-owned. For every frozen dialogue segment:

```text
offscreen = speaker_character_id not in Shot.character_refs
```

The model no longer outputs or repairs `dialogue.offscreen`. This removes a semantic boolean that can be derived exactly from upstream shot visibility.

## Why this is not a story-specific patch

The rule depends only on stable contracts (`dialogue.character_id` and `Shot.character_refs`). It contains no story names, locations, props, or text patterns.

## Regression boundary

Still hard-failed:

- changed/missing/reordered Script dialogue;
- invalid visible `character_refs`;
- invalid Production Semantics visual/audio evidence;
- model-owned ambiguous booleans that are not deterministically derivable (for example `diegetic_text.required_visible`).

Now allowed:

- a frozen line continuing across a Shot where its speaker is not visually present;
- Production Semantics model output omitting `dialogue` entirely; Runtime reconstructs canonical dialogue deterministically.
