from __future__ import annotations

import copy

from runtime.stages.script import (
    CONTRACT_VERSION,
    SYSTEM_PROMPT,
    build_script_scene_payload,
    canonicalize_script_scene,
    validate_script_scene_output,
)


def _story() -> dict:
    return {
        "characters": [
            {"character_id": "char_001", "canonical_name": "阿宁", "role_type": "main"},
            {"character_id": "char_002", "canonical_name": "周野", "role_type": "supporting"},
            {"character_id": "char_003", "canonical_name": "路人", "role_type": "background"},
        ],
        "scenes": [{"scene_id": "scene_001", "canonical_name": "厨房"}],
        "props": [{"prop_id": "prop_001", "canonical_name": "饭盒"}],
        "narrative_contexts": [],
    }


def _plan_scene() -> dict:
    return {
        "scene_id": "SC001",
        "context_ref": "",
        "location_ref": "scene_001",
        "time": "傍晚",
        "character_refs": ["char_001", "char_002", "char_003"],
        "prop_refs": ["prop_001"],
        "continuous_with_previous": False,
        "dramatic_goal": "推进两人对话",
        "conflict": "",
        "turning_point": "",
        "beat_list": [
            {"beat_id": "B001", "description": "阿宁先开口。", "type": "dialogue"},
            {"beat_id": "B002", "description": "周野回应。", "type": "dialogue"},
        ],
    }


def _candidate() -> dict:
    return {
        "scene_id": "MODEL_SCENE",
        "context_ref": "context_wrong",
        "location_ref": "scene_wrong",
        "scene_heading": "厨房 - 傍晚",
        "scene_description": "两人在厨房交谈。",
        "beats": [
            {
                "beat_id": "MODEL_B1",
                "description": "阿宁先开口。",
                "dialogue": [{"character_id": "char_001", "line": "你回来了。"}],
            },
            {
                "beat_id": "MODEL_B2",
                "description": "周野回应。",
                "dialogue": [{"character_id": "char_002", "line": "我回来了。"}],
            },
        ],
    }


def test_script_payload_makes_plan_ids_program_owned_and_matches_frozen_shape():
    payload = build_script_scene_payload(
        "阿宁说：你回来了。周野说：我回来了。", _story(), _plan_scene(), unit_id="script:SC001"
    )
    assert payload["contract_version"] == CONTRACT_VERSION
    template = payload["output_template"]["scene"]
    assert "scene_id" not in template
    assert "location_ref" not in template
    assert "context_ref" not in template
    assert "beat_id" not in template["beats"][0]
    assert set(template["beats"][0]["dialogue"][0]) == {"character_id", "line"}
    assert payload["output_contract"]["program_owned_fields"] == ["scene_id", "location_ref", "context_ref", "beat_id"]
    assert "不要输出 scene_id/location_ref/context_ref/beat_id" in SYSTEM_PROMPT


def test_script_canonicalizer_copies_all_plan_owned_fields_by_position():
    normalized, changes = canonicalize_script_scene(_plan_scene(), _candidate())
    assert changes > 0
    assert normalized["scene_id"] == "SC001"
    assert normalized["location_ref"] == "scene_001"
    assert normalized["context_ref"] == ""
    assert [b["beat_id"] for b in normalized["beats"]] == ["B001", "B002"]


def test_script_validator_rejects_extra_fields_and_beat_count_mismatch():
    value, _ = canonicalize_script_scene(_plan_scene(), _candidate())
    value["camera"] = "close_up"
    value["beats"][0]["source_evidence"] = [{"quote": "x"}]
    value["beats"][0]["dialogue"][0]["character_name"] = "阿宁"
    value["beats"].pop()
    errors = validate_script_scene_output(
        _story(), _plan_scene(), value, source_text="阿宁说：你回来了。周野说：我回来了。"
    )
    paths = {e.get("path") for e in errors if e.get("type") == "extra_script_field"}
    assert "scene.camera" in paths
    assert "scene.beats[0].source_evidence" in paths
    assert "scene.beats[0].dialogue[0].character_name" in paths
    assert any(e["type"] == "script_beat_count_mismatch" for e in errors)


