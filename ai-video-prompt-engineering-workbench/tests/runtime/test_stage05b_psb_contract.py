from __future__ import annotations

import pytest

from runtime.stages.psb import (
    CONTRACT_VERSION,
    SYSTEM_PROMPT,
    build_psb_scene_payload,
    canonicalize_psb_scene,
    validate_psb_scene_candidate,
    validate_psb_scene_model_output,
)


def _story_scene() -> dict:
    return {
        "scene_id": "scene_001",
        "canonical_name": "旧公寓客厅",
        "visual_lock": {"lighting": "窗外自然光"},
    }


def _draft() -> dict:
    return {
        "production_visual": {
            "space": "狭长的小客厅",
            "layout": "沙发靠墙，茶几居中",
            "materials": "旧木地板与布艺沙发",
            "lighting": "模型不应覆盖的暖黄灯",
            "color": "低饱和灰褐色",
            "environment": "生活痕迹自然，空间略显拥挤",
        }
    }


def test_psb_payload_exposes_values_only_and_program_owns_metadata():
    payload = build_psb_scene_payload(_story_scene(), unit_id="psb:scene_001")
    assert payload["contract_version"] == CONTRACT_VERSION
    scene = payload["output_template"]["scene"]
    assert set(scene) == {"production_visual"}
    assert all(isinstance(value, str) for value in scene["production_visual"].values())
    assert payload["field_policy"]["story_owned_fields"] == ["lighting"]
    assert payload["output_contract"]["program_owned_fields"] == [
        "scene_id", "canonical_leaf.source", "canonical_leaf.status", "status", "version"
    ]
    assert "不要输出 scene_id/source/status/version" in SYSTEM_PROMPT


def test_psb_canonicalizer_builds_candidate_and_suppresses_story_owned_fields():
    value, changes = canonicalize_psb_scene(_story_scene(), _draft())
    assert changes > 0
    assert value["scene_id"] == "scene_001"
    assert value["status"] == "candidate"
    assert value["version"] == 1
    assert value["production_visual"]["lighting"] == {"value": "", "source": "", "status": "skipped"}
    assert value["production_visual"]["space"] == {
        "value": "狭长的小客厅", "source": "production_design", "status": "candidate"
    }
    assert validate_psb_scene_candidate(_story_scene(), value) == []


def test_psb_model_output_rejects_unknown_fields_non_string_and_blank_non_owned_values():
    value = _draft()
    value["camera"] = "eye_level"
    value["production_visual"]["materials"] = ["木", "布"]
    value["production_visual"]["space"] = "   "
    value["production_visual"]["weather"] = "晴"
    errors = validate_psb_scene_model_output(value, _story_scene())
    kinds = {e["type"] for e in errors}
    assert "extra_psb_model_field" in kinds
    assert "invalid_psb_model_value" in kinds
    assert "blank_psb_candidate_value" in kinds


def test_psb_legacy_model_metadata_is_discarded_and_runtime_rebuilds_authority():
    def leaf(value, source="other", status="locked"):
        return {"value": value, "source": source, "status": status}
    legacy = {
        "scene_id": "scene_wrong",
        "production_visual": {
            "space": leaf("狭长的小客厅"),
            "layout": leaf("沙发靠墙，茶几居中"),
            "materials": leaf("旧木地板与布艺沙发"),
            "lighting": leaf("模型覆盖光线"),
            "color": leaf("低饱和灰褐色"),
            "environment": leaf("生活痕迹自然"),
        },
        "status": "locked",
        "version": 99,
    }
    assert validate_psb_scene_model_output(legacy, _story_scene()) == []
    canonical, _ = canonicalize_psb_scene(_story_scene(), legacy)
    assert canonical["scene_id"] == "scene_001"
    assert canonical["status"] == "candidate"
    assert canonical["version"] == 1
    assert canonical["production_visual"]["lighting"] == {"value": "", "source": "", "status": "skipped"}
    assert canonical["production_visual"]["space"]["status"] == "candidate"
    assert canonical["production_visual"]["space"]["source"] == "production_design"


def test_psb_candidate_rejects_metadata_tampering_or_extra_fields():
    value, _ = canonicalize_psb_scene(_story_scene(), _draft())
    value["production_visual"]["space"]["status"] = "locked"
    value["production_visual"]["color"]["source"] = "model"
    value["debug"] = True
    errors = validate_psb_scene_candidate(_story_scene(), value)
    kinds = {e["type"] for e in errors}
    assert "invalid_psb_candidate_metadata" in kinds
    assert "extra_psb_candidate_field" in kinds


