from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Iterable

_NORMALIZE_RE = re.compile(r"[\s，。！？；：、‘’“”\"'（）()【】\[\]<>《》]+")


def normalize_authority_text(value: object) -> str:
    return _NORMALIZE_RE.sub("", str(value or "")).casefold()


def bigram_coverage(target: str, authority: str) -> float:
    if not target:
        return 0.0
    if len(target) < 2:
        return 1.0 if target in authority else 0.0
    grams = [target[i:i + 2] for i in range(len(target) - 1)]
    return sum(1 for gram in grams if gram in authority) / max(1, len(grams))


def text_is_anchored(
    target: object,
    authorities: Iterable[object],
    *,
    ratio_threshold: float = 0.50,
    bigram_threshold: float = 0.45,
) -> bool:
    """Conservative deterministic semantic-text anchor.

    This is not a semantic model. It accepts exact/substantial paraphrase overlap and
    rejects clearly unrelated invented actions. It is intentionally used only where
    upstream text is already the factual authority and free-form downstream wording
    must not introduce a new event.
    """
    target_n = normalize_authority_text(target)
    if not target_n:
        return False
    authority_values = [normalize_authority_text(x) for x in authorities]
    authority_values = [x for x in authority_values if x]
    if not authority_values:
        return False
    combined = "".join(authority_values)
    if target_n in combined:
        return True
    # Compare both against individual anchors and their combined local authority.
    candidates = [*authority_values, combined]
    for authority in candidates:
        if SequenceMatcher(None, target_n, authority).ratio() >= ratio_threshold:
            return True
        if bigram_coverage(target_n, authority) >= bigram_threshold:
            return True
    return False

def reanchor_quote_to_authorities(quote: object, authorities: Iterable[object]) -> str | None:
    """Return one exact authority string for representation-only evidence drift.

    This intentionally does not perform semantic/fuzzy repair. It only accepts an
    exact raw substring or a unique normalized punctuation/whitespace-equivalent
    authority. Returning the full authority string keeps downstream evidence exact.
    """
    if not isinstance(quote, str) or not quote.strip():
        return None
    authority_strings = [str(x) for x in authorities if isinstance(x, str) and str(x).strip()]
    exact = [text for text in authority_strings if quote in text]
    if len(exact) == 1:
        authority = exact[0]
        # If the only difference is punctuation/whitespace at the authority boundary,
        # restore the exact authoritative string. A genuinely smaller exact subphrase
        # remains a valid exact quote.
        if quote != authority and normalize_authority_text(quote) == normalize_authority_text(authority):
            return authority
        return quote
    if len(exact) > 1:
        return None
    qn = normalize_authority_text(quote)
    if not qn:
        return None
    matches: list[str] = []
    for text in authority_strings:
        an = normalize_authority_text(text)
        if not an:
            continue
        if qn == an or (qn in an and len(qn) / max(1, len(an)) >= 0.60):
            matches.append(text)
    unique: list[str] = []
    for text in matches:
        if text not in unique:
            unique.append(text)
    return unique[0] if len(unique) == 1 else None

