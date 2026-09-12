from __future__ import annotations

from lakejob.domain.schemas import ActionState


MESSAGE_TRANSITIONS = {
    ActionState.draft: {ActionState.pending_confirmation, ActionState.cancelled},
    ActionState.pending_confirmation: {
        ActionState.queued, ActionState.blocked_by_safety, ActionState.blocked_by_quota,
        ActionState.cancelled,
    },
    ActionState.queued: {ActionState.sending, ActionState.cancelled},
    ActionState.sending: {ActionState.sent, ActionState.failed},
}

APPLICATION_TRANSITIONS = {
    ActionState.draft: {ActionState.pending_confirmation, ActionState.cancelled},
    ActionState.pending_confirmation: {
        ActionState.applying, ActionState.blocked_by_safety, ActionState.blocked_by_quota,
        ActionState.cancelled,
    },
    ActionState.applying: {ActionState.applied, ActionState.failed},
}


def transition(current: str | ActionState, target: str | ActionState, *, kind: str) -> ActionState:
    current_state = ActionState(current)
    target_state = ActionState(target)
    transitions = MESSAGE_TRANSITIONS if kind == "message" else APPLICATION_TRANSITIONS
    if target_state not in transitions.get(current_state, set()):
        raise ValueError(f"invalid {kind} transition: {current_state.value} -> {target_state.value}")
    return target_state