def test_script_validator_requires_current_scene_speaker_but_allows_background_dialogue_when_source_backed():
    value, _ = canonicalize_script_scene(_plan_scene(), _candidate())
    value["beats"][0]["dialogue"][0]["character_id"] = "char_999"
    value["beats"][1]["dialogue"][0]["character_id"] = "char_003"
    errors = validate_script_scene_output(
        _story(), _plan_scene(), value, source_text="阿宁说：你回来了。路人说：我回来了。"
    )
    kinds = {e["type"] for e in errors}
    assert "dialogue_speaker_not_in_scene_plan" in kinds
    assert "background_dialogue_forbidden" not in kinds
    assert not any(e.get("character_id") == "char_003" and e.get("type") in {"unknown_dialogue_speaker", "dialogue_speaker_not_in_scene_plan"} for e in errors)


def test_script_validator_rejects_non_verbatim_dialogue_and_reordered_or_duplicate_source_occurrences():
    source = "阿宁说：第一句。周野说：第二句。"
    value, _ = canonicalize_script_scene(_plan_scene(), _candidate())
    value["beats"][0]["dialogue"] = [{"character_id": "char_001", "line": "第二句。"}]
    value["beats"][1]["dialogue"] = [{"character_id": "char_002", "line": "第一句。"}]
    errors = validate_script_scene_output(_story(), _plan_scene(), value, source_text=source)
    assert any(e["type"] == "dialogue_source_order_mismatch" for e in errors)

    value2, _ = canonicalize_script_scene(_plan_scene(), _candidate())
    value2["beats"][0]["dialogue"] = [{"character_id": "char_001", "line": "原文没有。"}]
    value2["beats"][1]["dialogue"] = []
    errors2 = validate_script_scene_output(_story(), _plan_scene(), value2, source_text=source)
    assert any(e["type"] == "dialogue_not_in_source" for e in errors2)


def test_script_validator_accepts_canonical_scene_with_dialogue_in_source_order():
    source = "阿宁说：你回来了。周野说：我回来了。"
    value, _ = canonicalize_script_scene(_plan_scene(), _candidate())
    assert validate_script_scene_output(_story(), _plan_scene(), value, source_text=source) == []


def test_runtime_stage03_overrides_model_owned_plan_refs_without_repair(tmp_path):
    from app.store import RunStore
    from runtime.checkpoints import CheckpointStore
    from runtime.orchestrator import RuntimeV20
    from tests.api.fixtures.mock_story_run import MockModel

    class BadScriptRefModel(MockModel):
        def generate_json(self, stage, system_prompt, user_payload):
            value = super().generate_json(stage, system_prompt, user_payload)
            if stage == "script_scene":
                value = copy.deepcopy(value)
                scene = value["scene"]
                scene["scene_id"] = "MODEL_SCENE"
                scene["location_ref"] = "scene_999"
                scene["context_ref"] = "context_999"
                scene["beats"][0]["beat_id"] = "MODEL_BEAT"
            return value

    runtime = RuntimeV20(
        model=BadScriptRefModel(),
        store=RunStore(tmp_path / "runs"),
        checkpoints=CheckpointStore(tmp_path / "checkpoints"),
    )
    run = runtime.start("阿宁站在窗边，手里拿着信封。", title="Stage 3 wiring")
    assert run["status"] == "completed"
    scene = run["artifacts"]["script"]["scenes"][0]
    assert scene["scene_id"] == "SC001"
    assert scene["location_ref"] == "scene_001"
    assert scene["context_ref"] == ""
    assert scene["beats"][0]["beat_id"] == "B001"
    assert run["units"]["script:SC001"]["repair_count"] == 0


