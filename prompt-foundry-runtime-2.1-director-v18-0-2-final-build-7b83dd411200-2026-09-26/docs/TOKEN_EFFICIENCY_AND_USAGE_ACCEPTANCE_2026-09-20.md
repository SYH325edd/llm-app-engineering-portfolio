# Token Efficiency and Usage Acceptance — 2026-09-20

## 1. Goal and boundary

This pass reduces redundant LLM input without changing the Prompt Foundry production chain or merging semantic stages.

The authoritative chain remains:

```text
Source
→ Story Bible
→ Scene Plan
→ Script
→ Storyboard
→ PVB / PSB / Style Guide
→ Production Semantics
→ Director
→ State / ShotSpec
→ Shot Consumption Manifest
→ Compile / Evaluation
```

The optimization rule is deliberately conservative: remove serialization waste, duplicated source text, repair-only instructions from normal calls, and irrelevant per-shot context; do not weaken source fidelity, reference integrity, state authority, or downstream validators.

## 2. Root causes found

### 2.1 Pretty-printed JSON was sent to the model

Ark user payloads used `json.dumps(..., indent=2)`. Whitespace and line breaks have no business value but were paid input. The provider payload is now serialized compactly.

### 2.2 Source text was duplicated in model context

Story Bible and Scene Plan sent both the complete `source_text` and a source index whose entries repeated the same text plus program-owned offsets. Script also sent the same Scene slice twice under `source_text` and `scene_source_text`.

The model now receives only the source representation it needs. Source offsets remain deterministic program state and are not duplicated into the LLM context.

### 2.3 High-fan-out shot stages repeatedly resent large static contracts

Production Semantics and Director run once per shot. Their previous request bodies repeatedly contained large example objects, full assets, and repair instructions even during normal generation. With dozens of shots, this dominated input usage.

Normal calls now use compact model-facing contracts and projected shot-local assets. Full deterministic context remains available to program validators. Repair-only instructions are injected only for repair calls.

### 2.4 Provider usage was not observable

Streaming responses can contain the final usage information separately from content chunks. The old collector discarded events with no `choices`, so the Runtime could not answer which Run, Stage, Unit, or Repair consumed tokens.

The Runtime now records provider usage when returned and keeps a deterministic character-volume fallback for Mock/offline acceptance.

## 3. Implemented changes

### Ark/provider layer

- Compact JSON serialization for model user payloads.
- Request streaming usage metadata.
- Preserve `prompt_tokens`, `completion_tokens`, and `total_tokens` from the final stream usage event.
- `consume_last_usage()` exposes one semantic model call's accumulated provider usage to Runtime.
- Provider recovery / JSON syntax recovery usage remains part of the same semantic-call usage record.

### Runtime usage ledger

Every model attempt can now write usage into the Unit attempt and into `run.token_usage`.

```json
{
  "requests": 12,
  "repair_requests": 1,
  "prompt_tokens": 12345,
  "completion_tokens": 2345,
  "total_tokens": 14690,
  "input_chars": 60403,
  "output_chars": 5846,
  "by_stage": {
    "director": {
      "requests": 2,
      "repair_requests": 0,
      "prompt_tokens": 0,
      "completion_tokens": 0,
      "total_tokens": 0,
      "input_chars": 19016,
      "output_chars": 0
    }
  }
}
```

When a Mock provider does not return real token usage, token fields remain zero rather than fabricating values; `input_chars` / `output_chars` still provide a reproducible local benchmark.

### Source context slimming

- Story Bible: model receives compact source units (`source_ref + text`), not a second full `source_text` plus offsets.
- Scene Plan: same compact source-unit contract.
- Script: one Scene-local source slice only; duplicate `source_text` field removed.
- Source `start/end` offsets remain program-owned and are still used for evidence materialization and validation.

### Production Semantics context slimming

The model receives only production-relevant character, prop, scene, and context fields. Full context still exists in the validator closure, so this does not relax semantic enforcement.

