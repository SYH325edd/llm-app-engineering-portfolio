from __future__ import annotations

import copy
from typing import Any

from prompt_foundry_v1_3.state_resolver import empty_state


CONTEXT_STATE_POLICY_VERSION = "scene_plan_context_stack.v1"


class ContextStateError(ValueError):
    pass


class ContextStateCursor:
    """Deterministically choose the previous dynamic state for each Scene.

    This is Runtime scheduling only. It does not change Frozen state shape or
    continuity semantics; it only chooses which validated context state becomes
    the `previous_state_out` input at a narrative-context boundary.
    """

    def __init__(self) -> None:
        self.active_context: str | None = None
        self._stack: list[tuple[str, dict[str, Any]]] = []
        self._state_by_context: dict[str, dict[str, Any]] = {}
        self._initialized = False

    def begin_scene(self, scene_plan_scene: dict[str, Any], current_state: dict[str, Any]) -> dict[str, Any]:
        context_ref = str(scene_plan_scene.get("context_ref") or "")
        transition = str(scene_plan_scene.get("context_transition") or "")
        resume_context_ref = str(scene_plan_scene.get("resume_context_ref") or "")
        current = copy.deepcopy(current_state or empty_state())

        if not self._initialized:
            if transition != "continue":
                raise ContextStateError("first Scene context_transition must be continue")
            self._initialized = True
            self.active_context = context_ref
            seed = copy.deepcopy(self._state_by_context.get(context_ref) or empty_state())
            self._state_by_context[context_ref] = copy.deepcopy(seed)
            return seed

        active = self.active_context if self.active_context is not None else ""
        self._state_by_context[active] = copy.deepcopy(current)

        if transition == "continue":
            if context_ref != active:
                raise ContextStateError(f"continue must keep active context {active!r}, got {context_ref!r}")
            return copy.deepcopy(current)

        if transition == "enter":
            if context_ref == active:
                raise ContextStateError("enter must change to a different context")
            self._stack.append((active, copy.deepcopy(current)))
            self.active_context = context_ref
            return copy.deepcopy(self._state_by_context.get(context_ref) or empty_state())

        if transition == "return":
            if not self._stack:
                raise ContextStateError("return requires a previously entered context")
            expected_context, expected_state = self._stack.pop()
            if context_ref != expected_context or resume_context_ref != expected_context:
                raise ContextStateError(
                    f"return must restore context {expected_context!r}, got context={context_ref!r}, resume={resume_context_ref!r}"
                )
            self.active_context = expected_context
            self._state_by_context[expected_context] = copy.deepcopy(expected_state)
            return copy.deepcopy(expected_state)

        if transition == "switch":
            if context_ref == active:
                raise ContextStateError("switch must change to a different context")
            # switch is permanent: old temporary-return frames are no longer valid.
            self._stack.clear()
            self.active_context = context_ref
            return copy.deepcopy(self._state_by_context.get(context_ref) or empty_state())

        raise ContextStateError(f"unsupported context_transition: {transition}")

    def finish_shot(self, state_out: dict[str, Any]) -> None:
        if self.active_context is None:
            raise ContextStateError("cannot finish shot before begin_scene")
        self._state_by_context[self.active_context] = copy.deepcopy(state_out or empty_state())

    def current_state(self) -> dict[str, Any]:
        if self.active_context is None:
            return empty_state()
        return copy.deepcopy(self._state_by_context.get(self.active_context) or empty_state())