def test_script_high_confidence_manifest_is_required_subset_not_exhaustive():
    source = '傍晚，修理铺里，甲收拾工具。乙看着角落的柜子：“那柜子呢？”甲没回答。'
    story = {
        'characters': [
            {'character_id': 'char_001', 'canonical_name': '甲', 'aliases': [], 'role_type': 'main'},
            {'character_id': 'char_002', 'canonical_name': '乙', 'aliases': [], 'role_type': 'supporting'},
        ],
        'scenes': [{'scene_id': 'scene_001', 'canonical_name': '修理铺'}],
        'props': [], 'narrative_contexts': [],
    }
    plan = {
        'scene_id': 'SC001', 'context_ref': '', 'location_ref': 'scene_001',
        'character_refs': ['char_001', 'char_002'], 'prop_refs': [],
        'beat_list': [{
            'beat_id': 'B001', 'source_refs': ['SRC0001', 'SRC0002', 'SRC0003'],
            'description': '乙看向柜子并发问，甲没有回答。', 'type': 'interaction',
        }],
    }
    candidate = {
        'scene_heading': '修理铺 - 傍晚', 'scene_description': '两人在修理铺。',
        'beats': [{
            'description': '乙看向柜子并发问，甲没有回答。',
            'dialogue': [{'character_id': 'char_002', 'line': '那柜子呢？'}],
            'narration': [],
        }],
    }
    value, _ = canonicalize_script_scene(plan, candidate)
    errors = validate_script_scene_output(story, plan, value, source_text=source)
    hard = [e for e in errors if e['type'] not in {'script_beat_low_source_overlap'}]
    assert hard == []
    assert not any(e['type'] == 'script_dialogue_duplicate_or_extra' for e in errors)


def test_script_rejects_exact_narrative_substring_misclassified_as_dialogue():
    source = '傍晚，修理铺里，甲收拾工具。乙看着角落的柜子：“那柜子呢？”甲没回答。'
    story = {
        'characters': [
            {'character_id': 'char_001', 'canonical_name': '甲', 'aliases': [], 'role_type': 'main'},
            {'character_id': 'char_002', 'canonical_name': '乙', 'aliases': [], 'role_type': 'supporting'},
        ],
        'scenes': [{'scene_id': 'scene_001', 'canonical_name': '修理铺'}],
        'props': [], 'narrative_contexts': [],
    }
    plan = {
        'scene_id': 'SC001', 'context_ref': '', 'location_ref': 'scene_001',
        'character_refs': ['char_001', 'char_002'], 'prop_refs': [],
        'beat_list': [{
            'beat_id': 'B001', 'source_refs': ['SRC0001', 'SRC0002', 'SRC0003'],
            'description': '乙发问后甲没有回答。', 'type': 'interaction',
        }],
    }
    candidate = {
        'scene_heading': '修理铺 - 傍晚', 'scene_description': '两人在修理铺。',
        'beats': [{
            'description': '乙发问后甲没有回答。',
            'dialogue': [{'character_id': 'char_001', 'line': '甲没回答。'}],
            'narration': [],
        }],
    }
    value, _ = canonicalize_script_scene(plan, candidate)
    errors = validate_script_scene_output(story, plan, value, source_text=source)
    assert any(e['type'] == 'script_dialogue_not_source_speech' for e in errors)


def test_script_high_confidence_dialogue_remains_mandatory_even_with_other_valid_dialogue():
    source = '乙看着柜子：“那柜子呢？”乙说：“我明天再来。”甲没回答。'
    story = {
        'characters': [
            {'character_id': 'char_001', 'canonical_name': '甲', 'aliases': [], 'role_type': 'main'},
            {'character_id': 'char_002', 'canonical_name': '乙', 'aliases': [], 'role_type': 'supporting'},
        ],
        'scenes': [{'scene_id': 'scene_001', 'canonical_name': '修理铺'}],
        'props': [], 'narrative_contexts': [],
    }
    plan = {
        'scene_id': 'SC001', 'context_ref': '', 'location_ref': 'scene_001',
        'character_refs': ['char_001', 'char_002'], 'prop_refs': [],
        'beat_list': [{
            'beat_id': 'B001', 'source_refs': ['SRC0001', 'SRC0002', 'SRC0003'],
            'description': '乙连续说话，甲没有回答。', 'type': 'dialogue',
        }],
    }
    candidate = {
        'scene_heading': '修理铺', 'scene_description': '两人交谈。',
        'beats': [{
            'description': '乙连续说话，甲没有回答。',
            'dialogue': [{'character_id': 'char_002', 'line': '那柜子呢？'}],
            'narration': [],
        }],
    }
    value, _ = canonicalize_script_scene(plan, candidate)
    errors = validate_script_scene_output(story, plan, value, source_text=source)
    assert any(e['type'] == 'script_dialogue_omission' and '我明天再来。' in e.get('missing_dialogue', []) for e in errors)



