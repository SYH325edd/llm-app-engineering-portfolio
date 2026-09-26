from __future__ import annotations

import copy

RESPONSES = {
    "story_bible": {
        "bible_id": "bible_test",
        "project_id": "project_test",
        "version": 1,
        "characters": [{
            "character_id": "char_001", "canonical_name": "阿宁", "aliases": [], "role_type": "main",
            "explicit_facts": ["阿宁站在窗边"], "inferred_facts": [], "identity_lock": {},
            "visual_lock": {},
            "source_evidence": [{"quote": "阿宁站在窗边", "supports": ["explicit_facts[0]"]}],
        }],
        "scenes": [{
            "scene_id": "scene_001", "canonical_name": "室内窗边", "name": "室内窗边", "time": "白天", "weather": "",
            "explicit_facts": ["阿宁站在窗边"], "visual_lock": {}, "source_evidence": [{"quote": "阿宁站在窗边", "supports": ["explicit_facts[0]"]}],
        }],
        "props": [{
            "prop_id": "prop_001", "canonical_name": "信封", "name": "信封", "aliases": [], "narrative_importance": "medium",
            "visual_presence": "present", "visual_asset_required": True, "explicit_facts": ["阿宁手里拿着信封"],
            "source_evidence": [{"quote": "手里拿着信封", "supports": ["explicit_facts[0]"]}],
        }],
        "narrative_contexts": [],
    },
    "scene_plan": {
        "scenes": [{
            "scene_id": "SC001", "context_ref": "", "context_transition": "continue", "location_ref": "scene_001", "time": "白天",
            "character_refs": ["char_001"], "prop_refs": ["prop_001"], "continuous_with_previous": False,
            "dramatic_goal": "呈现阿宁站在窗边。", "conflict": "", "turning_point": "",
            "beat_list": [{"beat_id": "B001", "source_refs": ["SRC0001"], "description": "阿宁站在窗边，手里拿着信封。", "type": "setup"}],
        }]
    },
    "script": {
        "scenes": [{
            "scene_id": "SC001", "context_ref": "", "location_ref": "scene_001", "scene_heading": "室内窗边 - 白天",
            "scene_description": "阿宁站在窗边。",
            "beats": [{"beat_id": "B001", "description": "阿宁站在窗边，手里拿着信封。", "dialogue": []}],
        }]
    },
    "storyboard_base": {
        "scenes": [{
            "scene_id": "SC001", "context_ref": "", "location_ref": "scene_001",
            "shots": [{
                "shot_id": "SH001", "scene_id": "SC001", "beat_id": "B001", "character_refs": ["char_001"], "prop_refs": ["prop_001"],
                "shot_size": "medium", "camera": "eye_level", "movement": "static", "composition": "阿宁位于画面中部，窗在一侧。",
                "duration": 5.0, "description": "阿宁站在窗边，手里拿着信封。", "dialogue": [],
                "continuity": {"continuous_with_previous": False, "axis_side": "neutral", "eyeline_match": "not_applicable"},
                "source_evidence": [{"quote": "阿宁站在窗边，手里拿着信封。"}],
            }],
        }]
    },
    "director": {
        "scenes": [{
            "scene_id": "SC001", "context_ref": "", "location_ref": "scene_001",
            "shots": [{
                "shot_id": "SH001", "scene_id": "SC001", "beat_id": "B001", "character_refs": ["char_001"], "prop_refs": ["prop_001"],
                "shot_size": "medium", "camera": "eye_level", "movement": "static", "composition": "阿宁位于画面中部，窗在一侧。",
                "duration": 5.0, "description": "阿宁站在窗边，手里拿着信封。", "dialogue": [],
                "continuity": {"continuous_with_previous": False, "axis_side": "neutral", "eyeline_match": "not_applicable"},
                "source_evidence": [{"quote": "阿宁站在窗边，手里拿着信封。"}],
                "director": {
                    "dramatic_intent": "呈现阿宁站在窗边的当前可见状态。",
                    "primary_subject_refs": ["char_001"], "speaker_target_refs": [], "reaction_target_refs": [],
                    "performance_actions": [{
                        "character_ref": "char_001", "action": "保持站在窗边，手里拿着信封。",
                        "transformation_type": "visible_state_expression", "dependency_tags": ["upper_body", "hands", "prop_interaction"],
                        "source_evidence": [{"quote": "阿宁站在窗边，手里拿着信封。"}],
                    }],
                    "performance_logic": [],
                    "performance_execution": [{
                        "character_ref": "char_001",
                        "gaze": "目光停在窗边与手中信封之间",
                        "hands": "双手保持拿着信封的当前动作",
                    }],
                    "dialogue_delivery": [],
                    "visual_target": {"target_type": "character", "character_refs": ["char_001"], "prop_refs": [], "environment_keys": []},
                    "visual_focus": {"focus_type": "character", "subject_refs": ["char_001"], "body_regions": {"char_001": ["upper_body", "hands"]}, "prop_refs": ["prop_001"], "environment_keys": []},
                    "execution_shot_design": {"shot_size": "medium", "camera": "eye_level", "movement": "static"},
                    "action_delta": {"characters": {}, "props": {}, "environment": {}},
                    "state_out": {"characters": {}, "props": {}, "environment": {}},
                    "continuity_scope": {"mode": "reset"},
                },
            }],
        }]
    },
    "pvb": {
        "characters": [{
            "character_id": "char_001",
            "visual_identity": {
                "age_appearance": {"value": "年轻成年女性", "source": "production_design", "status": "candidate"},
                "face": {"value": "自然可识别的成年女性面部", "source": "production_design", "status": "candidate"},
                "hair": {"value": "黑色中长发", "source": "production_design", "status": "candidate"},
                "body": {"value": "自然日常体态", "source": "production_design", "status": "candidate"},
                "skin": {"value": "自然肤色", "source": "production_design", "status": "candidate"},
            },
            "wardrobe": {
                "default": {"value": "简洁日常服装", "source": "production_design", "status": "candidate"},
                "outerwear": {"value": "浅色外套", "source": "production_design", "status": "candidate"},
                "shirt": {"value": "素色上衣", "source": "production_design", "status": "candidate"},
                "footwear": {"value": "平底鞋", "source": "production_design", "status": "candidate"},
                "accessory": {"value": "", "source": "", "status": "optional_absent"},
            },
            "status": "candidate", "version": 1,
        }]
    },
    "psb": {
        "scenes": [{
            "scene_id": "scene_001",
            "production_visual": {
                "space": {"value": "尺度适中的普通室内空间", "source": "production_design", "status": "candidate"},
                "layout": {"value": "窗边留出人物站立区域", "source": "production_design", "status": "candidate"},
                "materials": {"value": "普通墙面与玻璃窗", "source": "production_design", "status": "candidate"},
                "lighting": {"value": "自然日间窗光", "source": "production_design", "status": "candidate"},
                "color": {"value": "低饱和自然色", "source": "production_design", "status": "candidate"},
                "environment": {"value": "安静、生活化", "source": "production_design", "status": "candidate"},
            },
            "status": "candidate", "version": 1,
        }]
    },
    "style_guide": {
        "era": {"value": "当代", "source": "production_design", "status": "candidate"},
        "region": {"value": "中国城市", "source": "production_design", "status": "candidate"},
        "genre": {"value": "现实主义", "source": "production_design", "status": "candidate"},
        "tone": {"value": "克制写实", "source": "production_design", "status": "candidate"},
        "visual_reference": {"value": "真实摄影质感", "source": "production_design", "status": "candidate"},
    },
}


