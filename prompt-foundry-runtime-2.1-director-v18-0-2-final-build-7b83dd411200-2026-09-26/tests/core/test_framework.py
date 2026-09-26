from __future__ import annotations
import copy, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from prompt_foundry_v1_3 import (
    validate_storyboard_director_v1_3a,
    build_storyboard_shot_specs_v1_3,
    validate_pvb_optional_semantics_v1_3d,
    compile_project_v1_3,
    evaluate_v1_3_static,
)
from prompt_foundry_v1_3.asset_compilers import resolve_scene_visuals


def fixture():
    sb = {
        "characters": [{"character_id":"char_001","canonical_name":"角色A","role_type":"main","identity_lock":{},"visual_lock":{"face":"清晰可识别的自然面部"}}],
        "scenes": [{"scene_id":"scene_001","canonical_name":"室内空间","name":"室内空间","time":"日间","visual_lock":{}}],
        "props": [{"prop_id":"prop_001","canonical_name":"道具A","name":"道具A","visual_presence":"present","visual_asset_required":True}],
        "narrative_contexts": [],
    }
    pvb = {"characters":[{"character_id":"char_001","visual_identity":{
        "age_appearance":{"value":"成年","source":"production_design","status":"locked"},
        "face":{"value":"","source":"","status":"skipped"},
        "hair":{"value":"黑色短发","source":"production_design","status":"locked"},
        "body":{"value":"自然体态","source":"production_design","status":"locked"},
        "skin":{"value":"自然肤色","source":"production_design","status":"locked"}},
        "wardrobe":{
        "default":{"value":"简洁日常服装","source":"production_design","status":"locked"},
        "outerwear":{"value":"","source":"production_design","status":"candidate"},
        "shirt":{"value":"","source":"production_design","status":"candidate"},
        "footwear":{"value":"简洁鞋履","source":"production_design","status":"locked"},
        "accessory":{"value":"","source":"","status":"optional_absent"}},"status":"locked","version":1}]}
    psb = {"scenes":[{"scene_id":"scene_001","production_visual":{
        "space":{"value":"尺度适中的室内空间","source":"production_design","status":"locked"},
        "layout":{"value":"主体活动区清晰","source":"production_design","status":"locked"},
        "materials":{"value":"真实常见材质","source":"production_design","status":"locked"},
        "lighting":{"value":"自然日间光","source":"production_design","status":"locked"},
        "color":{"value":"低饱和自然色","source":"production_design","status":"locked"},
        "environment":{"value":"生活化使用状态","source":"production_design","status":"locked"}},"status":"locked","version":1}]}
    style = {k:{"value":v,"source":"production_design","status":"locked"} for k,v in {
        "era":"当代","region":"","genre":"现实主义","tone":"克制写实","visual_reference":"真实摄影质感"}.items()}
    script = {"scenes":[{"scene_id":"SC001","context_ref":"","location_ref":"scene_001","beats":[{"beat_id":"B001","description":"角色A保持在室内空间。","dialogue":[]}]}]}
    storyboard = {"scenes":[{"scene_id":"SC001","context_ref":"","location_ref":"scene_001","shots":[{
        "shot_id":"SH001","scene_id":"SC001","beat_id":"B001","character_refs":["char_001"],"prop_refs":["prop_001"],
        "shot_size":"medium","camera":"eye_level","movement":"static","composition":"角色A位于画面中部。","duration":5.0,
        "description":"角色A保持在室内空间。","dialogue":[],"continuity":{"continuous_with_previous":False,"axis_side":"neutral","eyeline_match":"not_applicable"},"source_evidence":[],
        "director":{"dramatic_intent":"呈现角色A当前可见状态。","primary_subject_refs":["char_001"],"speaker_target_refs":[],"reaction_target_refs":[],
        "performance_actions":[{"character_ref":"char_001","action":"保持站立。","transformation_type":"visible_state_expression","dependency_tags":["upper_body"],"source_evidence":[{"quote":"角色A保持在室内空间。"}]}],
        "visual_focus":{"focus_type":"character","subject_refs":["char_001"],"body_regions":{"char_001":["upper_body"]},"prop_refs":[],"environment_keys":[]},
        "action_delta":{"characters":{},"props":{},"environment":{}},"state_out":{"characters":{},"props":{},"environment":{}},"continuity_scope":{"mode":"reset"}}
    }]}]}
    return sb,pvb,psb,style,script,storyboard


class FrozenFrameworkTests(unittest.TestCase):
    def test_end_to_end_static_framework(self):
        sb,pvb,psb,style,script,storyboard = fixture()
        self.assertTrue(validate_storyboard_director_v1_3a(sb,script,storyboard)["passed"])
        self.assertTrue(validate_pvb_optional_semantics_v1_3d(sb,pvb)["passed"])
        specs = build_storyboard_shot_specs_v1_3(storyboard)
        compiled = compile_project_v1_3("template_project", sb,pvb,psb,style,specs,"production")
        self.assertEqual(compiled["compile_failures"], [])
        result = evaluate_v1_3_static(sb,script,storyboard,specs,compiled)
        self.assertTrue(result["passed"], result)
        self.assertEqual(len(compiled["character_prompts"]),1)
        self.assertEqual(len(compiled["scene_prompts"]),1)
        self.assertEqual(len(compiled["shot_prompts"]),1)

    def test_scene_authority_collision_story_wins(self):
        sb,pvb,psb,style,script,storyboard = fixture()
        sb["scenes"][0]["visual_lock"]["lighting"] = "故事硬事实光线"
        psb["scenes"][0]["production_visual"]["lighting"] = {"value":"生产设计光线","source":"production_design","status":"locked"}
        resolved = resolve_scene_visuals(sb,psb,"scene_001","production")
        self.assertEqual(resolved.get("story.lighting"),"故事硬事实光线")
        self.assertNotIn("lighting", resolved)

    def test_scene_psb_lighting_survives_without_story_collision(self):
        sb,pvb,psb,style,script,storyboard = fixture()
        resolved = resolve_scene_visuals(sb,psb,"scene_001","production")
        self.assertEqual(resolved.get("lighting"),"自然日间光")

if __name__ == "__main__":
    unittest.main(verbosity=2)
