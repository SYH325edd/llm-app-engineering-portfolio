from __future__ import annotations

from typing import Any


def coerce_unambiguous_bool(value: Any) -> tuple[bool | None, bool]:
    """Normalize representation-only boolean drift without guessing semantics.

    Only exact JSON-like boolean encodings are accepted. Ambiguous/missing values
    return ``None`` so stage validators can keep enforcing the semantic contract.
    """
    if isinstance(value, bool):
        return value, False
    if isinstance(value, int) and not isinstance(value, bool) and value in (0, 1):
        return bool(value), True
    if isinstance(value, str):
        token = value.strip().lower()
        if token in {"true", "1"}:
            return True, True
        if token in {"false", "0"}:
            return False, True
    return None, False


def coerce_unambiguous_number(value: Any) -> tuple[int | float | None, bool]:
    """Normalize JSON-number representation drift without guessing semantics."""
    if isinstance(value, bool):
        return None, False
    if isinstance(value, (int, float)):
        return value, False
    if isinstance(value, str):
        token = value.strip()
        if not token:
            return None, False
        try:
            number = float(token)
        except ValueError:
            return None, False
        if not (number == number and number not in (float('inf'), float('-inf'))):
            return None, False
        if number.is_integer() and not any(ch in token.lower() for ch in ('.', 'e')):
            return int(number), True
        return number, True
    return None, False


def coerce_unambiguous_enum(value: Any, canonical_to_label: dict[str, str], aliases: dict[str, str] | None = None) -> tuple[str | None, bool]:
    """Normalize exact enum aliases/labels only; ambiguous free text remains invalid."""
    if not isinstance(value, str):
        return None, False
    raw = value.strip()
    if not raw:
        return None, False
    normalized = raw.casefold().replace('-', '_').replace(' ', '_')
    canonical_lookup = {str(key).casefold().replace('-', '_').replace(' ', '_'): str(key) for key in canonical_to_label}
    label_lookup = {str(label).strip().casefold(): str(key) for key, label in canonical_to_label.items()}
    alias_lookup = {str(key).strip().casefold(): str(val) for key, val in (aliases or {}).items()}
    if normalized in canonical_lookup:
        canonical = canonical_lookup[normalized]
    elif raw.casefold() in label_lookup:
        canonical = label_lookup[raw.casefold()]
    elif raw.casefold() in alias_lookup:
        canonical = alias_lookup[raw.casefold()]
    else:
        return None, False
    return canonical, canonical != value