def test_script_unbound_quoted_candidate_is_not_mandatory_direct_dialogue():
    source = '甲回忆起旧事。\n“师傅，替我收着。”\n甲没有继续说。'
    story = {
        'characters': [
            {'character_id': 'char_001', 'canonical_name': '甲', 'aliases': [], 'role_type': 'main'},
        ],
        'scenes': [{'scene_id': 'scene_001', 'canonical_name': '修理铺'}],
        'props': [], 'narrative_contexts': [],
    }
    plan = {
        'scene_id': 'SC001', 'context_ref': '', 'location_ref': 'scene_001',
        'character_refs': ['char_001'], 'prop_refs': [],
        'source_refs': [],
        'beat_list': [{
            'beat_id': 'B001', 'source_refs': [],
            'description': '甲回忆起旧事后沉默。', 'type': 'memory',
        }],
    }
    payload = build_script_scene_payload(source, story, plan, unit_id='script:SC001')
    inventory = payload['source_dialogue_inventory']
    quoted = next(item for item in inventory if item['line'] == '师傅，替我收着。')
    assert quoted['required'] is False
    assert 'speaker_ref' not in quoted

    candidate = {
        'scene_heading': '修理铺',
        'scene_description': '甲回忆旧事。',
        'beats': [{
            'description': '甲回忆起旧事后沉默。',
            'dialogue': [],
            'narration': [],
        }],
    }
    value, _ = canonicalize_script_scene(plan, candidate)
    errors = validate_script_scene_output(story, plan, value, source_text=source)
    assert not any(e['type'] == 'script_dialogue_omission' for e in errors)


def test_script_speaker_bound_source_dialogue_remains_mandatory():
    source = '甲说：“我明天再来。”'
    story = {
        'characters': [
            {'character_id': 'char_001', 'canonical_name': '甲', 'aliases': [], 'role_type': 'main'},
        ],
        'scenes': [{'scene_id': 'scene_001', 'canonical_name': '修理铺'}],
        'props': [], 'narrative_contexts': [],
    }
    plan = {
        'scene_id': 'SC001', 'context_ref': '', 'location_ref': 'scene_001',
        'character_refs': ['char_001'], 'prop_refs': [],
        'source_refs': [],
        'beat_list': [{
            'beat_id': 'B001', 'source_refs': [],
            'description': '甲说明天再来。', 'type': 'dialogue',
        }],
    }
    payload = build_script_scene_payload(source, story, plan, unit_id='script:SC001')
    inventory = payload['source_dialogue_inventory']
    required = next(item for item in inventory if item['line'] == '我明天再来。')
    assert required['required'] is True
    assert required['speaker_ref'] == 'char_001'

    candidate = {
        'scene_heading': '修理铺',
        'scene_description': '甲说明天再来。',
        'beats': [{
            'description': '甲说明天再来。',
            'dialogue': [],
            'narration': [],
        }],
    }
    value, _ = canonicalize_script_scene(plan, candidate)
    errors = validate_script_scene_output(story, plan, value, source_text=source)
    assert any(e['type'] == 'script_dialogue_omission' and '我明天再来。' in e.get('missing_dialogue', []) for e in errors)


