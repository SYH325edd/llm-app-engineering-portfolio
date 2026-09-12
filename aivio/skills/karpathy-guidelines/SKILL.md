---
name: karpathy-guidelines
description: Use when writing, reviewing, or refactoring code in API Relay Console to avoid overcomplication, make surgical changes, surface assumptions, and define verifiable success criteria.
license: MIT
source: https://github.com/multica-ai/andrej-karpathy-skills
---

# Karpathy Guidelines

Behavioral coding guidelines adapted for API Relay Console.

## When To Use

Use this skill for any code change, code review, refactor, bug fix, or implementation plan in this repository.

## Core Rules

1. Think before coding.
2. Prefer the minimum code that solves the request.
3. Make surgical changes and leave unrelated code alone.
4. Define success criteria that can be verified.

## API Relay Console Application Notes

- Keep the local PowerShell server and static frontend architecture intact.
- Do not add package managers, build steps, or frameworks unless the user asks for a feature that clearly requires them.
- Preserve the client-local API key design.
- Keep provider-specific behavior in the existing request adaptation flow.
- Keep UI copy concise and make sure Chinese text remains UTF-8.

## Working Loop

1. Restate the user-visible goal.
2. Inspect the relevant file or behavior.
3. Make the smallest complete change.
4. Verify with the narrowest useful command or browser check.
5. Summarize the changed files and any remaining trade-offs.
