"""
Call Center Agent tools — ported from poc/routes/agent1.js executeTool().

Each function is decorated with @tool so Strands can expose it to the LLM.
Tool calls are captured per-request via a contextvars.ContextVar so the
API response can include a tool_calls activity feed for the frontend.
"""

import contextvars
import random
import uuid
from datetime import date, timedelta
from datetime import datetime

from strands import tool

from data.subscribers import get_subscriber_by_account, update_subscriber
from data.rpa_log import append_rpa_action

# ── Per-request tool call capture ────────────────────────────────────────────
# Set by invoke_call_center_agent before each agent call; reset after.

_tool_calls_ctx: contextvars.ContextVar[list | None] = contextvars.ContextVar(
    "_tool_calls", default=None
)


def _capture(name: str, args: dict, result: dict) -> None:
    calls = _tool_calls_ctx.get()
    if calls is not None:
        calls.append({"name": name, "args": args, "result": result})


# ── Helpers ───────────────────────────────────────────────────────────────────

def _ref() -> str:
    ts = int(datetime.now().timestamp() * 1000)
    rand = uuid.uuid4().hex[:4].upper()
    return f"REF-{ts}-{rand}"


def _date_from_today(offset_days: int) -> str:
    return (date.today() + timedelta(days=offset_days)).isoformat()


_PLAN_BY_TYPE = {
    "STANDARD": "Vodacom Smart M (500MB + Unlimited WhatsApp)",
    "NVP":      "Vodacom Smart S (200MB)",
    "FPD":      "Vodacom Smart S (200MB)",
    "HIGH_RISK":"Vodacom Red (10GB + Unlimited Calls)",
    "TUC":      "Vodacom Smart XL (5GB)",
}

# ── Tools ─────────────────────────────────────────────────────────────────────

@tool
def verify_customer_pcc(account_number: str) -> dict:
    """Queries the PCC billing system to verify a customer's identity and retrieve their
    account details. Must be called before any account information is discussed.
    Required for POPIA compliance.

    Args:
        account_number: The customer's Vodacom account number (e.g. VDC-123456789).

    Returns:
        dict: Verification result with account details or a not_found status.
    """
    sub = get_subscriber_by_account(account_number)
    if not sub:
        result = {
            "status": "not_found",
            "message": "No account found matching that account number. Please ask the customer to confirm their account number.",
        }
    else:
        result = {
            "status": "verified",
            "name": sub["name"],
            "account_number": sub["account_number"],
            "balance_owed": sub["balance_owed"],
            "days_overdue": sub["days_overdue"],
            "service_status": sub["service_status"],
            "account_type": sub["account_type"],
            "plan": _PLAN_BY_TYPE.get(sub["account_type"], "Vodacom Smart M"),
            "due_date": _date_from_today(-sub["days_overdue"]),
            "bureau_listed": sub["bureau_listed"],
            "dca_placement": sub["dca_placement"],
        }
    _capture("verify_customer_pcc", {"account_number": account_number}, result)
    return result


@tool
def check_epix_status(account_number: str) -> dict:
    """Queries the EPIX system for open service tickets, network status, and unbilled
    data for the account. Call this when a customer disputes their bill or reports a
    service issue.

    Args:
        account_number: The customer's Vodacom account number.

    Returns:
        dict: EPIX status including open tickets and network health.
    """
    sub = get_subscriber_by_account(account_number)
    if not sub:
        result = {"status": "error", "message": "Account not found in EPIX."}
    else:
        has_ticket = sub["open_epix_tickets"]
        result = {
            "status": "success",
            "account_number": sub["account_number"],
            "open_tickets": 1 if has_ticket else 0,
            "ticket_reference": f"TKT-{sub['id']}-001" if has_ticket else None,
            "ticket_description": (
                "Billing query: customer reported incorrect charge on last invoice."
                if has_ticket else None
            ),
            "network_status": (
                "Fully Operational"
                if sub["service_status"] == "ACTIVE"
                else "Service impacted due to account status"
            ),
            "unbilled_data": f"{random.uniform(0, 3):.1f} GB",
            "last_bill_date": _date_from_today(-30),
        }
    _capture("check_epix_status", {"account_number": account_number}, result)
    return result


