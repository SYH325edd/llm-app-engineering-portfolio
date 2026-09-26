from __future__ import annotations

import re
import unicodedata
from typing import Any

_SOURCE_UNIT_RE = re.compile(r"[^\n。！？!?；;]+(?:[。！？!?；;]+[”’」』）》】〉》\"\']*|$)|\n+", re.MULTILINE)

_SOURCE_TYPE_NARRATIVE = "narrative"
_SOURCE_TYPE_DOCUMENT_HEADING = "document_heading"
_TITLE_WRAPPERS = (
    ("《", "》"), ("〈", "〉"), ("【", "】"), ("[", "]"),
    ("「", "」"), ("『", "』"), ("“", "”"), ('"', '"'),
    ("‘", "’"), ("'", "'"),
)
_SENTENCE_TERMINATOR_RE = re.compile(r"(?:[。！？!?；;.]|……|…)\s*$")
_FIRST_LINE_RE = re.compile(r"^\ufeff?[ \t]*([^\r\n]+?)[ \t]*(?:\r\n|\n|\r)")


def normalize_document_title(value: str) -> str:
    """Normalize only representation-level title syntax for exact comparison."""
    text = unicodedata.normalize("NFKC", value if isinstance(value, str) else "").strip()
    text = " ".join(text.split())
    for left, right in _TITLE_WRAPPERS:
        if len(text) >= len(left) + len(right) and text.startswith(left) and text.endswith(right):
            text = text[len(left): len(text) - len(right)].strip()
            text = " ".join(text.split())
            break
    return text


def _document_heading_span(source_text: str, project_title: str | None, *, title_is_explicit: bool) -> tuple[int, int] | None:
    """Return the exact first-line title span only when every deterministic guard passes."""
    if not title_is_explicit or not isinstance(project_title, str) or not project_title.strip():
        return None
    text = source_text if isinstance(source_text, str) else ""
    match = _FIRST_LINE_RE.match(text)
    if not match:
        return None
    candidate = str(match.group(1) or "").strip()
    if not candidate or len(candidate) > 80:
        return None
    # A title must have body content after its own physical line; title+body on one
    # line therefore remains narrative by construction.
    if not text[match.end():].strip():
        return None
    if _SENTENCE_TERMINATOR_RE.search(candidate):
        return None
    if normalize_document_title(candidate) != normalize_document_title(project_title):
        return None
    return match.start(1), match.end(1)


def narrative_source_index(source_index: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        item for item in source_index or []
        if isinstance(item, dict) and item.get("source_type", _SOURCE_TYPE_NARRATIVE) == _SOURCE_TYPE_NARRATIVE
    ]

_SPATIAL_TRANSITION_RE = re.compile(
    r"(?:走出|走进|进入|离开|离去|回到|返回|来到|抵达|到达|走到|跑到|穿过|经过|上楼|下楼|出门|进门|进屋|出屋|驶入|驶出|开进|开出)"
)


def _split_spatial_transition_span(text: str, start: int, end: int) -> list[tuple[int, int]]:
    """Split one sentence only when comma-delimited clauses encode location travel.

    This is deliberately conservative: ordinary descriptive commas remain untouched.
    It exists so one source sentence may map to multiple physical Scenes without
    assigning the exact same SRC to multiple Scenes.
    """
    raw = text[start:end]
    comma_ends = [m.end() for m in re.finditer(r"[，,]", raw)]
    if not comma_ends:
        return [(start, end)]
    boundaries: list[int] = []
    clause_start = 0
    for comma_end in comma_ends:
        left = raw[clause_start:comma_end]
        right_start = comma_end
        next_comma = next((x for x in comma_ends if x > comma_end), len(raw))
        right = raw[right_start:next_comma]
        if _SPATIAL_TRANSITION_RE.search(left) or _SPATIAL_TRANSITION_RE.match(right.lstrip()):
            boundaries.append(comma_end)
            clause_start = comma_end
    if not boundaries:
        return [(start, end)]
    points = [0, *boundaries, len(raw)]
    spans: list[tuple[int, int]] = []
    for a, b in zip(points, points[1:]):
        if a < b and raw[a:b].strip():
            spans.append((start + a, start + b))
    return spans or [(start, end)]


