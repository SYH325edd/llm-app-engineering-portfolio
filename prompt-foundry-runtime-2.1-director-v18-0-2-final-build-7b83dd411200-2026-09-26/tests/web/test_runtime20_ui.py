from pathlib import Path

WEB = Path(__file__).resolve().parents[2] / "apps" / "web"


def test_runtime20_web_exposes_progress_resume_retry_without_losing_v13_outputs():
    html = (WEB / "index.html").read_text(encoding="utf-8")
    js = (WEB / "app.js").read_text(encoding="utf-8")
    assert "运行引擎 2.1" in html
    assert "生产进度" in html
    assert "从失败处继续" in js
    assert "/resume" in js
    assert "/retry" in js
    assert "failed_recoverable" in js
    for term in ["character_prompts", "scene_prompts", "shot_prompts", "story_bible", "pvb", "psb", "static_evaluation"]:
        assert term in js
    for label in ["故事设定", "人物视觉资产", "场景视觉资产", "导演执行", "静态校验"]:
        assert label in js


def test_runtime20_web_polls_background_run_and_surfaces_unit_progress():
    js = (WEB / "app.js").read_text(encoding="utf-8")
    assert "pollRun" in js
    assert "current_unit" in js
    assert "completed_units" in js
    assert "total_units" in js
    assert "unit.reused" in js
    assert "已复用检查点" in js
