from __future__ import annotations

import copy


def _context():
    return {
        "shot": {
            "shot_id": "SH001",
            "scene_id": "SC001",
            "beat_id": "B001",
            "character_refs": ["char_001"],
            "prop_refs": ["prop_001"],
            "description": "甲把信封放到桌上。走廊外传来脚步声。",
            "dialogue": [{"character_id": "char_001", "line": "我回来了。"}],
            "source_evidence": [
                {"quote": "甲把信封放到桌上。"},
                {"quote": "走廊外传来脚步声。"},
            ],
        },
        "assets": {
            "context": {},
            "characters": {"char_001": {"character_id": "char_001"}},
            "props": {"prop_001": {"prop_id": "prop_001"}},
        },
        "program_owned": {
            "allowed_character_refs": ["char_001"],
            "allowed_prop_refs": ["prop_001"],
            "current_shot_evidence": [
                "甲把信封放到桌上。",
                "走廊外传来脚步声。",
                "我回来了。",
            ],
            "dialogue_pairs": [{"character_id": "char_001", "line": "我回来了。"}],
        },
    }


def _valid_candidate():
    return {
        "visual_events": [{
            "action": "甲把信封放到桌上。",
            "character_refs": ["char_001"],
            "prop_refs": ["prop_001"],
            "source_evidence": [{"quote": "甲把信封放到桌上。"}],
        }],
        "audio_events": [{
            "audio_type": "diegetic",
            "content": "走廊外传来脚步声。",
            "source_evidence": [{"quote": "走廊外传来脚步声。"}],
        }],
        "renderability_status": "renderable",
        "renderability_issues": [],
        "dialogue": [{"character_id": "char_001", "line": "我回来了。", "offscreen": False}],
        "diegetic_text": [],
        "production_choices": [],
        "appearance_overlays": [],
    }



def test_context_builder_does_not_promote_model_shot_description_to_evidence_authority():
    from runtime.context_builder import ContextBuilder

    story = {
        "characters": [{"character_id": "char_001"}],
        "props": [{"prop_id": "prop_001"}],
        "scenes": [{"scene_id": "scene_001"}],
        "narrative_contexts": [],
    }
    board = {
        "scenes": [{
            "scene_id": "SC001",
            "location_ref": "scene_001",
            "context_ref": "",
            "shots": [{
                "shot_id": "SH001",
                "scene_id": "SC001",
                "beat_id": "B001",
                "character_refs": ["char_001"],
                "prop_refs": ["prop_001"],
                "description": "模型生成的镜头描述，不得反过来成为自己的证据。",
                "source_evidence": [{"quote": "甲把信封放到桌上。"}],
                "dialogue": [{"character_id": "char_001", "line": "我回来了。"}],
            }],
        }],
    }

    context = ContextBuilder(story_bible=story, storyboard_base=board).production_semantics_context("SH001")
    evidence = context["program_owned"]["current_shot_evidence"]

    assert context["shot"]["description"] == "模型生成的镜头描述，不得反过来成为自己的证据。"
    assert evidence == ["甲把信封放到桌上。", "我回来了。"]
    assert context["shot"]["description"] not in evidence
    assert context["program_owned"]["current_shot_visual_authority"] == [
        "模型生成的镜头描述，不得反过来成为自己的证据。"
    ]


def test_visual_event_uses_frozen_shot_visual_authority_while_source_evidence_stays_provenance():
    from runtime.stages.production_semantics import canonicalize_production_semantics, validate_production_semantics_output

    ctx = _context()
    source_quote = "甲站到桌边，手里拿着信封，随后把信封轻轻放在桌面上。"
    frozen_shot = "甲站到桌边，手里拿着信封，随后把信封放到桌上。"
    ctx["shot"]["description"] = frozen_shot
    ctx["shot"]["source_evidence"] = [{"quote": source_quote}]
    ctx["program_owned"]["current_shot_evidence"] = [source_quote, "我回来了。"]
    ctx["program_owned"]["current_shot_visual_authority"] = [frozen_shot]

    candidate = _valid_candidate()
    candidate["visual_events"] = [{
        "action": "甲把信封放到桌上。",
        "character_refs": ["char_001"],
        "prop_refs": ["prop_001"],
        "source_evidence": [{"quote": source_quote}],
    }]
    candidate["audio_events"] = []

    value, _ = canonicalize_production_semantics(candidate, ctx)
    assert validate_production_semantics_output(value, ctx) == []

    candidate["visual_events"][0]["action"] = "甲突然拔枪指向门口。"
    value, _ = canonicalize_production_semantics(candidate, ctx)
    kinds = {item["type"] for item in validate_production_semantics_output(value, ctx)}
    assert "production_semantics_visual_event_not_supported" in kinds

def test_production_semantics_v1a_contract_is_strict_and_program_owns_identity():
    from runtime.stages.production_semantics import CONTRACT_VERSION, build_production_semantics_payload

    payload = build_production_semantics_payload(_context(), unit_id="production_semantics:SH001")
    assert CONTRACT_VERSION == "production_semantics_shot.v1j"
    assert payload["contract_version"] == CONTRACT_VERSION
    assert "shot_id" not in payload["output_template"]
    assert "context_ref" not in payload["output_template"]
    assert payload["output_contract"]["program_owned_fields"] == [
        "shot_id", "context_ref", "dialogue", "dialogue.character_id", "dialogue.line", "dialogue.offscreen",
        "dialogue.delivery_mode", "dialogue.embedded_quotes", "dialogue.embedded_quotes[].text",
        "dialogue.embedded_quotes[].mode", "production_choices[].narrative_context_ref",
        "appearance_overlays[].narrative_context_ref",
    ]
    assert set(payload["output_template"]) == {
        "visual_events", "audio_events", "renderability_status", "renderability_issues",
        "dialogue_delivery", "diegetic_text", "production_choices", "appearance_overlays",
    }