def build_source_index(
    source_text: str,
    *,
    max_unit_chars: int = 420,
    project_title: str | None = None,
    title_is_explicit: bool = False,
) -> list[dict[str, Any]]:
    """Build deterministic, immutable source units with stable offsets and source type.

    `document_heading` is assigned only to a conservative first-line candidate that
    exactly matches the explicit project title after representation-only normalization.
    The unit is retained for audit; downstream story stages consume only `narrative`.
    """
    text = source_text if isinstance(source_text, str) else ""
    heading_span = _document_heading_span(text, project_title, title_is_explicit=title_is_explicit)
    spans: list[tuple[int, int]] = []
    for match in _SOURCE_UNIT_RE.finditer(text):
        start, end = match.span()
        raw = text[start:end]
        if not raw.strip():
            continue
        while end - start > max_unit_chars:
            cut = start + max_unit_chars
            window = text[start:cut]
            candidates = [window.rfind("\n"), window.rfind(" "), window.rfind("　")]
            rel = max(candidates)
            if rel >= max_unit_chars // 2:
                cut = start + rel + 1
            spans.append((start, cut))
            start = cut
        if start < end and text[start:end].strip():
            spans.extend(_split_spatial_transition_span(text, start, end))
    if not spans and text.strip():
        spans = [(0, len(text))]
    items: list[dict[str, Any]] = []
    for idx, (start, end) in enumerate(spans, 1):
        source_type = _SOURCE_TYPE_NARRATIVE
        if heading_span is not None and start <= heading_span[0] and end >= heading_span[1]:
            # The first physical title line is expected to occupy its own source unit.
            # If a future splitter ever merges it with body text, fail conservative:
            # do not classify the mixed unit as metadata.
            unit_text = text[start:end]
            if unit_text.strip() == text[heading_span[0]:heading_span[1]].strip():
                source_type = _SOURCE_TYPE_DOCUMENT_HEADING
        items.append({
            "source_ref": f"SRC{idx:04d}",
            "start": start,
            "end": end,
            "text": text[start:end],
            "source_type": source_type,
        })
    return items


def model_source_units(
    source_text: str,
    *,
    max_unit_chars: int = 420,
    project_title: str | None = None,
    title_is_explicit: bool = False,
    narrative_only: bool = False,
) -> list[dict[str, str]]:
    """Token-lean source view for LLM prompts.

    Offsets are deterministic program-owned metadata and are intentionally omitted
    from the model payload. The model only needs a stable ref and the immutable text.
    """
    source_index = build_source_index(
        source_text,
        max_unit_chars=max_unit_chars,
        project_title=project_title,
        title_is_explicit=title_is_explicit,
    )
    if narrative_only:
        source_index = narrative_source_index(source_index)
    return [
        {"source_ref": str(item["source_ref"]), "text": str(item["text"])}
        for item in source_index
    ]

def source_index_map(source_index: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {
        str(item.get("source_ref")): item
        for item in source_index or []
        if isinstance(item, dict) and item.get("source_ref")
    }


def refs_to_span(source_text: str, source_index: list[dict[str, Any]], refs: list[str]) -> dict[str, Any] | None:
    mapping = source_index_map(source_index)
    items = [mapping.get(str(ref)) for ref in refs if str(ref) in mapping]
    items = [x for x in items if isinstance(x, dict)]
    if not items:
        return None
    starts = [int(x["start"]) for x in items]
    ends = [int(x["end"]) for x in items]
    start, end = min(starts), max(ends)
    if start < 0 or end < start or end > len(source_text):
        return None
    return {"source_start": start, "source_end": end, "source_text": source_text[start:end]}


def find_refs_for_exact_quote(source_text: str, source_index: list[dict[str, Any]], quote: str) -> list[str]:
    if not isinstance(quote, str) or not quote:
        return []
    start = source_text.find(quote)
    if start < 0:
        return []
    end = start + len(quote)
    refs: list[str] = []
    for item in source_index or []:
        if not isinstance(item, dict):
            continue
        s, e = int(item.get("start", -1)), int(item.get("end", -1))
        if s < end and e > start and item.get("source_ref"):
            refs.append(str(item["source_ref"]))
    return refs


def materialize_evidence(
    evidence: Any,
    *,
    source_text: str,
    source_index: list[dict[str, Any]],
) -> tuple[Any, int]:
    """Canonicalize evidence to exact source-owned spans.

    Preferred model contract is {source_refs:[...]}. Legacy {quote:"..."} remains
    accepted when it is an exact source substring. Program always owns quote/offsets.
    """
    if not isinstance(evidence, list):
        return evidence, 0
    mapping = source_index_map(source_index)
    out: list[Any] = []
    changes = 0
    for item in evidence:
        if not isinstance(item, dict):
            out.append(item)
            continue
        refs = item.get("source_refs")
        if isinstance(refs, list) and refs and all(isinstance(x, str) for x in refs):
            valid = [x for x in refs if x in mapping]
            if len(valid) == len(refs):
                span = refs_to_span(source_text, source_index, valid)
                if span:
                    canonical = {
                        "source_refs": valid,
                        "source_start": span["source_start"],
                        "source_end": span["source_end"],
                        "quote": span["source_text"],
                    }
                    supports = item.get("supports")
                    if isinstance(supports, list) and all(isinstance(x, str) and x for x in supports):
                        canonical["supports"] = list(supports)
                    out.append(canonical)
                    if canonical != item:
                        changes += 1
                    continue
        quote = item.get("quote")
        if isinstance(quote, str) and quote and quote in source_text:
            start = source_text.find(quote)
            refs = find_refs_for_exact_quote(source_text, source_index, quote)
            canonical = {
                "source_refs": refs,
                "source_start": start,
                "source_end": start + len(quote),
                "quote": quote,
            }
            supports = item.get("supports")
            if isinstance(supports, list) and all(isinstance(x, str) and x for x in supports):
                canonical["supports"] = list(supports)
            out.append(canonical)
            if canonical != item:
                changes += 1
            continue
        out.append(item)
    return out, changes


def slice_by_scene_refs(source_text: str, source_index: list[dict[str, Any]], refs: list[str]) -> str:
    span = refs_to_span(source_text, source_index, refs)
    return str(span.get("source_text") or "") if span else ""
