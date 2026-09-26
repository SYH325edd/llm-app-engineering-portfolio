from __future__ import annotations

import copy
import re
from typing import Any

from runtime.source_index import build_source_index, refs_to_span, slice_by_scene_refs
from runtime.text_authority import text_is_anchored
from runtime.authority_contract import authority_manifest
from runtime.story_projection import project_character, project_context, project_prop, project_scene


CONTRACT_VERSION = "script_scene.v12"

SOFT_QUALITY_ERROR_TYPES = frozenset({"script_beat_low_source_overlap"})

SYSTEM_PROMPT = """你是 Prompt Foundry Runtime 2.x 的 Stage 3：Script Scene Writer。当前只处理一个 FROZEN-02 Scene Plan Scene。
你的任务是把该 Scene 忠实转换成结构化剧本，不做 Storyboard、Director 或生产设计。

权责边界：
1. 模型负责：scene_heading、scene_description、每个 Beat 的 description、非 mandatory 的原文 dialogue 候选选择，以及需要作为画外旁白保留的 narration 原文片段。程序已能确定 speaker + exact source span 的 mandatory direct dialogue 不再由模型重抄或猜 Beat。
2. 程序负责：scene_id/location_ref/context_ref/beat_id。不要输出 scene_id/location_ref/context_ref/beat_id；即使输出也会被程序覆盖。
3. Beat 数量与顺序必须严格对应输入 Scene Plan 的 beat_list；不得新增、合并、删除或调换 Beat。
4. beat_source_authority 是程序从 Scene Plan Beat.source_refs 精确切出的原文窗口，是每个 Beat 的事实权威；Scene Plan Beat.description 只是结构摘要。两者冲突时必须服从 beat_source_authority。

对白规则：
- dialogue 只允许 {"character_id":"char_XXX","line":"原文逐字对白"}。
- character_id 必须来自 allowed_dialogue_speakers/current Scene character refs；角色叙事等级不等于对白权限，background 角色若原文确实说话可以保留对白。
- line 必须逐字来自 scene_source_text（当前 Scene 的唯一原文范围），不得润色、改写、补写、翻译或借用其他 Scene 的对白。
- dialogue 必须保持当前 Scene 原文出现顺序。source_dialogue_inventory 是程序从当前 Scene 原文生成的候选对白清单。required=true 且带 speaker_ref 的条目属于程序冻结的 mandatory direct dialogue：Runtime 会按 source span 自动投影到正确 Beat，模型无需重抄，也不要主动移动或改写。仅能确定“这是引号/被引用的话”、但无法确定当前场景 speaker/delivery 的条目 required=false，不得因为模型没有把它作为当前直接对白而判 omission；它仍可在上下文足够时由模型选择为 dialogue。若 inventory 提供 speaker_ref，该 speaker_ref 是硬绑定，不得换 speaker。
- 不要输出 character_name/source_evidence；角色名由程序根据 Story Bible 解析，line 本身就是逐字证据。

旁白规则：
- narration 是当前 Beat 需要保留为画外旁白的原文片段数组；没有旁白用 []。
- narration 每一项必须是 scene_source_text 中逐字连续子串，禁止润色、补写、翻译或把对白复制为旁白。
- narration 是否采用属于剧本转换层选择，不要求把所有叙述文字都做成旁白；但一旦选择，后续 Storyboard 必须逐字且恰好分配一次。

结构规则：
- 只输出 JSON：{"scene":{"scene_heading":"","scene_description":"","beats":[{"description":"","dialogue":[],"narration":[]}]}}。
- scene_heading 必须是非空字符串；scene_description 必须是字符串。
- 每个 Beat description 必须是非空字符串，是忠实的剧本化语义摘要，不要求逐字复刻原文；不得新增 beat_source_authority 中不存在的事件。dialogue 必须是 JSON array，空对白用 []。
- 不得输出 camera/shot_size/movement/continuity/director/source_evidence 等下游字段。
- 不新增剧情、动作、人物关系、心理或原文不存在的信息。
- 如果 user payload 含 repair_instruction：以 repair_instruction.invalid_output 为基底，只修 validation_errors 指向的当前 Scene 字段；这是定点修复，不得重新改写整个 Scene，不得改变未被错误指向的合法对白与 Beat 内容。
- 只输出一个 JSON object，不要 markdown、解释或前后缀文本。
"""


def output_template() -> dict[str, Any]:
    return {
        "scene": {
            "scene_heading": "",
            "scene_description": "",
            "beats": [{
                "description": "",
                "dialogue": [{"character_id": "char_001", "line": ""}],
                "narration": [],
            }],
        }
    }


