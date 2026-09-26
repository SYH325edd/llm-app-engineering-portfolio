from __future__ import annotations

import copy
from typing import Any

# Representation-only differences that may safely be mapped back to the exact
# source span. We deliberately do NOT normalize words, punctuation, numbers,
# or sentence order: semantic/paraphrase mismatches must still fail validation.
_QUOTE_EQUIVALENTS = {
    '"', "'", '“', '”', '‘', '’', '「', '」', '『', '』', '＂', '＇',
}


def _match_char(ch: str) -> str | None:
    if ch.isspace():
        return None
    if ch in _QUOTE_EQUIVALENTS:
        return '"'
    return ch


def _normalized_with_index(text: str) -> tuple[str, list[int]]:
    chars: list[str] = []
    index_map: list[int] = []
    for index, ch in enumerate(text):
        mapped = _match_char(ch)
        if mapped is None:
            continue
        chars.append(mapped)
        index_map.append(index)
    return ''.join(chars), index_map


def reanchor_quote_to_source(quote: str, source_text: str) -> str | None:
    """Return the exact source span for a representation-only quote mismatch.

    This is intentionally conservative:
    - exact substrings are returned unchanged;
    - only whitespace and quote-glyph differences are ignored for matching;
    - the normalized match must be unique in source_text;
    - no fuzzy/semantic rewriting is attempted.
    """
    if not isinstance(quote, str) or not quote or not isinstance(source_text, str):
        return None
    if quote in source_text:
        return quote

    normalized_quote, _ = _normalized_with_index(quote)
    normalized_source, source_index = _normalized_with_index(source_text)
    if not normalized_quote or not normalized_source or not source_index:
        return None

    first = normalized_source.find(normalized_quote)
    if first < 0:
        return None
    if normalized_source.find(normalized_quote, first + 1) >= 0:
        return None

    last = first + len(normalized_quote) - 1
    if last >= len(source_index):
        return None
    start = source_index[first]
    end = source_index[last] + 1
    anchored = source_text[start:end]
    return anchored if anchored else None


def reanchor_story_bible_evidence(value: dict[str, Any], *, source_text: str) -> tuple[dict[str, Any], int]:
    """Mechanically restore Story Bible evidence quotes to exact source spans.

    Only source_evidence entries on the four Story Bible entity collections are
    touched. The function never changes entity facts or invents evidence.
    """
    out = copy.deepcopy(value)
    changes = 0
    for collection in ('characters', 'scenes', 'props', 'narrative_contexts'):
        items = out.get(collection)
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            evidence = item.get('source_evidence')
            if not isinstance(evidence, list):
                continue
            for evidence_item in evidence:
                if not isinstance(evidence_item, dict):
                    continue
                quote = evidence_item.get('quote')
                if not isinstance(quote, str) or not quote or quote in source_text:
                    continue
                anchored = reanchor_quote_to_source(quote, source_text)
                if anchored is not None and anchored != quote:
                    evidence_item['quote'] = anchored
                    changes += 1
    return out, changes
