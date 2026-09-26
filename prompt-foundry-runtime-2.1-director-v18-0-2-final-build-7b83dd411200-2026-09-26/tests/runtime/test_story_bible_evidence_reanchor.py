from __future__ import annotations

import copy

from runtime.source_evidence import reanchor_quote_to_source, reanchor_story_bible_evidence
from runtime.stages.story_bible import canonicalize_story_bible, validate_story_bible_output
from tests.runtime.test_stage01_story_bible_contract import _candidate


def test_reanchor_restores_exact_source_span_across_newlines_and_quote_glyphs():
    source = (
        "后来他欠了债。\n半夜跑了。\n"
        "临走把钥匙塞给我，说“周哥，帮我收着，我回来拿”。"
    )
    model_quote = "后来他欠了债。半夜跑了。临走把钥匙塞给我，说‘周哥，帮我收着，我回来拿’。"
    anchored = reanchor_quote_to_source(model_quote, source)
    assert anchored == source
    assert anchored in source


def test_reanchor_restores_exact_source_span_when_model_collapses_paragraph_breaks():
    source = (
        "柜子早烂了。\n\n"
        "九八年那场大雨，房子塌了一半。\n"
        "柜子是我从废墟里刨出来的，里面什么都没有。"
    )
    model_quote = "柜子早烂了。九八年那场大雨，房子塌了一半。柜子是我从废墟里刨出来的，里面什么都没有。"
    anchored = reanchor_quote_to_source(model_quote, source)
    assert anchored == source
    assert anchored in source


def test_reanchor_does_not_accept_semantic_paraphrase_or_ambiguous_match():
    assert reanchor_quote_to_source("后来他欠债后逃跑了。", "后来他欠了债。半夜跑了。") is None
    assert reanchor_quote_to_source("‘同一句话’", "“同一句话”。\n“同一句话”。") is None


def test_story_bible_reanchor_happens_before_exact_evidence_validation():
    source = "阿宁站在窗边。\n老周走进房间。\n桌上有一个“信封”。"
    value = copy.deepcopy(_candidate())
    value["characters"][0]["source_evidence"] = [{"quote": "阿宁站在窗边。"}]
    value["characters"][1]["source_evidence"] = [{"quote": "老周走进房间。"}]
    value["scenes"][0]["source_evidence"] = [{"quote": "房间"}]
    value["props"][0]["source_evidence"] = [{"quote": "桌上有一个‘信封’。"}]
    value["narrative_contexts"] = []

    normalized, _ = canonicalize_story_bible(value, run_id="run_reanchor")
    normalized, changes = reanchor_story_bible_evidence(normalized, source_text=source)

    assert changes == 1
    assert normalized["props"][0]["source_evidence"][0]["quote"] == "桌上有一个“信封”。"
    assert validate_story_bible_output(normalized, source_text=source) == []


def test_runtime_mechanically_reanchors_representation_only_story_bible_evidence_without_model_repair(tmp_path):
    from app.store import RunStore
    from runtime.checkpoints import CheckpointStore
    from runtime.orchestrator import RuntimeV20
    from tests.api.fixtures.mock_story_run import MockModel

    class RepresentationDriftModel(MockModel):
        def generate_json(self, stage, system_prompt, user_payload):
            value = super().generate_json(stage, system_prompt, user_payload)
            if stage == "story_bible":
                value = copy.deepcopy(value)
                value["characters"][0]["source_evidence"][0]["quote"] = "阿宁 站在窗边"
                value["props"][0]["source_evidence"][0]["quote"] = "手里 拿着信封"
            return value

    model = RepresentationDriftModel()
    runtime = RuntimeV20(
        model=model,
        store=RunStore(tmp_path / "runs"),
        checkpoints=CheckpointStore(tmp_path / "checkpoints"),
    )
    run = runtime.start("阿宁站在窗边，手里拿着信封。", title="evidence reanchor")

    assert run["status"] == "completed"
    assert run["units"]["story_bible"]["repair_count"] == 0
    assert "story_bible_repair" not in model.calls
    story = run["artifacts"]["story_bible"]
    assert story["characters"][0]["source_evidence"][0]["quote"] == "阿宁站在窗边"
    assert story["props"][0]["source_evidence"][0]["quote"] == "手里拿着信封"