def test_production_semantics_v1a_accepts_evidence_anchored_visual_and_audio_events():
    from runtime.stages.production_semantics import canonicalize_production_semantics, validate_production_semantics_output

    value, _ = canonicalize_production_semantics(_valid_candidate(), _context())
    assert value["shot_id"] == "SH001"
    assert value["context_ref"] == ""
    assert validate_production_semantics_output(value, _context()) == []


def test_production_semantics_v1a_rejects_unanchored_or_nonvisual_visual_event():
    from runtime.stages.production_semantics import canonicalize_production_semantics, validate_production_semantics_output

    candidate = _valid_candidate()
    candidate["visual_events"][0]["action"] = "甲意识到自己已经失去过去。"
    candidate["visual_events"][0]["source_evidence"] = [{"quote": "原文没有这句话"}]
    value, _ = canonicalize_production_semantics(candidate, _context())
    kinds = {item["type"] for item in validate_production_semantics_output(value, _context())}
    assert "production_semantics_unanchored_evidence" in kinds
    assert "production_semantics_non_visual_event" in kinds


def test_production_semantics_v1a_does_not_duplicate_frozen_dialogue_into_audio_events():
    from runtime.stages.production_semantics import canonicalize_production_semantics, validate_production_semantics_output

    candidate = _valid_candidate()
    candidate["audio_events"] = [{
        "audio_type": "diegetic",
        "content": "我回来了。",
        "source_evidence": [{"quote": "我回来了。"}],
    }]
    value, _ = canonicalize_production_semantics(candidate, _context())
    kinds = {item["type"] for item in validate_production_semantics_output(value, _context())}
    assert "production_semantics_dialogue_in_audio_event" in kinds


def test_production_semantics_v1a_renderability_is_closed_enum_and_issues_are_evidence_gated():
    from runtime.stages.production_semantics import canonicalize_production_semantics, validate_production_semantics_output

    candidate = _valid_candidate()
    candidate["renderability_status"] = "maybe"
    candidate["renderability_issues"] = [{
        "type": "underspecified_action",
        "detail": "动作机制未明确",
        "source_evidence": [{"quote": "不存在的证据"}],
    }]
    value, _ = canonicalize_production_semantics(candidate, _context())
    kinds = {item["type"] for item in validate_production_semantics_output(value, _context())}
    assert "production_semantics_invalid_renderability" in kinds
    assert "production_semantics_unanchored_evidence" in kinds


def test_production_semantics_v1a_rejects_out_of_scope_fields():
    from runtime.stages.production_semantics import canonicalize_production_semantics, validate_production_semantics_output

    candidate = _valid_candidate()
    candidate["camera_override"] = {"lens": "擅自新增"}
    value, _ = canonicalize_production_semantics(candidate, _context())
    kinds = {item["type"] for item in validate_production_semantics_output(value, _context())}
    assert "production_semantics_unknown_field" in kinds


def test_runtime_unitizes_production_semantics_without_changing_director_input_yet(tmp_path):
    from app.store import RunStore
    from runtime.checkpoints import CheckpointStore
    from runtime.orchestrator import RuntimeV20
    from tests.runtime.test_runtime20_foundations import TwoShotModel

    class SemanticsModel(TwoShotModel):
        def __init__(self):
            super().__init__()
            self.director_payloads = []

        def generate_json(self, stage, system_prompt, user_payload):
            if stage == "production_semantics_shot":
                self.calls.append((stage, user_payload.get("unit_id")))
                shot = user_payload["shot"]
                evidence = shot["source_evidence"][0]["quote"] if shot.get("source_evidence") else shot["description"]
                return {"production_semantics": {
                    "visual_events": [{
                        "action": shot["description"],
                        "character_refs": list(shot.get("character_refs") or []),
                        "prop_refs": list(shot.get("prop_refs") or []),
                        "source_evidence": [{"quote": evidence}],
                    }],
                    "audio_events": [],
                    "renderability_status": "renderable",
                    "renderability_issues": [],
                    "dialogue": [
                        {"character_id": x.get("character_id"), "line": x.get("line"), "offscreen": False}
                        for x in (shot.get("dialogue") or [])
                    ],
                    "diegetic_text": [],
                    "production_choices": [],
                    "appearance_overlays": [],
                }}
            if stage == "director_shot":
                self.director_payloads.append(copy.deepcopy(user_payload))
            return super().generate_json(stage, system_prompt, user_payload)

    model = SemanticsModel()
    runtime = RuntimeV20(
        model=model,
        store=RunStore(tmp_path / "runs"),
        checkpoints=CheckpointStore(tmp_path / "checkpoints"),
    )
    run = runtime.start("阿宁站在窗边，手里拿着信封。阿宁转身。", title="semantics v1a")

    assert run["status"] == "completed"
    assert run["contracts"]["production_semantics"] == "production_semantics_shot.v1j"
    semantics = run["artifacts"]["production_semantics"]["shots"]
    assert [item["shot_id"] for item in semantics] == ["SH001", "SH002"]
    assert model.calls.count(("production_semantics_shot", "production_semantics:SH001")) == 1
    assert model.calls.count(("production_semantics_shot", "production_semantics:SH002")) == 1
    # Patch 06 consumes the frozen Production Semantics artifact; Patch 08 has now migrated the authoritative Compiler to v2b.
    assert all("production_semantics" in payload for payload in model.director_payloads)
    assert run.get("compiler_version") == "consumption_v2m"