def test_script_v10_program_projects_mandatory_direct_dialogue_to_source_beat():
    source = '甲整理工具。\n乙说：“我明天再来。”\n甲点头。'
    story = {
        'characters': [
            {'character_id': 'char_001', 'canonical_name': '甲', 'aliases': [], 'role_type': 'main'},
            {'character_id': 'char_002', 'canonical_name': '乙', 'aliases': [], 'role_type': 'supporting'},
        ],
        'scenes': [{'scene_id': 'scene_001', 'canonical_name': '店内'}],
        'props': [], 'narrative_contexts': [],
    }
    plan = {
        'scene_id': 'SC001', 'context_ref': '', 'location_ref': 'scene_001',
        'character_refs': ['char_001', 'char_002'], 'prop_refs': [],
        'source_refs': ['SRC0001', 'SRC0002', 'SRC0003'],
        'beat_list': [
            {'beat_id': 'B001', 'source_refs': ['SRC0001'], 'description': '甲整理工具。', 'type': 'action'},
            {'beat_id': 'B002', 'source_refs': ['SRC0002'], 'description': '乙说明天再来。', 'type': 'dialogue'},
            {'beat_id': 'B003', 'source_refs': ['SRC0003'], 'description': '甲点头。', 'type': 'reaction'},
        ],
    }
    candidate = {
        'scene_heading': '店内', 'scene_description': '两人在店里。',
        'beats': [
            {'description': '甲整理工具。', 'dialogue': [], 'narration': []},
            {'description': '乙说明天再来。', 'dialogue': [], 'narration': []},
            {'description': '甲点头。', 'dialogue': [], 'narration': []},
        ],
    }
    value, _ = canonicalize_script_scene(plan, candidate, source_text=source, story_bible=story)
    assert value['beats'][0]['dialogue'] == []
    assert value['beats'][1]['dialogue'] == [{'character_id': 'char_002', 'line': '我明天再来。'}]
    assert value['beats'][2]['dialogue'] == []
    errors = validate_script_scene_output(story, plan, value, source_text=source)
    assert not any(e['type'] in {'script_dialogue_omission', 'dialogue_source_order_mismatch'} for e in errors)


def test_script_v10_moves_model_copied_mandatory_dialogue_back_to_correct_beat():
    source = '甲整理工具。\n乙说：“稍后见。”\n甲关门。'
    story = {
        'characters': [
            {'character_id': 'char_001', 'canonical_name': '甲', 'aliases': [], 'role_type': 'main'},
            {'character_id': 'char_002', 'canonical_name': '乙', 'aliases': [], 'role_type': 'supporting'},
        ],
        'scenes': [{'scene_id': 'scene_001', 'canonical_name': '店内'}],
        'props': [], 'narrative_contexts': [],
    }
    plan = {
        'scene_id': 'SC001', 'context_ref': '', 'location_ref': 'scene_001',
        'character_refs': ['char_001', 'char_002'], 'prop_refs': [],
        'source_refs': ['SRC0001', 'SRC0002', 'SRC0003'],
        'beat_list': [
            {'beat_id': 'B001', 'source_refs': ['SRC0001'], 'description': '甲整理工具。', 'type': 'action'},
            {'beat_id': 'B002', 'source_refs': ['SRC0002'], 'description': '乙告别。', 'type': 'dialogue'},
            {'beat_id': 'B003', 'source_refs': ['SRC0003'], 'description': '甲关门。', 'type': 'action'},
        ],
    }
    candidate = {
        'scene_heading': '店内', 'scene_description': '两人在店里。',
        'beats': [
            {'description': '甲整理工具。', 'dialogue': [], 'narration': []},
            {'description': '乙告别。', 'dialogue': [], 'narration': []},
            {'description': '甲关门。', 'dialogue': [{'character_id': 'char_002', 'line': '稍后见。'}], 'narration': []},
        ],
    }
    value, _ = canonicalize_script_scene(plan, candidate, source_text=source, story_bible=story)
    assert value['beats'][1]['dialogue'] == [{'character_id': 'char_002', 'line': '稍后见。'}]
    assert value['beats'][2]['dialogue'] == []
    errors = validate_script_scene_output(story, plan, value, source_text=source)
    assert not any(e['type'] in {'dialogue_not_in_beat_source', 'dialogue_source_order_mismatch', 'script_dialogue_omission'} for e in errors)