@tool
def create_payment_arrangement(
    account_number: str,
    monthly_amount: float,
    num_months: int,
) -> dict:
    """Creates a formal payment arrangement (instalment plan) for an overdue account.
    Use this when the customer cannot pay in full but agrees to fixed monthly payments.

    Args:
        account_number: The customer's Vodacom account number.
        monthly_amount: The agreed monthly instalment amount in Rands.
        num_months: The number of months over which the balance will be paid.

    Returns:
        dict: Confirmation with reference number and first payment date.
    """
    sub = get_subscriber_by_account(account_number)
    if not sub:
        result = {"status": "error", "message": "Account not found."}
    else:
        total = round(monthly_amount * num_months, 2)
        arrangement = {
            "type": "payment_arrangement",
            "account_number": account_number,
            "monthly_amount": monthly_amount,
            "num_months": num_months,
            "total_committed": total,
            "first_payment_date": _date_from_today(7),
            "reference": _ref(),
            "logged_at": datetime.now().isoformat(),
        }
        append_rpa_action(arrangement)
        update_subscriber(sub["id"], {
            "last_response": "PTP",
            "last_contact_date": _date_from_today(0),
        })
        result = {
            "status": "success",
            "message": (
                f"Payment arrangement created. {num_months} monthly payments of "
                f"R{monthly_amount}. First payment due {arrangement['first_payment_date']}."
            ),
            "reference": arrangement["reference"],
        }
    _capture(
        "create_payment_arrangement",
        {"account_number": account_number, "monthly_amount": monthly_amount, "num_months": num_months},
        result,
    )
    return result


@tool
def record_promise_to_pay(
    account_number: str,
    promise_date: str,
    amount: float,
) -> dict:
    """Records a customer's verbal commitment to pay a specific amount by a specific date.
    Use when the customer agrees to pay but cannot do so right now.

    Args:
        account_number: The customer's Vodacom account number.
        promise_date: The date the customer has committed to pay, in YYYY-MM-DD format.
        amount: The amount the customer has committed to pay in Rands.

    Returns:
        dict: Confirmation with reference number.
    """
    sub = get_subscriber_by_account(account_number)
    if not sub:
        result = {"status": "error", "message": "Account not found."}
    else:
        ptp = {
            "type": "promise_to_pay",
            "account_number": account_number,
            "promise_date": promise_date,
            "amount": amount,
            "reference": _ref(),
            "logged_at": datetime.now().isoformat(),
        }
        append_rpa_action(ptp)
        update_subscriber(sub["id"], {
            "last_response": "PTP",
            "last_contact_date": _date_from_today(0),
        })
        result = {
            "status": "success",
            "message": f"Promise to pay recorded. Customer has committed to pay R{amount} by {promise_date}.",
            "reference": ptp["reference"],
        }
    _capture(
        "record_promise_to_pay",
        {"account_number": account_number, "promise_date": promise_date, "amount": amount},
        result,
    )
    return result


@tool
def apply_account_extension(
    account_number: str,
    extension_days: int,
) -> dict:
    """Applies a payment due date extension to an account. Only valid when the account
    is fewer than 30 days overdue. Do not offer or attempt this for accounts 30 or more
    days overdue.

    Args:
        account_number: The customer's Vodacom account number.
        extension_days: Number of additional days to extend the due date. Maximum 14.

    Returns:
        dict: Confirmation with new due date and reference number.
    """
    sub = get_subscriber_by_account(account_number)
    if not sub:
        result = {"status": "error", "message": "Account not found."}
    elif sub["days_overdue"] >= 30:
        result = {
            "status": "error",
            "message": (
                f"Extension not available. Account is {sub['days_overdue']} days overdue. "
                "Extensions are only available for accounts fewer than 30 days overdue."
            ),
        }
    else:
        days = min(extension_days, 14)
        new_due_date = _date_from_today(days)
        extension = {
            "type": "account_extension",
            "account_number": account_number,
            "extension_days": days,
            "new_due_date": new_due_date,
            "reference": _ref(),
            "logged_at": datetime.now().isoformat(),
        }
        append_rpa_action(extension)
        result = {
            "status": "success",
            "message": f"Extension of {days} days applied. New payment due date is {new_due_date}.",
            "new_due_date": new_due_date,
            "reference": extension["reference"],
        }
    _capture(
        "apply_account_extension",
        {"account_number": account_number, "extension_days": extension_days},
        result,
    )
    return result


