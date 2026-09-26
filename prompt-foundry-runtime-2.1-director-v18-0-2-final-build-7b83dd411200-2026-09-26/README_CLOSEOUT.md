# Runtime 2.1 Director v18.0_2 — Current Closeout

Build: `7b83dd411200`  
Scene Director: `director_scene_context.v1_1`  
Shot Director: `director_shot.v18_0_2`  
State: `state_shotspec.v2`  
Compiler: `consumption_v2m`  
Production Readiness: `production_readiness.v4_11`

This closeout keeps Scene Context v1_1 frozen and changes only Shot Director consumption plus its read-only effect instrumentation. The main fixes are precision-first deterministic reaction candidates, removal of model-facing Base camera answer anchoring, explicit reaction visual comparison, explicit camera-decision ordering, and corrected reaction Audit speaker authority. Multi-character ambiguity no longer widens every non-speaker into a listener candidate.

No Fact Spine, State, Compiler, Readiness, Performance architecture, Prompt Composer, reaction quota, camera-variety hard gate, or movement-enrichment feature is introduced.

Validation: 659/659 tests PASS, compileall PASS, Web JS syntax PASS, precision-first reaction candidate / audit boundary stress x40,000 PASS, and protected-source hash audit PASS.

See `docs/DIRECTOR_V18_0_2_REACTION_CAMERA_CONSUMPTION_ACCEPTANCE_2026-09-26.md`.
