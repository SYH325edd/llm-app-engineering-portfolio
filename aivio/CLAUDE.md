# CLAUDE.md

Project-level coding guidance for API Relay Console.

Adapted from the public `multica-ai/andrej-karpathy-skills` repository:
https://github.com/multica-ai/andrej-karpathy-skills

These instructions are intentionally conservative. For tiny edits, use judgment, but keep the same bias: understand first, edit narrowly, verify the result.

## Project Context

- This is a zero-dependency local API relay and work console.
- The server is `server.ps1`; keep it runnable with plain PowerShell.
- The frontend is static HTML/CSS/JavaScript under `public/`.
- API keys should remain browser-local unless the user explicitly asks to change the security model.
- Preserve the existing UTF-8 Chinese UI copy when editing user-facing text.
- Avoid adding build steps, package managers, frameworks, or external runtime dependencies unless the request truly needs them.

## 1. Think Before Coding

Before implementing:

- State assumptions explicitly when the request is ambiguous.
- If multiple interpretations exist, name the options instead of silently choosing a risky one.
- Push back gently when a simpler approach solves the real problem.
- If something is unclear enough to change the outcome, ask before editing.

## 2. Simplicity First

Write the minimum code that solves the requested problem:

- Do not add speculative features.
- Do not create abstractions for one-off code.
- Do not add configurability that was not requested.
- Do not broaden error handling beyond realistic failure modes.
- If a solution becomes large, look for the smaller local change first.

## 3. Surgical Changes

When editing existing files:

- Touch only the files required for the user-visible change.
- Match the local style, naming, and structure.
- Do not refactor adjacent code just because you noticed it.
- Remove only unused code introduced by your own change.
- Mention unrelated issues instead of cleaning them up opportunistically.

Every changed line should trace back to the current request.

## 4. Goal-Driven Execution

Turn work into verifiable goals:

- For bugs, identify the failing behavior first, then patch it.
- For features, define the expected user action and resulting behavior.
- For refactors, ensure behavior stays unchanged before and after.
- Run the narrowest useful verification available in this repo.

For multi-step work, use a short plan with a check beside each step.

## 5. API Relay Console Specific Checks

Before finishing a change:

- If `server.ps1` changed, run or syntax-check the PowerShell path you touched.
- If frontend behavior changed, load the local app and confirm the interaction.
- If provider request handling changed, verify OpenAI-compatible, Anthropic, and Gemini paths are not accidentally mixed.
- If copy text changed, check that it fits the current layout on desktop and mobile.
