# Story Bible Identity Authority v11

## Problem

`identity_lock` stores normalized stable identity attributes consumed downstream. Its values can be semantically entailed by local source evidence without sharing the source's surface wording. Treating every `identity_lock.*` value as a lexical `source_bound_fact` caused false hard failures (for example, a normalized occupation label derived from a source sentence describing the occupation).

## Authority correction

- `explicit_facts[]`: remains a hard source-bound factual surface.
- `visual_lock.*`: remains a hard source-bound visual fact.
- `identity_lock.*`: now uses `source_derived_attribute` authority.
  - valid local `source_refs` are mandatory;
  - `supports` coverage is mandatory;
  - evidence quotes remain program-materialized exact provenance;
  - weak lexical overlap is advisory only and is recorded as `story_bible_identity_lock_weak_lexical_anchor`;
  - weak lexical overlap does not trigger Repair or pause the run.

## Runtime behavior

Identity-lock values no longer drive deterministic evidence-window expansion because string overlap is not a valid semantic verifier for normalized categorical attributes. Missing/invalid provenance remains a hard failure. Unsupported `explicit_facts` remain hard failures.
