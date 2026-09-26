# Storyboard Overload Feedback v1 — Shadow Mode

This step implements the architecture for Runtime 2.1 Production Quality Closeout Step ③C without activating automatic Storyboard mutation.

## Purpose

Use the current W003 deterministic duration estimate as a **provisional signal only** to identify Shots that may carry too much executable content. Because current W003 does not count narration, shadow analysis adds a narration-only baseline using the same 4.5 chars/s speech assumption. This addition exists only in the shadow report and does not change W003. The tool then exposes safe redistribution boundaries that already exist in `FrozenTextUnit` authority.

## Safety boundary

- `mode = shadow_only`
- does not modify Storyboard
- does not modify Shot duration
- does not modify W003 parameters
- does not split inside a FrozenTextUnit
- does not invent cross-channel dialogue/narration ordering
- does not call a model

## Classification

The current thresholds are intentionally provisional and are not calibrated Seedance truth.

- `normal`: current W003 estimate does not exceed Shot duration by more than 0.25s
- `warning`: duration risk exists but is not large enough for provisional overload
- `overloaded`: estimate ratio >= 1.35 **and** estimated gap >= 1.5s

These thresholds are expected to be replaced or confirmed by real Seedance 2.5 calibration later.

## FrozenText redistribution

For an overloaded Shot:

- narration sentence units remain atomic
- dialogue units sharing the same `utterance_group_id` remain together
- multiple existing atomic segments may be returned to Storyboard allocator
- a single long atomic segment is marked `unsplittable_under_current_frozen_units`
- mixed dialogue+narration Shots are marked `allocator_required`; Runtime does not invent their relative semantic ordering

## CLI

```bash
python scripts/storyboard_overload.py --run-id <run_id>
```

Default output:

```text
data/storyboard-overload/<run_id>/feedback.json
```

The report is diagnostic only. Automatic Storyboard redistribution stays disabled until real Seedance calibration is available.
