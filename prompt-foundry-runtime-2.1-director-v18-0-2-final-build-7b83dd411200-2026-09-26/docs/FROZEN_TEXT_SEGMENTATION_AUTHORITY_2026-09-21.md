# Frozen Text Segmentation Authority — 2026-09-21

## Problem

Storyboard legitimately splits one frozen Script dialogue/narration stream across multiple Shots. Model-generated split segments sometimes replace a source comma/semicolon with a sentence-ending punctuation mark so each Shot reads naturally. The lexical content is unchanged, but an exact joined-string validator then rejects the Unit.

## Authority decision

- Script owns dialogue/narration text, including source punctuation and whitespace.
- Storyboard owns only allocation: which consecutive Shot receives which contiguous part.
- Canonicalize may restore punctuation/whitespace from Script **only when the punctuation-insensitive lexical stream is exactly identical and in order**.
- Changed, missing, duplicated, reordered words or changed dialogue speaker remain hard failures.

## Implementation

1. `storyboard_scene.v14`.
2. Canonicalize groups narration by Beat and dialogue by Beat/source line.
3. It compares the punctuation-insensitive lexical stream against frozen Script authority.
4. If identical, it projects model-selected segment lengths back onto the exact Script text and replaces only representation drift.
5. Validator then continues using exact reconstruction.
6. Final Shot Consumption Manifest concatenates frozen narration segments without introducing new punctuation.

This keeps the validator strict while removing punctuation ownership from the model.
