# Production Prompt Cleanup Acceptance — 2026-09-17

## Scope

This patch only closes the existing production-output gaps. No new product feature was added and the duration heuristic was not changed.

Implemented:

1. Final Seedance prompt Chinese-only hard gate.
2. Dialogue de-duplication remains active; meta cues such as “说出第一句台词” / “讲述……经过” are stripped from speaking cues.
3. Non-visual shot narration such as smell / atmosphere / feeling summaries is not serialized as visible action.
4. Scene asset compiler removes time-specific light states, event-state clauses, smell, people actions, and other non-static content.
5. Global style is compressed to a short deterministic visual direction instead of copying literary / asset-specific paragraphs.
6. Character asset compiler removes time-specific lighting contamination from stable identity text.
7. Blocked shots now expose source layer and a concrete suggested fix; Web displays both.
8. Upstream Stage 4 / Director prompts explicitly request Simplified Chinese, while runtime validation/recovery semantics are preserved. The final Consumption Compiler remains the hard safety gate.

## English output policy

If `composition`, `description`, or Director `performance_actions.action` contains Latin letters that cannot be deterministically mapped, the shot is blocked with `E007_NON_CHINESE_OUTPUT`. The English text is never serialized into `prompt_seedance`.

The blocked result includes:

- `source_layer`
- `source_layer_label`
- `suggested_fix`

## Scene static / dynamic policy

Scene asset prompts keep stable structure, fixed materials and static color/light information only.

Removed from stable scene asset output:

- time-specific lighting such as sunset / dawn / night / street-light state;
- dynamic story events;
- smell / scent / atmosphere summaries;
- people currently laughing / walking / talking;
- literary emotion commentary.

If filtering removes all static lighting or color information, the existing W001 / W002 warning is emitted rather than inventing a replacement.

## Style consumption policy

Long Style Guide prose is not copied verbatim. The compiler selects only short, source-supported visual anchors such as:

- 中国城市现实环境
- 写实生活流
- 纪实质感
- 低饱和
- 暖调
- 轻微胶片颗粒
- 轻微怀旧质感
- 克制自然

Concrete plot assets and literary emotions are not repeated into every character / scene asset prompt.

## “钥匙” regression examples

Verified locally with the reported failure forms:

- English composition (`Wide framing ...`) → blocked, no mixed-language prompt.
- English Director action (`opens his mouth ...`) → blocked, source points to Director.
- `胶水味混着灰尘...` → removed from scene/shot visual output.
- `几个年轻人在里面笑` → removed from static scene asset.
- `夕阳` → removed from stable scene asset lock.
- repeated dialogue cue (`说出第一句台词...说：“...”`) → output contains dialogue once.
- blocking guidance → source layer + suggested fix shown.

## Provenance boundary

Scene production details may legitimately come from PSB when Story Bible has no hard value. The Consumption Compiler does not invent layout/material details: Story Bible hard fact wins; otherwise the locked PSB production value is consumed.

## Verification

- Python test suite: 218 passed.
- `node --check apps/web/app.js`: passed.
- Duration heuristic unchanged; W003 remains warning-only.
- Camera/shot-size warnings remain warning-only; compiler does not silently change duration or shot size.