def test_runtime_wires_values_only_psb_without_repair_and_preserves_story_authority(tmp_path):
    import copy
    from app.store import RunStore
    from runtime.checkpoints import CheckpointStore
    from runtime.orchestrator import RuntimeV20
    from tests.runtime.test_runtime20_unitization import MultiUnitModel

    class ValuesOnlyPSBModel(MultiUnitModel):
        def generate_json(self, stage, system_prompt, payload):
            result = super().generate_json(stage, system_prompt, payload)
            if stage == "story_bible":
                result = copy.deepcopy(result)
                result["scenes"][0]["visual_lock"] = {"lighting": "窗外自然光"}
                result["scenes"][0]["source_evidence"] = [{"source_refs": ["SRC0001"], "supports": ["visual_lock.lighting"]}]
                return result
            if stage == "psb_scene":
                return {
                    "scene": {
                        "production_visual": {
                            "space": "狭长室内空间",
                            "layout": "主要家具沿墙布置",
                            "materials": "旧木地板与普通墙面",
                            "lighting": "模型不应覆盖的灯光",
                            "color": "低饱和中性色",
                            "environment": "真实居住痕迹",
                        }
                    }
                }
            return result

    model = ValuesOnlyPSBModel()
    run = RuntimeV20(
        model=model,
        store=RunStore(tmp_path / "runs"),
        checkpoints=CheckpointStore(tmp_path / "checkpoints"),
    ).start("甲在房间，窗外自然光照进来。乙在走廊。", "PSB Stage05B wiring")

    assert run["status"] == "completed"
    candidate = next(x for x in run["artifacts"]["psb_candidate"]["scenes"] if x["scene_id"] == "scene_001")
    assert candidate["production_visual"]["lighting"] == {"value": "", "source": "", "status": "skipped"}
    assert candidate["production_visual"]["space"] == {
        "value": "狭长室内空间", "source": "production_design", "status": "candidate"
    }
    assert run["units"]["psb:scene_001"]["repair_count"] == 0


def test_psb_contract_authorizes_conservative_design_for_non_story_owned_fields():
    payload = build_psb_scene_payload(_story_scene(), unit_id="psb:scene_001")
    assert payload["contract_version"] == "psb_scene.v5"
    policy = payload["output_contract"]["candidate_value_policy"]
    assert "authorized production-design space" in policy
    assert "conservative non-story-changing inference" in policy
    assert payload["field_policy"]["required_nonempty_paths"]
    assert "required_nonempty_paths" in SYSTEM_PROMPT
    assert "生产设计补全不是新增剧情事实" in SYSTEM_PROMPT


def test_runtime_repairs_blank_psb_fields_by_filling_only_missing_production_design(tmp_path):
    import copy
    from app.store import RunStore
    from runtime.checkpoints import CheckpointStore
    from runtime.orchestrator import RuntimeV20
    from tests.runtime.test_runtime20_unitization import MultiUnitModel

    class BlankThenRepairPSBModel(MultiUnitModel):
        def generate_json(self, stage, system_prompt, payload):
            if stage != "psb_scene":
                return super().generate_json(stage, system_prompt, payload)

            sid = payload["story_scene"]["scene_id"]
            repair = payload.get("repair_instruction") or {}
            if sid == "scene_002" and not repair:
                return {
                    "scene": {
                        "production_visual": {
                            "space": "狭长过渡空间",
                            "layout": "",
                            "materials": "",
                            "lighting": "均匀环境光",
                            "color": "",
                            "environment": "日常使用状态",
                        }
                    }
                }
            if sid == "scene_002" and repair:
                error_paths = {str(e.get("path") or "") for e in repair.get("validation_errors") or []}
                expected_paths = {
                    "scene.production_visual.layout",
                    "scene.production_visual.materials",
                    "scene.production_visual.color",
                }
                assert error_paths == expected_paths
                assert set(repair.get("repair_targets") or []) == expected_paths
                assert set(repair.get("must_be_nonempty_paths") or []) == expected_paths
                assert repair.get("must_change_targeted_fields") is True
                assert repair.get("preserve_other_valid_fields") is True
                assert "output_template" not in payload
                assert "TARGETED REPAIR EXECUTION CONTRACT" in system_prompt
                invalid = copy.deepcopy((repair.get("invalid_output") or {}).get("scene") or repair.get("invalid_output") or {})
                production = copy.deepcopy(invalid.get("production_visual") or {})
                production["layout"] = "沿通行动线保持简洁布置"
                production["materials"] = "常规耐用墙地面材质"
                production["color"] = "低干扰中性色"
                return {"scene": {"production_visual": production}}
            return super().generate_json(stage, system_prompt, payload)

    model = BlankThenRepairPSBModel()
    run = RuntimeV20(
        model=model,
        store=RunStore(tmp_path / "runs"),
        checkpoints=CheckpointStore(tmp_path / "checkpoints"),
    ).start("甲在房间。乙在走廊。", "PSB blank repair")

    assert run["status"] == "completed"
    unit = run["units"]["psb:scene_002"]
    assert unit["repair_count"] == 1
    scene = next(x for x in run["artifacts"]["psb_candidate"]["scenes"] if x["scene_id"] == "scene_002")
    assert scene["production_visual"]["layout"]["value"] == "沿通行动线保持简洁布置"
    assert scene["production_visual"]["materials"]["value"] == "常规耐用墙地面材质"
    assert scene["production_visual"]["color"]["value"] == "低干扰中性色"
    assert scene["production_visual"]["space"]["value"] == "狭长过渡空间"
    assert scene["production_visual"]["lighting"]["value"] == "均匀环境光"
    assert scene["production_visual"]["environment"]["value"] == "日常使用状态"