Large example-filled output templates were replaced by compact structural templates. The canonical validator contract remains authoritative.

### Director context slimming

The model receives the current shot, compact current Script Beat, compact relevant assets, Production Semantics, previous resolved state, and program-owned authority. Full repair instructions are not sent during successful first-pass generation.

Normal and repair system prompts are now separated deterministically: repair-specific instructions are injected only when an actual semantic repair occurs.

### Web observability

The Run overview can display actual total/input/output tokens when provider usage exists. In Mock/offline mode it displays model input characters instead. Repair request counts and the full usage ledger are inspectable.

## 4. Same-framework before/after benchmark

Benchmark input: the same two-shot framework-native acceptance story, same stage chain and same Mock semantic outputs. Measurement counts actual `system prompt + serialized user payload` characters sent at each model call. It is an input-volume benchmark, not a claim that character percentage equals the exact provider token percentage.

| Stage | Baseline chars | Optimized chars | Reduction |
| --- | ---: | ---: | ---: |
| Story Bible | 5,952 | 4,232 | 28.9% |
| Scene Plan | 7,852 | 5,656 | 28.0% |
| Script | 7,311 | 5,287 | 27.7% |
| Storyboard | 8,060 | 5,809 | 27.9% |
| PVB (2 calls) | 5,642 | 4,450 | 21.1% |
| PSB | 2,561 | 2,052 | 19.9% |
| Style Guide | 4,226 | 2,934 | 30.6% |
| Production Semantics (2 calls) | 20,563 | 10,967 | 46.7% |
| Director (2 calls) | 34,572 | 19,016 | 45.0% |
| **Total** | **96,739** | **60,403** | **37.6%** |

The biggest gains are deliberately concentrated in the high-fan-out shot stages rather than achieved by deleting semantic stages.

## 5. Larger-workload projection

Using the measured per-call input size above, a representative workload of:

```text
15 Script Scenes
15 Storyboard Scenes
8 Character PVB calls
8 PSB Scene calls
50 Production Semantics shots
50 Director shots
1 Story Bible
1 Scene Plan
1 Style Guide
```

projects to approximately:

```text
baseline   ≈ 1,670,026 input characters
optimized  ≈   963,053 input characters
reduction  ≈ 42.3%
```

This is a projection from measured payload sizes, not a real Ark billing measurement. Real model token counts depend on the selected model tokenizer and are now captured automatically in `run.token_usage` when Ark returns usage.

## 6. What was intentionally NOT changed

- Production Semantics and Director were not merged.
- No Story/Script/Storyboard source-fidelity validator was removed.
- No reference or state-authority rule was loosened to save tokens.
- Final Prompt structure and Shot Consumption Manifest remain unchanged.
- No semantic cache, hidden cross-run reuse, speculative batching, or provider-specific prompt-prefix trick was introduced.
- No token count is estimated and presented as provider truth; actual provider usage and local character benchmark remain separate.

## 7. Acceptance requirements

Token optimization is accepted only if both business behavior and usage instrumentation pass:

1. Full repository test suite passes.
2. Framework-native async API E2E reaches `completed` with `compile_status=ok`.
3. Persisted checkpoint/resume E2E still succeeds across application instances.
4. Final 13-field shot prompt remains available and semantically equivalent.
5. Ark usage chunks with `choices=[]` are preserved.
6. Runtime aggregates usage by Run / Stage / Unit and counts Repair requests separately.
7. Same-framework local input-volume benchmark is lower than the frozen baseline.
8. Python compile and Web JavaScript syntax checks pass.

## 8. Next real-provider acceptance

The next real Ark run should record, for the same source/run:

- total prompt tokens;
- total completion tokens;
- total tokens;
- requests and repair requests;
- by-stage token totals;
- highest-cost individual Units.

Those provider-returned measurements should be used for the next optimization decision. The current pass intentionally stops before changing stage granularity or batching because the existing framework now has enough telemetry to make that decision from evidence instead of intuition.