@tool
def send_payment_link(
    account_number: str,
    channel: str,
) -> dict:
    """Sends a secure payment link to the customer via SMS or email. Use this whenever
    the customer agrees to pay. Never collect payment details verbally — always use this
    tool instead.

    Args:
        account_number: The customer's Vodacom account number.
        channel: Delivery channel for the payment link. Must be SMS or EMAIL.

    Returns:
        dict: Confirmation with delivery destination, reference number, and delivery status.
    """
    from integrations.email import send_payment_email        # noqa: PLC0415
    from integrations.whatsapp import send_whatsapp_message  # noqa: PLC0415

    sub = get_subscriber_by_account(account_number)
    if not sub:
        result = {"status": "error", "message": "Account not found."}
    else:
        ch = channel.upper() if channel else ""
        if ch not in ("SMS", "EMAIL"):
            result = {"status": "error", "message": "Channel must be SMS or EMAIL."}
        else:
            destination = (
                sub["msisdn"]
                if ch == "SMS"
                else sub["name"].split(" ")[0].lower() + "@vodacom.co.za"
            )
            reference = _ref()
            link = {
                "type": "payment_link",
                "account_number": account_number,
                "channel": ch,
                "destination": destination,
                "reference": reference,
                "logged_at": datetime.now().isoformat(),
            }
            append_rpa_action(link)

            # Fire real communication — errors are logged but never surface to the agent.
            if ch == "EMAIL":
                delivery = send_payment_email(
                    to_address=destination,
                    customer_name=sub["name"],
                    account_number=account_number,
                    amount=sub["balance_owed"],
                    days_overdue=sub["days_overdue"],
                    reference=reference,
                )
            else:
                delivery = send_whatsapp_message(
                    to_number=f"whatsapp:{sub['msisdn']}",
                    customer_name=sub["name"],
                    account_number=account_number,
                    amount=sub["balance_owed"],
                    reference=reference,
                )

            result = {
                "status": "success",
                "message": f"Secure payment link sent via {ch} to {destination}.",
                "reference": reference,
                "delivery": delivery,
            }
    _capture("send_payment_link", {"account_number": account_number, "channel": channel}, result)
    return result


@tool
def escalate_to_human_agent(
    account_number: str,
    reason: str,
    urgency: str,
) -> dict:
    """Escalates the call to a human collections agent. Use when: the customer requests
    a manager, the dispute cannot be resolved via tools, or the situation requires manual
    intervention.

    Args:
        account_number: The customer's Vodacom account number.
        reason: A brief description of why the escalation is needed.
        urgency: Urgency level: LOW, MEDIUM, or HIGH.

    Returns:
        dict: Escalation ticket details.
    """
    sub = get_subscriber_by_account(account_number)
    ticket_number = f"ESC-{str(int(datetime.now().timestamp() * 1000))[-6:]}"
    escalation = {
        "type": "escalation",
        "account_number": account_number,
        "reason": reason,
        "urgency": urgency,
        "ticket_number": ticket_number,
        "logged_at": datetime.now().isoformat(),
    }
    append_rpa_action(escalation)
    if sub:
        update_subscriber(sub["id"], {
            "last_response": "NO_ANSWER",
            "last_contact_date": _date_from_today(0),
        })
    result = {
        "status": "success",
        "message": f"Escalation raised. A human agent will contact the customer. Ticket: {ticket_number}.",
        "ticket_number": ticket_number,
        "urgency": urgency,
    }
    _capture(
        "escalate_to_human_agent",
        {"account_number": account_number, "reason": reason, "urgency": urgency},
        result,
    )
    return result


@tool
def log_call_outcome(
    account_number: str,
    outcome: str,
    notes: str,
) -> dict:
    """Logs the final outcome of the call. Must be called before every conversation ends
    without exception.

    Args:
        account_number: The customer's Vodacom account number.
        outcome: The call outcome. Must be one of: PAID, PTP, ARRANGEMENT, DISPUTE, ESCALATED, NO_RESOLUTION.
        notes: A brief summary of what was discussed and agreed on the call.

    Returns:
        dict: Confirmation that the outcome was logged.
    """
    valid_outcomes = {"PAID", "PTP", "ARRANGEMENT", "DISPUTE", "ESCALATED", "NO_RESOLUTION"}
    if outcome not in valid_outcomes:
        result = {
            "status": "error",
            "message": f"Invalid outcome. Must be one of: {', '.join(sorted(valid_outcomes))}.",
        }
    else:
        sub = get_subscriber_by_account(account_number)
        log = {
            "type": "call_outcome",
            "account_number": account_number,
            "outcome": outcome,
            "notes": notes,
            "logged_at": datetime.now().isoformat(),
        }
        append_rpa_action(log)
        if sub:
            response_map = {
                "PAID":          "PAID",
                "PTP":           "PTP",
                "ARRANGEMENT":   "PTP",
                "DISPUTE":       "DISPUTE",
                "ESCALATED":     "NO_ANSWER",
                "NO_RESOLUTION": "NO_ANSWER",
            }
            update_subscriber(sub["id"], {
                "last_response":      response_map[outcome],
                "last_contact_method": "CALL",
                "last_contact_date":  _date_from_today(0),
            })
        result = {
            "status": "success",
            "message": f"Call outcome logged: {outcome}.",
        }
    _capture(
        "log_call_outcome",
        {"account_number": account_number, "outcome": outcome, "notes": notes},
        result,
    )
    return result
