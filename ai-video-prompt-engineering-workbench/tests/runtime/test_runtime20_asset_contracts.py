from __future__ import annotations

import copy

from app.store import RunStore
from runtime.checkpoints import CheckpointStore
from runtime.orchestrator import RuntimeV20
from runtime.stages.psb import build_psb_scene_payload
from runtime.stages.pvb import build_pvb_character_payload
from tests.runtime.test_runtime20_unitization import MultiUnitModel


class MissingAssetMetadataModel(MultiUnitModel):
    def __init__(self, *, break_stage: str):
        super().__init__()
        self.break_stage = break_stage

    def generate_json(self, stage, system_prompt, payload):
        result = super().generate_json(stage, system_prompt, payload)
        if stage == 'pvb_character' and self.break_stage == 'pvb':
            char = result['character']
            # Simulate the real failure: canonical leaf objects exist, but the model omits
            # the mechanical source/status metadata on every leaf.
            for section in ('visual_identity', 'wardrobe'):
                for entry in char[section].values():
                    entry.pop('source', None)
                    entry.pop('status', None)
            # Also try to overwrite a Story-Bible-owned field. Runtime must suppress it.
            char['visual_identity']['face']['value'] = '模型擅自设计的脸'
            return result
        if stage == 'psb_scene' and self.break_stage == 'psb':
            scene = result['scene']
            for entry in scene['production_visual'].values():
                entry.pop('source', None)
                entry.pop('status', None)
            return result
        return result


def _runtime(tmp_path, model):
    return RuntimeV20(
        model=model,
        store=RunStore(tmp_path / 'runs'),
        checkpoints=CheckpointStore(tmp_path / 'checkpoints'),
    )


def test_pvb_unit_payload_delegates_metadata_to_runtime_stage05a_contract():
    char = {'character_id': 'char_001', 'role_type': 'main', 'visual_lock': {}}
    payload = build_pvb_character_payload(char, unit_id='pvb:char_001')
    leaf = payload['output_template']['character']['visual_identity']['age_appearance']
    assert leaf == ''
    assert payload['output_contract']['model_leaf_type'] == 'string'
    assert payload['output_contract']['program_owned_fields'] == [
        'character_id', 'canonical_leaf.source', 'canonical_leaf.status', 'status', 'version'
    ]


def test_psb_unit_payload_delegates_metadata_to_runtime_stage05b_contract():
    scene = {'scene_id': 'scene_001', 'visual_lock': {}}
    payload = build_psb_scene_payload(scene, unit_id='psb:scene_001')
    leaf = payload['output_template']['scene']['production_visual']['lighting']
    assert leaf == ''
    assert payload['output_contract']['model_leaf_type'] == 'string'
    assert payload['output_contract']['program_owned_fields'] == [
        'scene_id', 'canonical_leaf.source', 'canonical_leaf.status', 'status', 'version'
    ]


def test_pvb_missing_status_and_source_are_program_owned_and_do_not_pause(tmp_path):
    model = MissingAssetMetadataModel(break_stage='pvb')
    rt = _runtime(tmp_path, model)

    # Add one Story-Bible-owned visual fact so authority suppression is exercised too.
    original = model.generate_json
    def generate(stage, system_prompt, payload):
        result = original(stage, system_prompt, payload)
        if stage == 'story_bible':
            result = copy.deepcopy(result)
            result['characters'][0]['visual_lock'] = {'face': '圆脸'}
            result['characters'][0]['source_evidence'] = [{'source_refs': ['SRC0001'], 'supports': ['explicit_facts[0]', 'visual_lock.face']}]
        return result
    model.generate_json = generate

    run = rt.start('圆脸的甲在房间。乙在走廊。', 'PVB metadata ownership')
    assert run['status'] == 'completed'
    char = next(x for x in run['artifacts']['pvb_candidate']['characters'] if x['character_id'] == 'char_001')

    assert char['visual_identity']['face'] == {'value': '', 'source': '', 'status': 'skipped'}
    assert char['visual_identity']['hair']['status'] == 'candidate'
    assert char['visual_identity']['hair']['source'] == 'production_design'
    assert char['wardrobe']['accessory'] == {'value': '', 'source': '', 'status': 'optional_absent'}
    assert run['units']['pvb:char_001']['repair_count'] == 0


def test_psb_missing_status_and_source_are_program_owned_and_lock_normally(tmp_path):
    model = MissingAssetMetadataModel(break_stage='psb')
    original = model.generate_json
    def generate(stage, system_prompt, payload):
        result = original(stage, system_prompt, payload)
        if stage == 'story_bible':
            result = copy.deepcopy(result)
            result['scenes'][0]['visual_lock'] = {'lighting': '窗外自然光'}
            result['scenes'][0]['source_evidence'] = [{'source_refs': ['SRC0001'], 'supports': ['visual_lock.lighting']}]
        return result
    model.generate_json = generate

    run = _runtime(tmp_path, model).start('甲在房间，窗外自然光照进来。乙在走廊。', 'PSB metadata ownership')
    assert run['status'] == 'completed'

    scene = next(x for x in run['artifacts']['psb']['scenes'] if x['scene_id'] == 'scene_001')
    assert scene['production_visual']['space']['source'] == 'production_design'
    assert scene['production_visual']['space']['status'] == 'locked'
    assert scene['production_visual']['lighting'] == {'value': '', 'source': '', 'status': 'skipped'}
    assert run['units']['psb:scene_001']['repair_count'] == 0