def output_contract() -> dict[str, Any]:
    return {
        "model_scene_fields": ["scene_heading", "scene_description", "beats"],
        "model_beat_fields": ["description", "dialogue", "narration"],
        "dialogue_fields": ["character_id", "line"],
        "canonical_scene_fields": ["scene_id", "context_ref", "location_ref", "scene_heading", "scene_description", "beats"],
        "canonical_beat_fields": ["beat_id", "description", "dialogue", "narration"],
        "program_owned_fields": ["scene_id", "location_ref", "context_ref", "beat_id"],
        "beat_rule": "one Script beat per Scene Plan beat, in the same array order",
        "dialogue_rule": "line must be exact source-authored speech in the current Beat/Scene and preserve source order; required=true + speaker_ref entries are program-projected mandatory direct dialogue, while quoted/unbound candidates remain model-selectable evidence candidates",
        "narration_rule": "selected voice-over must be exact current-Scene source substrings; no dialogue duplication",
        "beat_description_authority": "semantic_summary; beat_source_authority.source_text is factual authority; lexical overlap is advisory only",
        "authority_manifest": authority_manifest("script_scene"),
        "null_policy": "beats/dialogue must use []; required scalars must not be null",
    }


def _find_by_id(items: Any, key: str, value: str) -> dict[str, Any] | None:
    if not isinstance(items, list):
        return None
    for item in items:
        if isinstance(item, dict) and item.get(key) == value:
            return item
    return None



_SPEECH_CONTEXT_RE = re.compile(r"(?:说|说道|问|问道|回答|回应|开口|喊|叫|低声|轻声|吼|嘀咕|喃喃|反问|补充|解释|告诉|道)[：:,，\s]*$")

def _looks_like_spoken_quote(source: str, quote_start: int) -> bool:
    left = source[max(0, quote_start - 36):quote_start]
    if _SPEECH_CONTEXT_RE.search(left):
        return True
    line_start = source.rfind("\n", 0, quote_start) + 1
    prefix = source[line_start:quote_start].strip(" \t—-：:")
    return prefix == ""

_DIALOGUE_PATTERNS = (
    re.compile(r'“([^”\n]{1,500})”'),
    re.compile(r'(?<![A-Za-z0-9])"([^"\n]{1,500})"'),
    re.compile(r"‘([^’\n]{1,500})’"),
)


def _quoted_dialogue_candidates(scene_source_text: str) -> list[dict[str, Any]]:
    """Return exact quoted-text occurrences without claiming all are spoken dialogue.

    This inventory is deliberately broader than the high-confidence manifest. It is
    used only to prove that a model-selected dialogue line is source-authored quoted
    speech text; mandatory inclusion remains the job of the conservative manifest.
    """
    matches: list[dict[str, Any]] = []
    seen: set[tuple[int, int, str]] = set()
    for pattern in _DIALOGUE_PATTERNS:
        for m in pattern.finditer(scene_source_text or ""):
            raw = str(m.group(1) or "")
            text = raw.strip()
            if not text:
                continue
            offset = raw.find(text)
            start = m.start(1) + max(0, offset)
            end = start + len(text)
            marker = (start, end, text)
            if marker in seen:
                continue
            seen.add(marker)
            matches.append({
                "open_start": m.start(),
                "start": start,
                "end": end,
                "close_end": m.end(),
                "line": text,
            })
    matches.sort(key=lambda item: int(item["start"]))
    return matches


