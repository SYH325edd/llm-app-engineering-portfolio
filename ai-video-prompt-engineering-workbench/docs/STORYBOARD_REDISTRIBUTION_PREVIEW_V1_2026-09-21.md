# Storyboard Redistribution Preview v1

Date: 2026-09-21

## Purpose

Convert Storyboard Overload Feedback safe FrozenTextUnit boundaries into a deterministic redistribution preview plan without mutating the production Storyboard.

## Contract

- contract: `storyboard_redistribution_plan.v1-preview`
- mode: `preview_only`
- automatic Storyboard mutation: disabled
- automatic duration change: disabled
- apply: disabled

## Deterministic policy

For an overloaded Shot, preview v1 creates a plan only when Overload Feedback says `splittable_at_existing_unit_boundaries` and all candidate units are from one channel.

The first preview policy is intentionally conservative:

`one complete FrozenTextUnit -> one preview Shot`

This is not the final artistic grouping policy. It exists to prove lossless redistribution and downstream invalidation before any calibrated merging strategy is introduced.

Each preview Shot preserves only text authority/provenance:

- scene_id / beat_id
- exact FrozenTextUnit refs
- utterance_group / speaker authority inherited from Script
- source Shot provenance

The following must be regenerated before any future apply step:

- character_refs / prop_refs
- shot_size / camera / movement / composition
- duration
- description / continuity / source_evidence
- Production Semantics
- Director
- State / ShotSpec
- Consumption output

## Safety gates

The plan is invalid if FrozenTextUnit refs are omitted, duplicated, or reordered.

Cross-channel dialogue+narration ordering is not auto-decided by Runtime. Atomic one-unit overload remains blocked.

Old feedback generated before Dialogue FrozenText Granularity v1.1 is not migrated or guessed. If it reports one atomic long dialogue unit, redistribution remains blocked; rerun the story under the latest baseline and regenerate overload feedback.

## CLI

```powershell
python scripts/storyboard_redistribution.py --run-id <run_id>
```

or:

```powershell
python scripts/storyboard_redistribution.py --feedback <feedback.json>
```

Default output:

`data/storyboard-redistribution/<run_id>/plan.json`

## Not implemented in this step

- Storyboard mutation
- Shot renumbering
- model regeneration
- Director regeneration
- duration feedback activation
- calibrated unit merging