def test_script_v10_does_not_project_unbound_quoted_candidate():
    source = '甲想起旧事。\n“朋友，替我保管。”\n甲沉默。'
    story = {
        'characters': [{'character_id': 'char_001', 'canonical_name': '甲', 'aliases': [], 'role_type': 'main'}],
        'scenes': [{'scene_id': 'scene_001', 'canonical_name': '店内'}],
        'props': [], 'narrative_contexts': [],
    }
    plan = {
        'scene_id': 'SC001', 'context_ref': '', 'location_ref': 'scene_001',
        'character_refs': ['char_001'], 'prop_refs': [],
        'source_refs': ['SRC0001', 'SRC0002', 'SRC0003'],
        'beat_list': [
            {'beat_id': 'B001', 'source_refs': ['SRC0001', 'SRC0002', 'SRC0003'], 'description': '甲想起旧事后沉默。', 'type': 'memory'},
        ],
    }
    candidate = {
        'scene_heading': '店内', 'scene_description': '甲想起旧事。',
        'beats': [{'description': '甲想起旧事后沉默。', 'dialogue': [], 'narration': []}],
    }
    value, _ = canonicalize_script_scene(plan, candidate, source_text=source, story_bible=story)
    assert value['beats'][0]['dialogue'] == []


def test_script_v10_moves_unique_selected_source_dialogue_to_its_source_beat_without_guessing_speaker():
    source = '甲整理工具。\n“明天还来吗？”\n甲关门。'
    story = {
        'characters': [{'character_id': 'char_001', 'canonical_name': '甲', 'aliases': [], 'role_type': 'main'}],
        'scenes': [{'scene_id': 'scene_001', 'canonical_name': '店内'}],
        'props': [], 'narrative_contexts': [],
    }
    plan = {
        'scene_id': 'SC001', 'context_ref': '', 'location_ref': 'scene_001',
        'character_refs': ['char_001'], 'prop_refs': [],
        'source_refs': ['SRC0001', 'SRC0002', 'SRC0003'],
        'beat_list': [
            {'beat_id': 'B001', 'source_refs': ['SRC0001'], 'description': '甲整理工具。', 'type': 'action'},
            {'beat_id': 'B002', 'source_refs': ['SRC0002'], 'description': '出现一句询问。', 'type': 'dialogue'},
            {'beat_id': 'B003', 'source_refs': ['SRC0003'], 'description': '甲关门。', 'type': 'action'},
        ],
    }
    candidate = {
        'scene_heading': '店内', 'scene_description': '店内。',
        'beats': [
            {'description': '甲整理工具。', 'dialogue': [], 'narration': []},
            {'description': '出现一句询问。', 'dialogue': [], 'narration': []},
            {'description': '甲关门。', 'dialogue': [{'character_id': 'char_001', 'line': '明天还来吗？'}], 'narration': []},
        ],
    }
    value, _ = canonicalize_script_scene(plan, candidate, source_text=source, story_bible=story)
    assert value['beats'][1]['dialogue'] == [{'character_id': 'char_001', 'line': '明天还来吗？'}]
    assert value['beats'][2]['dialogue'] == []


def test_script_v12_has_no_second_heading_authority_or_posthoc_heading_filter():
    source = '项目名\n\n甲整理工具。'
    story = {
        'characters': [{'character_id': 'char_001', 'canonical_name': '甲', 'aliases': [], 'role_type': 'main'}],
        'scenes': [{'scene_id': 'scene_001', 'canonical_name': '店内'}],
        'props': [], 'narrative_contexts': [],
    }
    plan = {
        'scene_id': 'SC001', 'context_ref': '', 'location_ref': 'scene_001',
        'character_refs': ['char_001'], 'prop_refs': [],
        'source_refs': ['SRC0002'],
        'beat_list': [
            {'beat_id': 'B001', 'source_refs': ['SRC0002'], 'description': '甲整理工具。', 'type': 'action'},
        ],
    }
    payload = build_script_scene_payload(source, story, plan, unit_id='script:SC001')
    assert 'source_metadata' not in payload
    assert payload['scene_source_text'].strip() == '甲整理工具。'

    # Script no longer owns heading detection. If an upstream caller illegally injects
    # heading narration, canonicalization must not silently delete it here.
    candidate = {
        'scene_heading': '店内', 'scene_description': '甲整理工具。',
        'beats': [{'description': '甲整理工具。', 'dialogue': [], 'narration': ['项目名']}],
    }
    value, _ = canonicalize_script_scene(plan, candidate, source_text=source, story_bible=story)
    assert value['beats'][0]['narration'] == ['项目名']
