# Seedance Duration Calibration v1

Date: 2026-09-21

## Scope

This stage starts Production Quality Closeout step ③. It deliberately does **not** change the current W003 formula, Storyboard allocation, FrozenTextUnit, Director, Consumption Compiler, or final Prompt.

The goal is to collect real Seedance 2.5 evidence before any duration heuristic becomes an execution authority.

## Canonical sample schema

Each Shot produces one `duration_calibration.v1` row with deterministic input features:

- `planned_duration_seconds`
- `dialogue_char_count`
- `narration_char_count`
- `speech_char_count`
- `visible_action_count`
- `reaction_count`
- `transition_count`
- `current_w003_estimate_seconds`

After a real Seedance 2.5 render, fill only the observation columns:

- `rendered_duration_seconds`
- `speech_completed`
- `action_completed`
- `reaction_completed`
- `overall_renderable`
- `actual_notes`

`visible_action_count` and `reaction_count` partition Director `performance_actions`. `transition_count` is deterministic: visible performance hand-offs plus one when the camera movement is non-static. These are calibration features, not new production contracts.

## Workflow

Extract a completed run:

```bash
python scripts/duration_calibration.py extract --run-file data/runs/<run_id>.json
```

This creates:

```text
data/duration-calibration/<run_id>/samples.json
data/duration-calibration/<run_id>/samples.csv
```

The CSV is the human-editable worksheet. Render the Shots in Seedance 2.5 and fill the observation columns with `true` / `false` plus notes.

Then generate the report:

```bash
python scripts/duration_calibration.py report \
  --input data/duration-calibration/<run_id>/samples.csv
```

## Calibration policy

- Fewer than 30 labeled Shots -> `status = collecting`.
- At least 30 labeled Shots **and both pass/fail `overall_renderable` outcomes** -> the tool may emit `candidate_calibration`.
- If 30+ samples all have the same outcome, the report returns `insufficient_variation`; a threshold cannot be calibrated from one-sided evidence.
- Candidate parameters are **candidate-only** and `applied_to_w003 = false`.
- No parameter is written back to `runtime/consumption_lint.py` automatically.
- W003 remains warning-only.
- No automatic return to Storyboard exists in this version.

The candidate fit evaluates a small deterministic parameter grid for:

- `speech_rate_chars_per_second`
- `action_cost_seconds`
- `reaction_cost_seconds`
- `transition_cost_seconds`

The report also records the current W003 baseline against real `overall_renderable` labels so the later formula change can be compared with evidence rather than intuition.

## Explicitly deferred

The following belong to the second half of step ③ and must not be implemented until real samples have been collected and reviewed:

```text
minor overflow -> Warning
severe overflow -> Storyboard allocator feedback
FrozenTextUnit redistribution
re-run downstream stages
```

Compiler must never split a Shot.

## Step ③B support: deterministic real-render batch selection

The calibration tool now provides a sampling-only `select` command so real Seedance 2.5 validation does not depend on manually cherry-picking shots.

```bash
python scripts/duration_calibration.py select \
  --run-file data/runs/<run_id>.json \
  --batch-size 10
```

The selector deliberately includes three W003-relative groups:

- `safe`: current estimate is at most 85% of planned duration.
- `borderline`: current estimate is between 85% and 115% of planned duration.
- `risk`: current estimate is above 115% of planned duration.

For a 10-shot batch the target mix is 3 safe / 3 borderline / 4 risk when the run contains enough examples. Inside each group, shots with actual speech/action/reaction load are preferred over empty shots. Selection is deterministic for the same run.

Outputs:

- `batch.json`: selected samples plus selection metadata.
- `batch.csv`: editable real-render result sheet; compatible with the existing `report` command.
- `prompts.md`: exact compiled `prompt_seedance` values for the selected shots.

This command is intentionally non-authoritative. It does **not** change W003, Storyboard allocation, compiled prompts, or any production artifact. Real render results still require manual labeling, and candidate parameters remain review-only.
