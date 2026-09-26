# Python 3.11 startup hotfix — 2026-09-20

## Root cause

`runtime/shot_manifest.py` rendered dialogue with an f-string expression containing an escaped quote inside `{...}`:

```python
line.strip('“”\"')
```

Python 3.11 rejects backslashes inside f-string expressions during module import, so `uvicorn` failed before the FastAPI app could start.

## Fix

Quote normalization is computed before entering the f-string:

```python
clean_line = line.strip("“”\"")
lines.append(f"{_char_name(story, ref)}（{mode}）：“{clean_line}”")
```

No business contract, stage behavior, or prompt semantics changed.

## Regression coverage

Added a test that renders an already-quoted dialogue line and verifies the final text contains exactly one pair of Chinese quotation marks.

Final package acceptance must run against a freshly extracted ZIP, not only the source working directory:

- `python -m compileall`
- full `pytest`
- `scripts/serve.py`
- `GET /api/health`
