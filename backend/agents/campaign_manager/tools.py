"""
Campaign Manager Agent tools — ported from poc/routes/agent2.js executeTool().

Uses the same contextvars capture pattern as call_center/tools.py so the
API response can include a tool_calls activity feed for the frontend.

run_simulate_rpa() is also exported (without @tool wrapper) so the
/api/agent2/approve-action route can call it directly.
"""

import contextvars
import uuid
from datetime import datetime
from typing import Optional

from strands import tool

from data.subscribers import get_subscriber_by_id, get_all_subscribers
from data.rpa_log import append_rpa_action
from data.rpa_log import get_rpa_log as _get_rpa_log_data
from agents.campaign_manager.rules import recommend_action

# ── Per-request tool call capture ────────────────────────────────────────────

_tool_calls_ctx: contextvars.ContextVar[list | None] = contextvars.ContextVar(
    "_cm_tool_calls", default=None
)


def _capture(name: str, args: dict, result: dict) -> None:
    calls = _tool_calls_ctx.get()
    if calls is not None:
        calls.append({"name": name, "args": args, "result": result})


# ── Helpers ───────────────────────────────────────────────────────────────────

def _ref() -> str:
    ts = int(datetime.now().timestamp() * 1000)
    rand = uuid.uuid4().hex[:4].upper()
    return f"RPA-{ts}-{rand}"


_VALID_ACTION_TYPES = {
    "SEND_SMS", "SEND_EMAIL", "TRIGGER_CALL",
    "SOFT_LOCK", "SUSPEND", "SEND_LETTER",
    "ALLOCATE_DCA", "WRITE_OFF",
}


# ── Public RPA executor (called by both @tool and approve-action route) ───────

def run_simulate_rpa(
    subscriber_id: str,
    action_type: str,
    details: str = "",
) -> dict:
    """Core RPA simulation logic, usable outside the agent tool loop."""
    if action_type not in _VALID_ACTION_TYPES:
        return {
            "status": "error",
            "message": f"Invalid action_type. Must be one of: {', '.join(sorted(_VALID_ACTION_TYPES))}.",
        }

    sub = get_subscriber_by_id(subscriber_id)
    reference = _ref()

    action = {
        "reference": reference,
        "subscriber_id": subscriber_id,
        "subscriber_name": sub["name"] if sub else "Unknown",
        "action_type": action_type,
        "details": details or "",
        "status": "COMPLETED",
        "executed_at": datetime.now().isoformat(),
    }

    append_rpa_action(action)

    return {
        "status": "success",
        "reference": reference,
        "action_type": action_type,
        "subscriber_id": subscriber_id,
        "subscriber_name": sub["name"] if sub else "Unknown",
        "message": f"RPA action {action_type} executed for subscriber {subscriber_id}.",
        "executed_at": action["executed_at"],
    }


# ── Tools ─────────────────────────────────────────────────────────────────────

@tool
def get_subscriber(subscriber_id: str) -> dict:
    """Fetches a single subscriber record from the database by subscriber ID.
    Use this to review a subscriber's full profile before making a recommendation.

    Args:
        subscriber_id: The subscriber ID, e.g. SUB-001.

    Returns:
        dict: The subscriber record or an error status.
    """
    sub = get_subscriber_by_id(subscriber_id)
    if not sub:
        result = {"status": "error", "message": f"Subscriber {subscriber_id} not found."}
    else:
        result = {"status": "success", "subscriber": sub}
    _capture("get_subscriber", {"subscriber_id": subscriber_id}, result)
    return result


@tool
def get_cohort(
    days_overdue_min: Optional[int] = None,
    days_overdue_max: Optional[int] = None,
    account_type: Optional[str] = None,
    service_status: Optional[str] = None,
    last_response: Optional[str] = None,
) -> dict:
    """Filters subscribers by lifecycle criteria. Returns a list of matching subscribers.
    Use this when analysing groups or cohorts rather than individual accounts.

    Args:
        days_overdue_min: Minimum days overdue (inclusive). Omit to apply no lower bound.
        days_overdue_max: Maximum days overdue (inclusive). Omit to apply no upper bound.
        account_type: Filter by account type. One of: FPD, NVP, HIGH_RISK, TUC, STANDARD.
        service_status: Filter by service status. One of: ACTIVE, SOFT_LOCKED, SUSPENDED, DELETED.
        last_response: Filter by last contact response. One of: PAID, PTP, NO_ANSWER, DISPUTE, BROKEN_PTP, NONE.

    Returns:
        dict: Count and list of matching subscribers.
    """
    subs = get_all_subscribers()

    if days_overdue_min is not None:
        subs = [s for s in subs if s["days_overdue"] >= days_overdue_min]
    if days_overdue_max is not None:
        subs = [s for s in subs if s["days_overdue"] <= days_overdue_max]
    if account_type:
        subs = [s for s in subs if s["account_type"] == account_type]
    if service_status:
        subs = [s for s in subs if s["service_status"] == service_status]
    if last_response:
        subs = [s for s in subs if s["last_response"] == last_response]

    result = {"status": "success", "count": len(subs), "subscribers": subs}
    _capture(
        "get_cohort",
        {
            "days_overdue_min": days_overdue_min,
            "days_overdue_max": days_overdue_max,
            "account_type": account_type,
            "service_status": service_status,
            "last_response": last_response,
        },
        result,
    )
    return result


@tool
def recommend_campaign(subscriber_id: str) -> dict:
    """Runs the Vodacom campaign rules engine for a specific subscriber and returns a
    validated, structured campaign recommendation. Returns recommended_action,
    campaign_type, urgency (LOW|MEDIUM|HIGH|CRITICAL), reasoning, and a compliance flag.

    Args:
        subscriber_id: The subscriber ID to analyse.

    Returns:
        dict: Structured recommendation from the rules engine.
    """
    result = recommend_action(subscriber_id)
    _capture("recommend_campaign", {"subscriber_id": subscriber_id}, result)
    return result


@tool
def simulate_rpa_action(
    subscriber_id: str,
    action_type: str,
    details: str = "",
) -> dict:
    """Simulates and logs an RPA action for a subscriber after human approval. Records
    the action in the RPA action log with status COMPLETED and returns a reference number.
    Action types: SEND_SMS | SEND_EMAIL | TRIGGER_CALL | SOFT_LOCK | SUSPEND |
    SEND_LETTER | ALLOCATE_DCA | WRITE_OFF.

    Args:
        subscriber_id: The subscriber ID.
        action_type: The RPA action type. Must be one of the valid action types listed above.
        details: Optional notes or details about the action being executed.

    Returns:
        dict: Execution result with reference number and status.
    """
    result = run_simulate_rpa(subscriber_id, action_type, details)
    _capture(
        "simulate_rpa_action",
        {"subscriber_id": subscriber_id, "action_type": action_type, "details": details},
        result,
    )
    return result


@tool
def get_rpa_log() -> dict:
    """Returns all entries in the RPA action log. Use this to report on actions that
    have been executed.

    Returns:
        dict: Count and list of all logged RPA actions.
    """
    log = _get_rpa_log_data()
    result = {"status": "success", "count": len(log), "actions": log}
    _capture("get_rpa_log", {}, result)
    return result
