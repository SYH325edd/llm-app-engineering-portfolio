from runtime.storyboard_overload_feedback import analyze_shot_overload, build_storyboard_overload_feedback


def _scene(*, dialogue=None, narration=None):
    return {
        "scene_id": "SC001",
        "beats": [{
            "beat_id": "B001",
            "dialogue": dialogue or [],
            "narration": narration or [],
        }],
    }


def _shot(*, duration, dialogue=None, narration=None, dialogue_refs=None, narration_refs=None):
    return {
        "shot_id": "SH001",
        "scene_id": "SC001",
        "beat_id": "B001",
        "duration": duration,
        "movement": "static",
        "dialogue": dialogue or [],
        "narration": narration or [],
        "frozen_text_unit_refs": {
            "dialogue": dialogue_refs or [],
            "narration": narration_refs or [],
        },
        "director": {"performance_actions": []},
    }


def test_overloaded_narration_exposes_only_existing_frozen_boundaries():
    scene = _scene(narration=["第一句很长很长很长很长很长。第二句也很长很长很长很长很长。"])
    shot = _shot(
        duration=2.0,
        narration=["第一句很长很长很长很长很长。", "第二句也很长很长很长很长很长。"],
        narration_refs=["FTU_B001_N001", "FTU_B001_N002"],
    )
    result = analyze_shot_overload(shot, scene)
    assert result["classification"] == "overloaded"
    assert result["resolution"]["status"] == "splittable_at_existing_unit_boundaries"
    segments = result["resolution"]["candidate_segments"]
    assert [x["unit_refs"] for x in segments] == [["FTU_B001_N001"], ["FTU_B001_N002"]]


def test_long_dialogue_exposes_sentence_level_frozen_split_boundaries():
    line = "第一句很长很长很长很长。第二句也很长很长很长很长。"
    scene = _scene(dialogue=[{"character_id": "char_001", "line": line}])
    shot = _shot(
        duration=2.0,
        dialogue=[
            {"character_id": "char_001", "line": "第一句很长很长很长很长。"},
            {"character_id": "char_001", "line": "第二句也很长很长很长很长。"},
        ],
        dialogue_refs=["FTU_B001_D001", "FTU_B001_D002"],
    )
    result = analyze_shot_overload(shot, scene)
    assert result["classification"] == "overloaded"
    assert result["resolution"]["status"] == "splittable_at_existing_unit_boundaries"
    assert [x["unit_refs"] for x in result["resolution"]["candidate_segments"]] == [
        ["FTU_B001_D001"], ["FTU_B001_D002"]
    ]


def test_shadow_feedback_never_mutates_storyboard_or_duration():
    scene = _scene(narration=["第一句很长很长很长很长。第二句也很长很长很长很长。"])
    shot = _shot(
        duration=2.0,
        narration=["第一句很长很长很长很长。", "第二句也很长很长很长很长。"],
        narration_refs=["FTU_B001_N001", "FTU_B001_N002"],
    )
    run = {
        "run_id": "run_test",
        "build_id": "build_test",
        "artifacts": {"script": {"scenes": [scene]}, "shot_specs": [shot]},
    }
    result = build_storyboard_overload_feedback(run)
    assert result["mode"] == "shadow_only"
    assert result["automatic_storyboard_mutation"] is False
    assert result["automatic_duration_change"] is False
    assert shot["duration"] == 2.0
    assert shot["frozen_text_unit_refs"]["narration"] == ["FTU_B001_N001", "FTU_B001_N002"]


def test_key_style_long_dialogue_overload_exposes_four_existing_safe_boundaries():
    line = "九几年，我在这修鞋。有个小伙子，天天路过。后来他租了我隔壁的门面，开杂货铺。我俩常一起吃饭。"
    scene = _scene(dialogue=[{"character_id": "char_001", "line": line}])
    shot = _shot(
        duration=3.0,
        dialogue=[
            {"character_id": "char_001", "line": "九几年，我在这修鞋。"},
            {"character_id": "char_001", "line": "有个小伙子，天天路过。"},
            {"character_id": "char_001", "line": "后来他租了我隔壁的门面，开杂货铺。"},
            {"character_id": "char_001", "line": "我俩常一起吃饭。"},
        ],
        dialogue_refs=[
            "FTU_B001_D001",
            "FTU_B001_D002",
            "FTU_B001_D003",
            "FTU_B001_D004",
        ],
    )
    result = analyze_shot_overload(shot, scene)
    assert result["classification"] == "overloaded"
    assert result["resolution"]["status"] == "splittable_at_existing_unit_boundaries"
    assert [segment["unit_refs"] for segment in result["resolution"]["candidate_segments"]] == [
        ["FTU_B001_D001"],
        ["FTU_B001_D002"],
        ["FTU_B001_D003"],
        ["FTU_B001_D004"],
    ]
