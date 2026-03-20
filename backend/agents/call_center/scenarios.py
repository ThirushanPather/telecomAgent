"""
Demo scenarios for Agent 1 — ported from the GET /scenarios route in agent1.js.
Scenarios are built dynamically from SUBSCRIBERS using the same predicates as
the JS version. The full subscriber object is included so the frontend can
inject it as accountContext on the first turn.
"""

from data.subscribers import SUBSCRIBERS


def _find(predicate, fallback_index: int = 0) -> dict:
    return next(
        (s for s in SUBSCRIBERS if predicate(s)),
        SUBSCRIBERS[fallback_index],
    )


SCENARIOS: list[dict] = [
    {
        "id": 1,
        "title": "Suspended line with open service ticket",
        "description": "Customer calls about a suspended line. EPIX has an open billing ticket.",
        "subscriber": _find(
            lambda s: s["service_status"] == "SUSPENDED" and s["open_epix_tickets"] is True
        ),
    },
    {
        "id": 2,
        "title": "Payment arrangement request",
        "description": "Customer is 30-60 days overdue and wants to set up a payment arrangement.",
        "subscriber": _find(
            lambda s: 30 <= s["days_overdue"] <= 60
        ),
    },
    {
        "id": 3,
        "title": "Disputed balance",
        "description": "Customer claims they have already paid and disputes the outstanding balance.",
        "subscriber": _find(
            lambda s: s["last_response"] == "DISPUTE" or s["open_epix_tickets"] is True,
            fallback_index=2,
        ),
    },
    {
        "id": 4,
        "title": "Promise to pay",
        "description": "Customer is 15-30 days overdue and wants to commit to paying by end of week.",
        "subscriber": _find(
            lambda s: 15 <= s["days_overdue"] <= 30
        ),
    },
    {
        "id": 5,
        "title": "Pre-legal escalation",
        "description": "Customer is 90+ days overdue, uncooperative, and requires pre-legal escalation.",
        "subscriber": _find(
            lambda s: s["days_overdue"] >= 90 and s["bureau_listed"] is True
        ),
    },
]