def _high_confidence_dialogue_manifest(scene_source_text: str, characters: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    matches: list[tuple[int, int, int, str]] = []
    for item in _quoted_dialogue_candidates(scene_source_text):
        text = str(item["line"])
        if len(text) < 2 or not _looks_like_spoken_quote(scene_source_text, int(item["open_start"])):
            continue
        matches.append((int(item["open_start"]), int(item["start"]), int(item["close_end"]), text))
    name_to_ref: list[tuple[str, str]] = []
    for char in characters or []:
        if not isinstance(char, dict) or not char.get("character_id"):
            continue
        names = [char.get("canonical_name"), *(char.get("aliases") or [])]
        for name in names:
            if isinstance(name, str) and name.strip():
                name_to_ref.append((name.strip(), str(char["character_id"])))

    def speaker_for(open_start: int, close_end: int) -> str | None:
        candidates: set[str] = set()
        left = scene_source_text[max(0, open_start - 40):open_start]
        right = scene_source_text[close_end:min(len(scene_source_text), close_end + 32)]
        for name, ref in name_to_ref:
            pos = left.rfind(name)
            if pos >= 0:
                tail = left[pos + len(name):]
                if re.fullmatch(r"(?:轻声|低声|大声|冷声|沉声|笑着|哭着|平静地|缓缓地|突然)?(?:说|说道|问|问道|回答|回应|开口|喊|叫|吼|嘀咕|喃喃|反问|补充|解释|告诉|道)[：:,，\s]*", tail):
                    candidates.add(ref)
            m = re.match(r"^[，,\s]*(?:" + re.escape(name) + r")(?:轻声|低声|大声|冷声|沉声|笑着|哭着|平静地|缓缓地|突然)?(?:说|说道|问|问道|回答|回应|开口|喊|叫|吼|嘀咕|喃喃|反问|补充|解释|告诉|道)", right)
            if m:
                candidates.add(ref)
        return next(iter(candidates)) if len(candidates) == 1 else None

    # Common Chinese prose also uses unquoted dialogue such as
    # “阿宁说：你回来了。”  When a known character name + explicit speech verb +
    # colon is present, speaker attribution is deterministic enough to freeze.
    speech_verbs = r"(?:轻声|低声|大声|冷声|沉声|笑着|哭着|平静地|缓缓地|突然)?(?:说|说道|问|问道|回答|回应|开口|喊|叫|吼|嘀咕|喃喃|反问|补充|解释|告诉|道)"
    for name, ref in name_to_ref:
        pattern = re.compile(
            re.escape(name) + speech_verbs + r"[：:]\s*(?![“\"‘])([^。！？\n]{1,500}[。！？]?)"
        )
        for m in pattern.finditer(scene_source_text or ""):
            text = str(m.group(1) or "").strip()
            if not text:
                continue
            start = m.start(1)
            end = m.end(1)
            matches.append((m.start(), start, end, text, ref))

    # Quoted-dialogue matches do not yet carry a frozen speaker; unquoted high-confidence
    # matches above do. Keep source order stable.
    normalized_matches: list[tuple[int, int, int, str, str | None]] = []
    for item in matches:
        if len(item) == 4:
            open_start, start, close_end, text = item
            normalized_matches.append((open_start, start, close_end, text, None))
        else:
            normalized_matches.append(item)
    normalized_matches.sort(key=lambda x: x[1])

    out: list[dict[str, Any]] = []
    seen: set[tuple[int, int, str]] = set()
    for open_start, start, close_end, text, frozen_speaker in normalized_matches:
        marker = (start, close_end, text)
        if marker in seen:
            continue
        seen.add(marker)
        item: dict[str, Any] = {"dialogue_ref": f"DLG{len(out)+1:03d}", "start": start, "end": start + len(text), "line": text}
        speaker_ref = frozen_speaker or speaker_for(open_start, close_end)
        if speaker_ref:
            item["speaker_ref"] = speaker_ref
        out.append(item)
    return out


def _source_dialogue_inventory(scene_source_text: str, characters: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """Build a source-authored dialogue inventory without conflating quotation with direct speech.

    A quoted span is always a candidate, but it becomes mandatory only when the runtime
    can also bind a unique current-scene speaker. This prevents flashback quotations,
    reported speech, letters, slogans, and other quoted material from being forced into
    the current Scene as direct dialogue.
    """
    quoted = _quoted_dialogue_candidates(scene_source_text)
    high = _high_confidence_dialogue_manifest(scene_source_text, characters)
    high_by_occurrence = {
        (int(item.get("start") or -1), str(item.get("line") or "")): item
        for item in high
    }
    inventory: list[dict[str, Any]] = []
    seen: set[tuple[int, str]] = set()

    for item in quoted:
        marker = (int(item.get("start") or -1), str(item.get("line") or ""))
        high_item = high_by_occurrence.get(marker) or {}
        entry: dict[str, Any] = {
            "dialogue_ref": f"DLG{len(inventory)+1:03d}",
            "start": marker[0],
            "end": int(item.get("end") or marker[0]),
            "line": marker[1],
            "required": bool(high_item.get("speaker_ref")),
        }
        if high_item.get("speaker_ref"):
            entry["speaker_ref"] = high_item["speaker_ref"]
        inventory.append(entry)
        seen.add(marker)

    # Deterministic unquoted speech (for example, Name said: text) is not present in
    # the quoted inventory, but it is mandatory because both speech status and speaker
    # attribution are program-resolved.
    for item in high:
        marker = (int(item.get("start") or -1), str(item.get("line") or ""))
        if marker in seen:
            continue
        entry = {
            "dialogue_ref": f"DLG{len(inventory)+1:03d}",
            "start": marker[0],
            "end": int(item.get("end") or (marker[0] + len(marker[1]))),
            "line": marker[1],
            "required": bool(item.get("speaker_ref")),
        }
        if item.get("speaker_ref"):
            entry["speaker_ref"] = item["speaker_ref"]
        inventory.append(entry)
        seen.add(marker)

    inventory.sort(key=lambda x: int(x.get("start") or -1))
    for index, item in enumerate(inventory, start=1):
        item["dialogue_ref"] = f"DLG{index:03d}"
    return inventory


def _beat_source_authority(source_text: str, source_index: list[dict[str, Any]], scene_plan_scene: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for beat in scene_plan_scene.get("beat_list", []) or []:
        if not isinstance(beat, dict):
            continue
        refs = [str(x) for x in beat.get("source_refs", []) or [] if isinstance(x, str)]
        span = refs_to_span(source_text, source_index, refs) if refs else None
        out.append({
            "beat_id": str(beat.get("beat_id") or ""),
            "source_refs": refs,
            "source_text": str((span or {}).get("source_text") or ""),
        })
    return out


def build_script_scene_payload(source_text: str, story_bible: dict[str, Any], scene_plan_scene: dict[str, Any], *, unit_id: str) -> dict[str, Any]:
    source_index = build_source_index(source_text)
    source_refs = [str(x) for x in scene_plan_scene.get("source_refs", []) or [] if isinstance(x, str)]
    scene_source_text = slice_by_scene_refs(source_text, source_index, source_refs) or source_text
    char_ids = set(scene_plan_scene.get("character_refs", []) or [])
    prop_ids = set(scene_plan_scene.get("prop_refs", []) or [])
    location_ref = str(scene_plan_scene.get("location_ref") or "")
    context_ref = str(scene_plan_scene.get("context_ref") or "")
    relevant_char_sources = [x for x in story_bible.get("characters", []) or [] if isinstance(x, dict) and x.get("character_id") in char_ids]
    relevant_chars = [project_character(x) for x in relevant_char_sources]
    return {
        "unit_id": unit_id,
        "contract_version": CONTRACT_VERSION,
        "scene_source_text": scene_source_text,
        "source_scope": {
            "source_refs": source_refs,
            "source_start": scene_plan_scene.get("source_start"),
            "source_end": scene_plan_scene.get("source_end"),
        },
        "beat_source_authority": _beat_source_authority(source_text, source_index, scene_plan_scene),
        "source_dialogue_inventory": _source_dialogue_inventory(scene_source_text, relevant_chars),
        "scene_plan_scene": copy.deepcopy(scene_plan_scene),
        "relevant_story_facts": {
            "characters": relevant_chars,
            "props": [project_prop(x) for x in story_bible.get("props", []) or [] if isinstance(x, dict) and x.get("prop_id") in prop_ids],
            "scene": project_scene(_find_by_id(story_bible.get("scenes"), "scene_id", location_ref) or {}),
            "context": project_context(_find_by_id(story_bible.get("narrative_contexts"), "context_id", context_ref) or {}) if context_ref else {},
        },
        "allowed_dialogue_speakers": [
            {"character_id": x.get("character_id"), "canonical_name": x.get("canonical_name"), "role_type": x.get("role_type")}
            for x in relevant_chars
            if x.get("character_id")
        ],
        "required_scene_id": scene_plan_scene.get("scene_id"),
        "required_location_ref": scene_plan_scene.get("location_ref"),
        "required_context_ref": scene_plan_scene.get("context_ref") or "",
        "required_beat_ids": [b.get("beat_id") for b in scene_plan_scene.get("beat_list", []) or [] if isinstance(b, dict)],
        "output_template": output_template(),
        "output_contract": output_contract(),
    }


def _set(target: dict[str, Any], key: str, value: Any) -> int:
    if key in target and target.get(key) == value:
        return 0
    target[key] = value
    return 1


def _required_direct_dialogue_assignments(
    source_text: str, story_bible: dict[str, Any], scene_plan_scene: dict[str, Any]
) -> list[dict[str, Any]]:
    """Resolve mandatory direct speech to exact Scene Plan Beat positions.

    Only inventory entries already proven as direct speech with a unique speaker are
    projected. Quoted/unbound candidates remain untouched for later semantic handling.
    """
    source_index = build_source_index(source_text)
    scene_refs = [str(x) for x in scene_plan_scene.get("source_refs", []) or [] if isinstance(x, str)]
    scene_span = refs_to_span(source_text, source_index, scene_refs) if scene_refs else None
    scene_source_text = str((scene_span or {}).get("source_text") or "") or source_text
    scene_global_start = int((scene_span or {}).get("source_start") or 0)

    char_ids = set(scene_plan_scene.get("character_refs", []) or [])
    relevant_chars = [
        project_character(x) for x in story_bible.get("characters", []) or []
        if isinstance(x, dict) and x.get("character_id") in char_ids
    ]
    required = [
        item for item in _source_dialogue_inventory(scene_source_text, relevant_chars)
        if item.get("required") and item.get("speaker_ref")
    ]
    beats = [b for b in scene_plan_scene.get("beat_list", []) or [] if isinstance(b, dict)]
    beat_spans: list[tuple[int, int, int, str]] = []
    for index, beat in enumerate(beats):
        refs = [str(x) for x in beat.get("source_refs", []) or [] if isinstance(x, str)]
        span = refs_to_span(source_text, source_index, refs) if refs else None
        if span:
            beat_spans.append((index, int(span.get("source_start") or 0), int(span.get("source_end") or 0), str(span.get("source_text") or "")))
        else:
            beat_spans.append((index, -1, -1, ""))

    assignments: list[dict[str, Any]] = []
    for item in required:
        relative_start = int(item.get("start") or 0)
        absolute_start = scene_global_start + relative_start
        line = str(item.get("line") or "")
        beat_index: int | None = None
        for index, start, end, _ in beat_spans:
            if start >= 0 and start <= absolute_start < end:
                beat_index = index
                break
        if beat_index is None:
            # Compatibility fallback when a fixture/legacy plan has no concrete refs:
            # use the first Beat whose exact authority text contains this source line.
            for index, _, _, beat_text in beat_spans:
                if beat_text and line and line in beat_text:
                    beat_index = index
                    break
        if beat_index is None and len(beats) == 1:
            beat_index = 0
        if beat_index is None:
            continue
        assignments.append({
            "beat_index": beat_index,
            "beat_id": str(beats[beat_index].get("beat_id") or ""),
            "character_id": str(item.get("speaker_ref") or ""),
            "line": line,
            "start": relative_start,
        })
    return assignments


def canonicalize_script_scene(
    scene_plan_scene: dict[str, Any],
    candidate: dict[str, Any],
    *,
    source_text: str = "",
    story_bible: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], int]:
    """Inject mechanical Scene Plan refs plus deterministic mandatory direct speech."""
    out = copy.deepcopy(candidate)
    changes = 0
    changes += _set(out, "scene_id", str(scene_plan_scene.get("scene_id") or ""))
    changes += _set(out, "location_ref", str(scene_plan_scene.get("location_ref") or ""))
    changes += _set(out, "context_ref", str(scene_plan_scene.get("context_ref") or ""))

    plan_beats = scene_plan_scene.get("beat_list")
    beats = out.get("beats")
    if isinstance(beats, list):
        pbeats = plan_beats if isinstance(plan_beats, list) else []
        for index, beat in enumerate(beats):
            if not isinstance(beat, dict):
                continue
            bid = str(pbeats[index].get("beat_id") or "") if index < len(pbeats) and isinstance(pbeats[index], dict) else ""
            changes += _set(beat, "beat_id", bid)
            if "narration" not in beat:
                beat["narration"] = []
                changes += 1


        if source_text and isinstance(story_bible, dict):
            assignments = _required_direct_dialogue_assignments(source_text, story_bible, scene_plan_scene)
            mandatory_pairs = {(a["character_id"], a["line"]) for a in assignments}
            # Remove model-copied instances of program-owned mandatory direct dialogue
            # from every Beat before projecting the exact source occurrence back once.
            for beat in beats:
                if not isinstance(beat, dict) or not isinstance(beat.get("dialogue"), list):
                    continue
                filtered = [
                    line for line in beat.get("dialogue") or []
                    if not (
                        isinstance(line, dict)
                        and (str(line.get("character_id") or ""), str(line.get("line") or "")) in mandatory_pairs
                    )
                ]
                if filtered != beat.get("dialogue"):
                    beat["dialogue"] = filtered
                    changes += 1

            for assignment in assignments:
                index = int(assignment["beat_index"])
                if not (0 <= index < len(beats)) or not isinstance(beats[index], dict):
                    continue
                dialogue = beats[index].get("dialogue")
                if not isinstance(dialogue, list):
                    dialogue = []
                    beats[index]["dialogue"] = dialogue
                    changes += 1
                injected = {"character_id": assignment["character_id"], "line": assignment["line"]}
                dialogue.append(injected)
                changes += 1

            # Beat placement is source-owned for any selected dialogue with one unique
            # occurrence in the current Scene. Keep the model-selected speaker, but
            # move the line to the Beat whose exact source span contains that occurrence.
            source_index = build_source_index(source_text)
            scene_refs = [str(x) for x in scene_plan_scene.get("source_refs", []) or [] if isinstance(x, str)]
            scene_span = refs_to_span(source_text, source_index, scene_refs) if scene_refs else None
            scene_text = str((scene_span or {}).get("source_text") or "") or source_text
            scene_start = int((scene_span or {}).get("source_start") or 0)
            beat_ranges: list[tuple[int, int, int]] = []
            for bi, pbeat in enumerate(pbeats):
                refs = [str(x) for x in pbeat.get("source_refs", []) or [] if isinstance(x, str)] if isinstance(pbeat, dict) else []
                span = refs_to_span(source_text, source_index, refs) if refs else None
                if span:
                    beat_ranges.append((bi, int(span.get("source_start") or 0), int(span.get("source_end") or 0)))

            relocations: list[tuple[int, int, dict[str, Any]]] = []
            for current_index, beat in enumerate(beats):
                if not isinstance(beat, dict) or not isinstance(beat.get("dialogue"), list):
                    continue
                kept: list[dict[str, Any]] = []
                for line in beat.get("dialogue") or []:
                    if not isinstance(line, dict):
                        kept.append(line)
                        continue
                    text = str(line.get("line") or "")
                    if not text:
                        kept.append(line)
                        continue
                    positions = [m.start() for m in re.finditer(re.escape(text), scene_text)]
                    if len(positions) != 1:
                        kept.append(line)
                        continue
                    absolute_start = scene_start + positions[0]
                    target_index = next((bi for bi, start, end in beat_ranges if start <= absolute_start < end), None)
                    if target_index is None or target_index == current_index:
                        kept.append(line)
                        continue
                    relocations.append((current_index, target_index, line))
                    changes += 1
                beat["dialogue"] = kept
            for _, target_index, line in relocations:
                if 0 <= target_index < len(beats) and isinstance(beats[target_index], dict):
                    target_dialogue = beats[target_index].get("dialogue")
                    if not isinstance(target_dialogue, list):
                        target_dialogue = []
                        beats[target_index]["dialogue"] = target_dialogue
                    target_dialogue.append(line)

            # Restore source order inside each Beat after deterministic projection.
            for index, beat in enumerate(beats):
                if not isinstance(beat, dict) or not isinstance(beat.get("dialogue"), list):
                    continue
                pbeat = pbeats[index] if index < len(pbeats) and isinstance(pbeats[index], dict) else {}
                refs = [str(x) for x in pbeat.get("source_refs", []) or [] if isinstance(x, str)]
                span = refs_to_span(source_text, source_index, refs) if refs else None
                beat_text = str((span or {}).get("source_text") or "")
                if not beat_text:
                    continue
                original = list(beat["dialogue"])
                decorated: list[tuple[int, int, dict[str, Any]]] = []
                search_cursor = 0
                for order, line in enumerate(original):
                    text = str(line.get("line") or "") if isinstance(line, dict) else ""
                    pos = beat_text.find(text, search_cursor) if text else -1
                    if pos < 0 and text:
                        pos = beat_text.find(text)
                    if pos >= 0:
                        search_cursor = pos + len(text)
                    decorated.append((pos if pos >= 0 else 10**9, order, line))
                reordered = [line for _, _, line in sorted(decorated, key=lambda x: (x[0], x[1]))]
                if reordered != original:
                    beat["dialogue"] = reordered
                    changes += 1
    return out, changes


def _error(errors: list[dict[str, Any]], etype: str, detail: str, **context: Any) -> None:
    item: dict[str, Any] = {"type": etype, "detail": detail}
    item.update(context)
    errors.append(item)


def _require_fields(errors: list[dict[str, Any]], item: dict[str, Any], fields: list[str], *, path: str) -> None:
    for field in fields:
        if field not in item:
            _error(errors, "missing_script_field", f"{path}.{field} is required", path=path, field=field)


def _require_string(errors: list[dict[str, Any]], item: dict[str, Any], field: str, *, path: str, nonempty: bool = False) -> None:
    value = item.get(field)
    if not isinstance(value, str):
        _error(errors, "invalid_script_scalar", f"{path}.{field} must be string", path=path, field=field)
    elif nonempty and not value.strip():
        _error(errors, "invalid_script_scalar", f"{path}.{field} must be nonempty string", path=path, field=field)


def validate_script_scene_output(story_bible: dict[str, Any], scene_plan_scene: dict[str, Any], value: Any, *, source_text: str) -> list[dict[str, Any]]:
    source_index = build_source_index(source_text)
    source_refs = [str(x) for x in scene_plan_scene.get("source_refs", []) or [] if isinstance(x, str)]
    scene_source_text = slice_by_scene_refs(source_text, source_index, source_refs) or source_text
    required_dialogue: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    if not isinstance(value, dict):
        return [{"type": "shape_type_mismatch", "path": "scene", "detail": "scene must be JSON object", "expected": "JSON object", "actual_type": type(value).__name__}]

    scene_fields = output_contract()["canonical_scene_fields"]
    beat_fields = output_contract()["canonical_beat_fields"]
    dialogue_fields = output_contract()["dialogue_fields"]
    _require_fields(errors, value, scene_fields, path="scene")
    for field in sorted(set(value) - set(scene_fields)):
        _error(errors, "extra_script_field", f"scene.{field} is not part of canonical Script", path=f"scene.{field}", field=field)

    _require_string(errors, value, "scene_id", path="scene", nonempty=True)
    _require_string(errors, value, "context_ref", path="scene")
    _require_string(errors, value, "location_ref", path="scene", nonempty=True)
    _require_string(errors, value, "scene_heading", path="scene", nonempty=True)
    _require_string(errors, value, "scene_description", path="scene")
    # scene_description is an editorial scene summary, not an event authority.
    # Keep it structurally valid, but do not require lexical anchoring here;
    # Beat descriptions carry the factual provenance contract.

    if value.get("scene_id") != scene_plan_scene.get("scene_id"):
        _error(errors, "script_scene_id_mismatch", "script scene_id must match Scene Plan", scene_id=value.get("scene_id"))
    if value.get("location_ref") != scene_plan_scene.get("location_ref"):
        _error(errors, "script_location_mismatch", "script location_ref must match Scene Plan", scene_id=value.get("scene_id"))
    if (value.get("context_ref") or "") != (scene_plan_scene.get("context_ref") or ""):
        _error(errors, "script_context_mismatch", "script context_ref must match Scene Plan", scene_id=value.get("scene_id"))

    beats = value.get("beats")
    if not isinstance(beats, list):
        _error(errors, "shape_type_mismatch", "scene.beats must be JSON array", path="scene.beats", expected="JSON array", actual_type=type(beats).__name__)
        return errors
    plan_beats = scene_plan_scene.get("beat_list") if isinstance(scene_plan_scene.get("beat_list"), list) else []
    if len(beats) != len(plan_beats):
        _error(errors, "script_beat_count_mismatch", f"expected {len(plan_beats)} beats, got {len(beats)}", scene_id=value.get("scene_id"))

    story_chars = {
        str(c.get("character_id")): c
        for c in story_bible.get("characters", []) or []
        if isinstance(c, dict) and c.get("character_id")
    }
    allowed_scene_chars = set(scene_plan_scene.get("character_refs", []) or [])
    relevant_chars = [char for cid, char in story_chars.items() if cid in allowed_scene_chars]
    high_confidence_dialogue = _high_confidence_dialogue_manifest(scene_source_text, relevant_chars)
    source_dialogue_inventory = _source_dialogue_inventory(scene_source_text, relevant_chars)
    required_dialogue = [item for item in source_dialogue_inventory if item.get("required") and item.get("speaker_ref")]
    quoted_dialogue = _quoted_dialogue_candidates(scene_source_text)
    quoted_occurrences = {(int(item["start"]), str(item["line"])) for item in quoted_dialogue}
    high_confidence_occurrences = {(int(item.get("start") or -1), str(item.get("line") or "")) for item in high_confidence_dialogue}
    ordered_lines: list[tuple[str, str, str, str]] = []
    narration_items: list[tuple[str, str]] = []

    for bi, beat in enumerate(beats):
        bp = f"scene.beats[{bi}]"
        if not isinstance(beat, dict):
            _error(errors, "shape_type_mismatch", f"{bp} must be JSON object", path=bp, expected="JSON object", actual_type=type(beat).__name__)
            continue
        _require_fields(errors, beat, beat_fields, path=bp)
        for field in sorted(set(beat) - set(beat_fields)):
            _error(errors, "extra_script_field", f"{bp}.{field} is not part of canonical Script Beat", path=f"{bp}.{field}", field=field)
        _require_string(errors, beat, "beat_id", path=bp, nonempty=True)
        _require_string(errors, beat, "description", path=bp, nonempty=True)
        expected_bid = str(plan_beats[bi].get("beat_id") or "") if bi < len(plan_beats) and isinstance(plan_beats[bi], dict) else ""
        if beat.get("beat_id") != expected_bid:
            _error(errors, "script_beat_id_mismatch", f"expected beat_id {expected_bid}, got {beat.get('beat_id')}", scene_id=value.get("scene_id"), beat_id=beat.get("beat_id"))
        beat_authority_text = ""
        if bi < len(plan_beats) and isinstance(plan_beats[bi], dict):
            beat_refs = [str(x) for x in (plan_beats[bi].get("source_refs") or []) if isinstance(x, str)]
            if beat_refs:
                beat_span = refs_to_span(source_text, source_index, beat_refs)
                beat_authority_text = str((beat_span or {}).get("source_text") or "")
                if beat_authority_text and not text_is_anchored(beat.get("description"), [beat_authority_text]):
                    _error(errors, "script_beat_low_source_overlap", "Script Beat description has low lexical overlap with the exact Beat source window; source text remains the factual authority", path=f"{bp}.description", source_refs=beat_refs)

        dialogue = beat.get("dialogue")
        if not isinstance(dialogue, list):
            _error(errors, "shape_type_mismatch", f"{bp}.dialogue must be JSON array", path=f"{bp}.dialogue", expected="JSON array", actual_type=type(dialogue).__name__)
            continue
        for di, line in enumerate(dialogue):
            dp = f"{bp}.dialogue[{di}]"
            if not isinstance(line, dict):
                _error(errors, "shape_type_mismatch", f"{dp} must be JSON object", path=dp, expected="JSON object", actual_type=type(line).__name__)
                continue
            _require_fields(errors, line, dialogue_fields, path=dp)
            for field in sorted(set(line) - set(dialogue_fields)):
                _error(errors, "extra_script_field", f"{dp}.{field} is not part of canonical Dialogue", path=f"{dp}.{field}", field=field)
            _require_string(errors, line, "character_id", path=dp, nonempty=True)
            _require_string(errors, line, "line", path=dp, nonempty=True)
            cid = line.get("character_id")
            text = line.get("line")
            if isinstance(cid, str):
                if cid not in story_chars:
                    _error(errors, "unknown_dialogue_speaker", f"unknown dialogue speaker: {cid}", scene_id=value.get("scene_id"), beat_id=beat.get("beat_id"), character_id=cid, path=f"{dp}.character_id")
                if cid not in allowed_scene_chars:
                    _error(errors, "dialogue_speaker_not_in_scene_plan", f"dialogue speaker is not in current Scene character_refs: {cid}", scene_id=value.get("scene_id"), beat_id=beat.get("beat_id"), character_id=cid, path=f"{dp}.character_id")
            if isinstance(text, str) and text.strip():
                if text not in scene_source_text:
                    _error(errors, "dialogue_not_in_source", f"dialogue line not found verbatim in current Scene source span: {text}", scene_id=value.get("scene_id"), beat_id=beat.get("beat_id"), character_id=cid, path=f"{dp}.line")
                elif beat_authority_text and text not in beat_authority_text:
                    _error(errors, "dialogue_not_in_beat_source", "dialogue line belongs to the current Scene but not to this Beat source window", scene_id=value.get("scene_id"), beat_id=beat.get("beat_id"), character_id=cid, line=text, path=f"{dp}.line")
                else:
                    ordered_lines.append((str(beat.get("beat_id") or ""), str(cid or ""), text, dp))

        narration = beat.get("narration")
        if not isinstance(narration, list):
            _error(errors, "shape_type_mismatch", f"{bp}.narration must be JSON array", path=f"{bp}.narration", expected="JSON array", actual_type=type(narration).__name__)
        else:
            last_narration_pos = -1
            dialogue_texts = {str(x.get("line") or "") for x in (dialogue or []) if isinstance(x, dict)} if isinstance(dialogue, list) else set()
            for ni, text in enumerate(narration):
                np = f"{bp}.narration[{ni}]"
                if not isinstance(text, str) or not text.strip():
                    _error(errors, "invalid_script_narration", f"{np} must be nonempty string", path=np)
                    continue
                if text in dialogue_texts:
                    _error(errors, "script_narration_duplicates_dialogue", "narration must not duplicate frozen dialogue", path=np)
                pos = scene_source_text.find(text)
                if pos < 0:
                    _error(errors, "script_narration_not_in_source", "narration must be verbatim in current Scene source span", path=np)
                elif beat_authority_text and text not in beat_authority_text:
                    _error(errors, "script_narration_not_in_beat_source", "narration belongs to the current Scene but not to this Beat source window", path=np)
                elif pos < last_narration_pos:
                    _error(errors, "script_narration_order_mismatch", "narration order must follow current Scene source", path=np)
                else:
                    last_narration_pos = pos
                    narration_items.append((np, text))

    cursor = 0
    resolved_dialogue: list[dict[str, Any]] = []
    for bid, cid, text, dialogue_path in ordered_lines:
        pos = scene_source_text.find(text, cursor)
        if pos < 0:
            _error(
                errors,
                "dialogue_source_order_mismatch",
                f"dialogue order/occurrence does not match source after previous dialogue: {text}",
                scene_id=value.get("scene_id"), beat_id=bid, character_id=cid, path=dialogue_path,
            )
            continue
        resolved_dialogue.append({"beat_id": bid, "character_id": cid, "line": text, "start": pos, "path": dialogue_path})
        cursor = pos + len(text)

    # Every selected dialogue line must be provably source-authored speech. Quoted text
    # is accepted even when the conservative high-confidence detector cannot infer a
    # speaker from surrounding prose; unquoted dialogue must come from that detector.
    for item in resolved_dialogue:
        marker = (int(item["start"]), str(item["line"]))
        if marker not in quoted_occurrences and marker not in high_confidence_occurrences:
            _error(
                errors,
                "script_dialogue_not_source_speech",
                "dialogue line is an exact source substring but is not anchored to quoted or high-confidence source speech",
                scene_id=value.get("scene_id"), beat_id=item["beat_id"], character_id=item["character_id"], line=item["line"], path=item.get("path"),
            )

    # Only program-resolved direct speech with a unique speaker binding is mandatory.
    # Quoted-but-unbound source text may be reported speech, flashback dialogue, written
    # text, or another delivery mode; it remains a valid candidate but cannot hard-fail
    # the current Script Scene as an omission.
    missing_required: list[str] = []
    actual_by_occurrence = {(int(item["start"]), str(item["line"])): item for item in resolved_dialogue}
    for index, required in enumerate(required_dialogue):
        marker = (int(required.get("start") or -1), str(required.get("line") or ""))
        actual = actual_by_occurrence.get(marker)
        if actual is None:
            missing_required.append(str(required.get("line") or ""))
            continue
        expected_speaker = required.get("speaker_ref")
        if expected_speaker and actual.get("character_id") != expected_speaker:
            _error(
                errors, "dialogue_speaker_mismatch",
                "high-confidence source attribution binds this dialogue to a different speaker",
                scene_id=value.get("scene_id"), dialogue_index=index, expected_speaker=expected_speaker,
                actual_speaker=actual.get("character_id"), line=required.get("line"), path=actual.get("path"),
            )
    if missing_required:
        _error(errors, "script_dialogue_omission", "high-confidence dialogue from current Scene source was omitted", scene_id=value.get("scene_id"), path="scene.beats", missing_dialogue=missing_required)

    all_dialogue_texts = {str(item["line"]) for item in resolved_dialogue}
    for path, text in narration_items:
        if text in all_dialogue_texts:
            _error(errors, "script_narration_duplicates_dialogue", "narration must not duplicate frozen dialogue anywhere in the current Scene", path=path)

    return errors
