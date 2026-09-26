from pathlib import Path

WEB = Path(__file__).resolve().parents[2] / "apps" / "web"


def test_stage1b_keeps_user_tabs_primary_and_debug_tabs_in_collapsed_panel():
    html = (WEB / "index.html").read_text(encoding="utf-8")
    assert 'class="tabs primary-tabs"' in html
    for label in ["总览", "生产进度", "剧本", "人物提示词", "场景提示词", "分镜提示词"]:
        assert label in html
    assert '<details id="advancedDebugPanel"' in html
    assert "高级调试区" in html
    assert "生产设计" in html and "导演与状态" in html and "校验与日志" in html
    assert " open" not in html.split('<details id="advancedDebugPanel"', 1)[1].split('>', 1)[0]


def test_stage1b_shot_debug_data_is_collapsed_and_blocked_copy_is_disabled():
    js = (WEB / "app.js").read_text(encoding="utf-8")
    assert "高级调试信息" in js
    assert "compileStatusLabel" in js
    assert "编译已阻断" in js
    assert "复制提示词" in js
    assert "copyButton(prompt, compiled.compile_status === 'blocked')" in js


def test_closing_advanced_debug_panel_restores_primary_view():
    js = (WEB / "app.js").read_text(encoding="utf-8")
    assert "advancedDebugPanel" in js
    assert "debugTabs" in js
    assert "state.activeTab = 'overview'" in js
    assert "advancedDebugPanel.addEventListener('toggle'" in js


def test_asset_prompt_cards_surface_warnings_outside_prompt_body():
    js = (WEB / "app.js").read_text(encoding="utf-8")
    assert "item.warnings" in js
    assert "compile-issue warning" in js



def test_blocked_prompt_ui_shows_source_layer_and_fix_guidance():
    js = (WEB / "app.js").read_text(encoding="utf-8")
    assert "来源层" in js
    assert "建议修复" in js
    assert "suggested_fix" in js
    assert "source_layer_label" in js
