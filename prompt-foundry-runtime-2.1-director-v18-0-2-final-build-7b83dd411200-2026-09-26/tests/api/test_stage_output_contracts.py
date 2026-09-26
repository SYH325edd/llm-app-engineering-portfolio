from app.prompts import scene_plan_prompt, stage_payload


def test_scene_plan_prompt_explicitly_requires_json_fields_and_single_context_ref():
    prompt = scene_plan_prompt()
    assert '必须输出顶层字段' in prompt
    assert 'scenes' in prompt
    assert 'scene_id' in prompt
    assert 'context_ref' in prompt
    assert 'beat_list' in prompt
    assert 'beat_id' in prompt
    assert '只能是一个 context_XXX 字符串或空字符串' in prompt
    assert '不得在新 Scene 中从 B001 重新开始' in prompt


def test_scene_plan_payload_includes_machine_readable_output_contract():
    artifacts = {
        'story_bible': {
            'characters': [{'character_id': 'char_001'}],
            'scenes': [{'scene_id': 'scene_001'}],
            'props': [],
            'narrative_contexts': [{'context_id': 'context_001'}],
        }
    }
    payload = stage_payload('scene_plan', source_text='x', artifacts=artifacts)
    contract = payload['output_contract']
    assert contract['required_top_level_fields'] == ['scenes']
    assert contract['required_scene_fields'] == [
        'scene_id', 'context_ref', 'location_ref', 'time', 'character_refs',
        'prop_refs', 'continuous_with_previous', 'dramatic_goal', 'conflict',
        'turning_point', 'beat_list'
    ]
    assert contract['required_beat_fields'] == ['beat_id', 'description', 'type']
    assert contract['context_ref_rule'] == 'exactly one allowed context_ref or empty string'


def test_all_semantic_stages_expose_required_top_level_fields():
    artifacts = {
        'story_bible': {'characters': [], 'scenes': [], 'props': [], 'narrative_contexts': []},
        'scene_plan': {'scenes': []},
        'script': {'scenes': []},
        'storyboard_base': {'scenes': []},
    }
    expected = {
        'story_bible': ['bible_id', 'project_id', 'version', 'characters', 'scenes', 'props', 'narrative_contexts'],
        'scene_plan': ['scenes'],
        'script': ['scenes'],
        'storyboard_base': ['scenes'],
        'director': ['scenes'],
        'pvb': ['characters'],
        'psb': ['scenes'],
        'style_guide': ['era', 'region', 'genre', 'tone', 'visual_reference'],
    }
    for stage, fields in expected.items():
        payload = stage_payload(stage, source_text='x', artifacts=artifacts)
        assert payload['output_contract']['required_top_level_fields'] == fields


def test_storyboard_prompt_requires_exact_per_beat_dialogue_reconstruction():
    from app.prompts import storyboard_base_prompt
    prompt = storyboard_base_prompt()
    assert "按原顺序恰好重建一次" in prompt
    assert "禁止遗漏、重复、改写或换 speaker" in prompt
