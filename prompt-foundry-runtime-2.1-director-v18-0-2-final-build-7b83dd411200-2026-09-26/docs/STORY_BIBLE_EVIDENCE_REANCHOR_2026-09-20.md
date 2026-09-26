# Story Bible evidence re-anchor — 2026-09-20

## Failure reproduced

Stage `story_bible` could pause after its single model Repair with `evidence_quote_not_in_source` even when the evidence preserved the source wording but collapsed source newlines/whitespace or changed typographic quote glyphs.

Typical failing shape:

- model quote joins adjacent source lines into one JSON string;
- or model emits `‘…’` while source contains `“…”`;
- validator correctly requires the final stored quote to be an exact `source_text` substring;
- model Repair can repeat the same representation drift and the unit pauses.

## Engineering fix

Added `runtime/source_evidence.py` with a conservative deterministic re-anchor step before Story Bible validation.

It may only ignore:

1. Unicode whitespace/newline differences;
2. typographic quote-glyph differences.

A normalized match must be unique. When it is unique, the runtime replaces the model quote with the exact original source span before validation. The final Story Bible therefore still stores an exact `source_text` substring.

The re-anchor deliberately does **not** normalize words, numbers, sentence order, ordinary punctuation, or semantic paraphrases. Ambiguous matches are not accepted.

The Story Bible Repair prompt was also tightened: `evidence_quote_not_in_source` must replace only the failing quote with a shortest contiguous literal source excerpt and must not concatenate separated text.

## Verification

- Exact source substring contract remains unchanged.
- Newline-collapsed evidence: re-anchored.
- Quote-glyph drift: re-anchored.
- Semantic paraphrase: rejected.
- Ambiguous normalized match: rejected.
- Runtime integration: representation-only evidence drift completes with `repair_count == 0`.
- Full test suite: 343 passed.
- Python compileall: passed.
- Web JS syntax check: passed.

Build ID: `e0891353adae`.
