# Production Shot Executability v1

Date: 2026-09-17

## Scope

This patch is deliberately limited to four business-critical production rules:

1. Shot visualizability: a Shot description must contain directly observable visual facts, not cognition, authorial commentary, or audio-only information.
2. Shot temporal atomicity: a Shot must represent one continuous, shootable time window; long narrative duration or multiple time stages are rejected for repair/splitting.
3. Director speech-action purity: performance_actions for speakers may contain only visible performance cues and must not restate dialogue semantics.
4. State naturalization: state_in is rendered as concise natural Chinese sentences instead of field-dump phrasing.

W003 duration estimation remains unchanged and warning-only. Frozen Core is unchanged.

## Contract versions

- Storyboard: storyboard_scene.v6
- Director: director_shot.v9
- Consumption compiler remains consumption_v1

## Generic behavior

The production implementation does not contain story-specific names, props, phrases, or special cases from the validation story. Rules operate on semantic categories and contract structure.

## Business regression examples

- cognition such as “仿佛想起……” -> Storyboard non-visual validation error
- long compressed duration such as “寻找了一个小时” -> non-atomic time-window error
- multiple narrative phases in one Shot -> non-atomic time-window error
- audio-only / authorial comparison -> non-visual description error
- speaker cue “问等多久” with dialogue “等多久？” -> Director validation error and compiler fallback reduces it to a clean speaking cue
- state fragments “人物，地上，蹲下” -> “人物在地上蹲下”

## Verification

- Full pytest suite: 238 passed
- Frozen Core / Integration Freeze: passed
- Story-specific production-code scan for validation-story entities: 0 matches