class MockModel:
    def __init__(self):
        self.calls = []

    def generate_json(self, stage, system_prompt, user_payload):
        self.calls.append(stage)
        if stage == "script_scene":
            return {"scene": copy.deepcopy(RESPONSES["script"]["scenes"][0])}
        if stage == "storyboard_scene":
            scene = copy.deepcopy(RESPONSES["storyboard_base"]["scenes"][0])
            frozen = user_payload.get("frozen_text_units") or {}
            first_by_beat = {}
            for shot in scene.get("shots", []) or []:
                beat_id = str(shot.get("beat_id") or "")
                shot.pop("dialogue", None)
                shot.pop("narration", None)
                shot["dialogue_unit_refs"] = []
                shot["narration_unit_refs"] = []
                first_by_beat.setdefault(beat_id, shot)
            for beat_id, group in frozen.items():
                shot = first_by_beat.get(str(beat_id))
                if not shot or not isinstance(group, dict):
                    continue
                shot["dialogue_unit_refs"] = [
                    str(unit.get("unit_id")) for unit in (group.get("dialogue") or [])
                    if isinstance(unit, dict) and unit.get("unit_id")
                ]
                shot["narration_unit_refs"] = [
                    str(unit.get("unit_id")) for unit in (group.get("narration") or [])
                    if isinstance(unit, dict) and unit.get("unit_id")
                ]
            return {"scene": scene}
        if stage == "production_semantics_shot":
            shot = user_payload.get("shot", {}) or {}
            evidence = (user_payload.get("program_owned", {}) or {}).get("current_shot_evidence") or []
            quote = next((str(x).strip() for x in evidence if isinstance(x, str) and str(x).strip()), "")
            description = str(shot.get("description") or "").strip()
            visual_events = []
            if description and quote:
                visual_events.append({
                    "action": description,
                    "character_refs": list(shot.get("character_refs") or []),
                    "prop_refs": list(shot.get("prop_refs") or []),
                    "source_evidence": [{"quote": quote}],
                })
            return {"production_semantics": {
                "visual_events": visual_events,
                "audio_events": [],
                "renderability_status": "renderable",
                "renderability_issues": [],
                "dialogue": [
                    {"character_id": x.get("character_id"), "line": x.get("line"), "offscreen": False}
                    for x in (user_payload.get("shot", {}).get("dialogue") or [])
                ],
                "diegetic_text": [],
                "production_choices": [],
                "appearance_overlays": [],
            }}
        if stage == "director_scene_context":
            program = user_payload.get("program_owned", {}) or {}
            scene_id = str((user_payload.get("scene") or {}).get("scene_id") or "SC001")
            shot_refs = list(program.get("allowed_shot_refs") or [])
            beat_refs = list(program.get("allowed_beat_refs") or [])
            char_refs = list(program.get("allowed_character_refs") or [])
            evidence_refs = list(program.get("allowed_evidence_refs") or [])
            evidence = [copy.deepcopy(evidence_refs[0])] if evidence_refs else []
            emotional_arc = []
            if shot_refs:
                emotional_arc.append({
                    "phase_id": "phase_01", "beat_refs": beat_refs, "shot_refs": shot_refs,
                    "function": "setup", "intensity": "low", "evidence_sources": evidence,
                })
            return {"scene_director_context": {
                "scene_id": scene_id, "contract_version": "director_scene_context.v1_1",
                "dramatic_function": {"summary": "建立当前场景与人物状态。", "evidence_sources": evidence},
                "emotional_arc": emotional_arc,
                "relationship_dynamics": [],
                "reaction_strategy": {"priority": "low", "preferred_reaction_shot_refs": []},
                "camera_strategy": {
                    "stability": "stable", "framing_tendency": "medium_dominant",
                    "movement_policy": "mostly_static",
                },
                "character_performance_baselines": [
                    {
                        "character_ref": ref, "baseline_energy": "restrained",
                        "baseline_control": "controlled", "baseline_social_posture": "guarded",
                    } for ref in char_refs
                ],
                "evidence_sources": evidence,
            }}
        if stage == "director_shot":
            return {"director": copy.deepcopy(RESPONSES["director"]["scenes"][0]["shots"][0]["director"])}
        if stage == "pvb_character":
            return {"character": copy.deepcopy(RESPONSES["pvb"]["characters"][0])}
        if stage == "psb_scene":
            return {"scene": copy.deepcopy(RESPONSES["psb"]["scenes"][0])}
        return copy.deepcopy(RESPONSES[stage])
