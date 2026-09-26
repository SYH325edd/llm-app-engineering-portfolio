from __future__ import annotations

from pathlib import Path

from runtime.consumption_compiler import compile_character_consumption_prompt, compile_scene_consumption_prompt
from runtime.consumption_lint import lint_shot

ROOT = Path(__file__).resolve().parents[2]


def test_consumption_runtime_contains_no_story_specific_hardcodes():
    sources = "\n".join(
        path.read_text(encoding="utf-8")
        for path in sorted((ROOT / "runtime").rglob("*.py"))
        if "__pycache__" not in path.parts
    )
    forbidden = [
        "关东煮", "鱼丸", "萝卜", "豆浆", "胶水味", "小板凳", "老周", "年轻人",
        "eating_oden", "biting_daikon", "at_window_seat", "left_wrist_visible",
        "glass_fogged", "being_poured_as_coffee", "coffee_machine",
    ]
    assert not [token for token in forbidden if token in sources]


def test_scene_asset_cleaning_generalizes_to_unrelated_seaside_bookstore():
    story_bible = {
        "scenes": [{
            "scene_id": "scene_bookstore",
            "canonical_name": "海边书店",
            "visual_lock": {
                "space": "临海街角的一层书店",
                "layout": "木质书架靠墙排列；后来门边临时增加了一张折叠桌",
                "materials": "原木书架；磨砂玻璃门",
                "environment": "海盐气味从门口飘进来；两名游客正在低声交谈；墙边书架固定排列",
                "lighting": "傍晚自然光透过玻璃门",
                "color": "日落映照下的青灰与原木色",
            },
        }],
        "characters": [],
        "props": [],
    }
    result = compile_scene_consumption_prompt(story_bible, {"scenes": []}, {}, "scene_bookstore")
    prompt = result["prompt_gpt_image"]
    assert "海盐气味" not in prompt
    assert "游客正在低声交谈" not in prompt
    assert "折叠桌" not in prompt
    assert "傍晚" not in prompt
    assert "日落" not in prompt
    assert "自然光透过玻璃门" in prompt
    assert "青灰与原木色" in prompt
    assert "木质书架靠墙排列" in prompt


def test_character_asset_removes_environment_dependent_appearance_without_story_phrase_rules():
    story_bible = {
        "characters": [{
            "character_id": "char_a",
            "canonical_name": "店主",
            "role_type": "main",
            "visual_lock": {
                "age_appearance": "五十岁左右",
                "face": "眼角细纹在晨光下显得更深",
                "hair": "短发",
                "body": "中等身材",
                "skin": "自然肤色",
            },
        }]
    }
    result = compile_character_consumption_prompt(story_bible, {"characters": []}, {}, "char_a")
    prompt = result["prompt_gpt_image"]
    assert "晨光" not in prompt
    assert "眼角细纹" in prompt


def test_continuity_matching_uses_current_state_and_dependency_tags_not_story_entities():
    story_bible = {
        "characters": [{"character_id": "char_a", "canonical_name": "搬运工"}],
        "props": [{"prop_id": "prop_box", "canonical_name": "木箱", "aliases": []}],
        "scenes": [],
    }
    shot = {
        "shot_id": "SHX01",
        "character_refs": ["char_a"],
        "prop_refs": ["prop_box"],
        "description": "搬运工转头看向仓库门口。",
        "dialogue": [],
        "state_in": {
            "characters": {"char_a": {"position": "仓库门内侧", "held_prop_refs": ["prop_box"]}},
            "props": {"prop_box": {"held_by": "char_a"}},
            "environment": {},
        },
        "director": {
            "primary_subject_refs": ["char_a"],
            "reaction_target_refs": [],
            "speaker_target_refs": [],
            "performance_actions": [{
                "character_ref": "char_a",
                "action": "继续抱着木箱",
                "transformation_type": "visible_state_expression",
                "dependency_tags": ["hands", "prop_interaction"],
                "source_evidence": [{"quote": "上一镜中搬运工抱起木箱"}],
            }],
            "action_delta": {"characters": {}, "props": {}, "environment": {}},
            "visual_focus": {},
        },
    }
    errors, _ = lint_shot(shot, story_bible, {})
    assert "E003_SPATIOTEMPORAL_POLLUTION" not in {e["code"] for e in errors}
