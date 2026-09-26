from pathlib import Path

WEB = Path(__file__).resolve().parents[2] / "apps" / "web"


def test_web_workspace_exposes_all_v13_result_sections():
    html = (WEB / "index.html").read_text(encoding="utf-8")
    for label in ["总览", "剧本", "人物提示词", "场景提示词", "分镜提示词", "生产设计", "导演与状态", "校验与日志"]:
        assert label in html


def test_web_client_calls_only_v13_run_api_and_has_no_legacy_prompt_fields():
    js = (WEB / "app.js").read_text(encoding="utf-8")
    assert "/api/runs" in js
    assert "character_prompts" in js
    assert "scene_prompts" in js
    assert "shot_prompts" in js
    assert "image_prompt" not in js
    assert "video_prompt" not in js


def test_web_overview_surfaces_validation_repair_count():
    js = (WEB / "app.js").read_text(encoding="utf-8")
    assert "repair_count" in js
    assert "模型修复" in js
    assert "仍未通过" in js
    assert "确定性纠正" in js


def test_web_displays_runtime_backend_version_and_address():
    html = (WEB / "index.html").read_text(encoding="utf-8")
    js = (WEB / "app.js").read_text(encoding="utf-8")
    assert "backendVersionText" in html
    assert "backendAddressText" in html
    assert "/api/health" in js
    assert "state.health.version" in js


def test_web_stage1a_localizes_user_visible_labels():
    html = (WEB / "index.html").read_text(encoding="utf-8")
    js = (WEB / "app.js").read_text(encoding="utf-8")

    for label in [
        "提示词工坊", "运行引擎 2.1 小说生产工作台", "开始", "运行中", "结果工作区",
        "人物提示词", "场景提示词", "分镜提示词", "接口密钥", "模型 / 接口编号", "接口地址",
    ]:
        assert label in html

    for label in [
        "场景规划", "剧情节拍", "本镜实际取用信息", "已解析资产引用", "提示词来源分段",
        "故事设定", "全局视觉风格", "人物视觉资产", "场景视觉资产", "导演执行",
        "镜头开始状态", "镜头结束状态", "本镜状态变化", "编译警告", "编译失败",
        "恢复摘要", "数量统计", "运行错误", "复制提示词",
    ]:
        assert label in js

    forbidden = [
        "Start", "Running", "Result Workspace", "人物 Prompt", "场景 Prompt", "分镜 Prompt",
        "Scene Plan", "Prompt Provenance / Segments", "Consumption View", "Resolved Refs",
        "Story Bible", "Style Guide · Locked", "PVB · Locked", "PSB · Locked", "Director Execution",
        "Compiler Warnings", "Compiler Failures", "Recovery Summary", "details('Counts'", "Run Error",
        "复制 Prompt", "Model / Endpoint ID", "Base URL",
    ]
    combined = html + "\n" + js
    for label in forbidden:
        assert label not in combined


def test_web_stage1a_humanizes_run_and_unit_statuses():
    js = (WEB / "app.js").read_text(encoding="utf-8")
    assert "function statusLabel" in js
    for raw, localized in [
        ("pending", "等待执行"),
        ("running", "正在执行"),
        ("completed", "已完成"),
        ("paused", "已暂停"),
        ("failed", "执行失败"),
        ("failed_recoverable", "执行失败，可点击重试"),
    ]:
        assert raw in js
        assert localized in js
    assert "repair ${unit.repair_count}" not in js
    assert ">checkpoint<" not in js
    assert ">Unit：" not in js


def test_web_stage1a_localizes_remaining_static_technical_display_text():
    html = (WEB / "index.html").read_text(encoding="utf-8")
    js = (WEB / "app.js").read_text(encoding="utf-8")
    combined = html + "\n" + js

    for old in [
        "Key 仅保存在本机 .env",
        "DeepSeek 长 JSON",
        "最大生成 Token",
        "candidate → locked",
        "`${shot.duration}s`",
    ]:
        assert old not in combined

    for helper in [
        "function frameworkLabel",
        "function shotSizeLabel",
        "function cameraLabel",
        "function movementLabel",
        "function focusTypeLabel",
        "function unitLabel",
    ]:
        assert helper in js

    for localized in [
        "密钥仅保存在本机环境配置文件",
        "深度求索模型长结构化结果",
        "最大生成令牌数",
        "候选 → 锁定",
        "秒",
    ]:
        assert localized in combined


def test_compile_failure_recovery_hint_is_not_mislabeled_as_quota_issue():
    text = (WEB / 'app.js').read_text(encoding='utf-8')
    assert '恢复：需修复生产契约/源码后重新编译' in text
    assert "String(run.error.failure_kind || '').startsWith('compile_')" in text
