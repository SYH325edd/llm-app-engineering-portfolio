# Director Execution Quality Closeout — v17

Build target: Runtime 2.1 / Core 1.3 Frozen.

## Goal

Turn each independently consumable Shot prompt from a correct scene description into a restrained, executable single-shot director sheet without changing plot authority.

Director v17 may decide **how to act and how to shoot**. It may not decide what happened, what was said, character identity/relationship/history, or outcome.

## Authority split

- Production Semantics: objective current-Shot events, visible participants/props, frozen dialogue/narration, audible events.
- Director v17: grounded performance interpretation, visible/audible acting execution, dialogue delivery, camera execution.
- State Resolver: carries program-owned performance baseline; it does not invent psychology.
- Consumption Manifest: selects minimum sufficient identity, performance, blocking, camera, effective scene, dialogue/audio.
- Compiler v2g: deterministic 14-field Chinese director-sheet renderer.

## Director v17 blocks

- `performance_logic[]`: optional, evidence-bound interpretation only. Unsupported logic stays debug-only and is not rendered.
- `performance_execution[]`: optional visible/audible cues; unused signals remain absent/empty.
- `dialogue_delivery[]`: references FrozenTextUnit IDs only. Director never emits replacement dialogue text.
- `camera_execution`: pure shot size/camera/movement/framing ownership. No dialogue, acting action, psychology, or lighting in `framing_note`.
- Legacy `execution_framing` / `execution_shot_design` remain synchronized for one compatibility release.

## Final prompt fields

1. 镜号
2. 时长
3. 场景
4. 人物空间站位
5. 景别
6. 摄法
7. 人物视线
8. 画面内容
9. 旁白
10. 台词
11. 动作音效
12. 环境音效
13. 氛围音效
14. 配乐

Every Shot remains standalone; later Shots never depend on an earlier prompt for character or scene identity.

## Quality gates

Hard:
- `E024_NON_AUDIBLE_AUDIO_CONTENT`
- `E025_PERFORMANCE_NOT_EXECUTABLE`
- `E027_CAMERA_FIELD_OWNERSHIP`

Soft during v17 learning cycle:
- `W012_PERFORMANCE_TOO_ABSTRACT`
- `W013_ACTION_TRANSITION_MISSING`
- `W014_PERFORMANCE_DENSITY_MISMATCH`
- `W015_PERFORMANCE_BUDGET_HIGH`

Performance budgets are observational at first: low 90, medium 160, high 260 Chinese characters (performance + gaze). Do not delete required current-shot action merely to silence W015.

## Effective scene rule

Scene display, stable scene anchor, and scene state are compiled from the same effective Shot scene. A transformed active sublocation (for example, an old shop that is now another business) must not inherit unrelated root-scene landmarks merely because both share the same root scene asset.

## Compatibility / recovery

`director_shot.v17` changes `contract_id`, so v16.2 Director checkpoints are not reused as v17 canonical results. Unchanged upstream Story Bible / Scene Plan / Script / Storyboard / asset / Production Semantics checkpoints remain reusable. Downstream State Resolver, ShotSpec, Manifest, Compiler and Readiness are regenerated from v17 Director results.

## Validation boundary

Local deterministic regression, compileall and Runtime health are engineering validation only. Real Ark generation and Seedance output quality remain the final provider/product validation layer.
