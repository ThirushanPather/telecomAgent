"""
Deterministic campaign rules engine — ported from runRulesEngine() and
buildReasoningSteps() in poc/routes/agent2.js.

Pure Python, no AI, no I/O. Called by:
  - the recommend_campaign @tool (agent loop)
  - the bulk_recommend helper (no-AI path for multiple subscribers)
  - the /api/agent2/recommend-bulk route directly
"""

from data.subscribers import get_subscriber_by_id


# ── Rules engine ──────────────────────────────────────────────────────────────

def recommend_action(subscriber_id: str) -> dict:
    """Run the Vodacom lifecycle rules engine for a single subscriber.

    Returns a structured recommendation dict matching the JS runRulesEngine() output.
    """
    sub = get_subscriber_by_id(subscriber_id)
    if not sub:
        return {"status": "error", "message": f"Subscriber {subscriber_id} not found."}

    days = sub["days_overdue"]
    type_ = sub["account_type"]

    # ── Compliance checks (take priority over lifecycle stage) ────────────────

    if sub["balance_owed"] < 200:
        return {
            "status": "success",
            "subscriber_id": subscriber_id,
            "subscriber_name": sub["name"],
            "days_overdue": days,
            "account_type": type_,
            "balance_owed": sub["balance_owed"],
            "recommended_action": (
                "Flag for small balance write-off consideration. "
                "No aggressive collections action is warranted at this balance level."
            ),
            "campaign_type": "SMALL_BALANCE_WRITE_OFF",
            "urgency": "LOW",
            "compliant": True,
            "reasoning": (
                f"Balance of R{sub['balance_owed']} is below the R200 threshold. "
                "The cost of collections action exceeds the recoverable amount. "
                "Flag for write-off review rather than initiating any outreach campaign."
            ),
        }

    if sub["open_epix_tickets"]:
        return {
            "status": "success",
            "subscriber_id": subscriber_id,
            "subscriber_name": sub["name"],
            "days_overdue": days,
            "account_type": type_,
            "balance_owed": sub["balance_owed"],
            "recommended_action": (
                "Place account on EPIX hold. Resolve the open billing ticket "
                "before initiating any collections campaign."
            ),
            "campaign_type": "EPIX_HOLD",
            "urgency": "LOW",
            "compliant": True,
            "reasoning": (
                "An open EPIX billing ticket is present on this account. "
                "Initiating aggressive collections action while a billing dispute is "
                "unresolved is non-compliant. The billing query must be resolved first "
                "before any outreach or restrictions are applied."
            ),
        }

    # ── BROKEN_PTP modifier ───────────────────────────────────────────────────

    effective_days = days + 15 if sub["last_response"] == "BROKEN_PTP" else days
    broken_ptp_note = (
        " Previous promise to pay was broken, escalating to the next campaign tier."
        if sub["last_response"] == "BROKEN_PTP"
        else ""
    )

    # ── Lifecycle stage + account-type rules ──────────────────────────────────

    if effective_days <= 15:
        if type_ in ("FPD", "HIGH_RISK"):
            recommended_action = (
                "Trigger early predictive campaign. "
                "Initiate outbound call and send SMS with payment portal link."
            )
            campaign_type = "EARLY_CAMPAIGN"
            urgency = "MEDIUM"
            reasoning = (
                f"Account is {days} days overdue with a {type_} risk profile.{broken_ptp_note} "
                "Early campaign intervention is required to prevent further default at this profile level."
            )
        else:
            recommended_action = (
                "Direct customer to self-help channels. "
                "Send SMS with secure payment portal link."
            )
            campaign_type = "SELF_HELP"
            urgency = "LOW"
            reasoning = (
                f"Account is {days} days overdue.{broken_ptp_note} "
                "Standard profile at this stage warrants a self-help nudge before any escalation is considered."
            )

    elif effective_days <= 30:
        if type_ in ("FPD", "NVP"):
            recommended_action = (
                "Apply soft lock to the account. "
                "Send warning letter. Initiate bureau update process."
            )
            campaign_type = "SOFT_LOCK"
            urgency = "HIGH"
            reasoning = (
                f"{type_} account at {days} days overdue.{broken_ptp_note} "
                "Soft lock and bureau notice are the mandated lifecycle actions for this profile "
                "at this stage to prompt immediate payment."
            )
        elif type_ == "HIGH_RISK":
            recommended_action = (
                "Activate active predictive dialler campaign. "
                "Send combined SMS and email outreach."
            )
            campaign_type = "ACTIVE_CAMPAIGN"
            urgency = "HIGH"
            reasoning = (
                f"HIGH_RISK account at {days} days overdue.{broken_ptp_note} "
                "Active multi-channel outreach is required before the suspension threshold is reached."
            )
        else:
            recommended_action = (
                "Run SMS and email campaign. "
                "Issue warning letter of pending service suspension."
            )
            campaign_type = "ACTIVE_CAMPAIGN"
            urgency = "MEDIUM"
            reasoning = (
                f"Account is {days} days overdue.{broken_ptp_note} "
                "Multi-channel outreach with a suspension warning is the standard lifecycle action at this stage."
            )

    elif effective_days <= 60:
        if type_ in ("NVP", "HIGH_RISK"):
            recommended_action = (
                "Initiate external trace. Suspend service. Escalate to hard collections team."
            )
            campaign_type = "TRACE"
            urgency = "HIGH"
            reasoning = (
                f"{type_} account at {days} days overdue.{broken_ptp_note} "
                "External trace is prioritised for this profile. "
                "Service suspension is enforced at this lifecycle stage."
            )
        elif type_ == "TUC":
            recommended_action = (
                "Trigger TUC conversion campaign. "
                "Offer a recharge plan to retain the subscriber."
            )
            campaign_type = "TUC_CONVERSION"
            urgency = "MEDIUM"
            reasoning = (
                f"TUC subscriber at {days} days overdue.{broken_ptp_note} "
                "A conversion campaign may recover the account without escalating to hard collections."
            )
        else:
            recommended_action = (
                "Run EC Suspended campaign. "
                "Send final notice before transition to hard collections."
            )
            campaign_type = "EC_SUSPEND"
            urgency = "MEDIUM"
            reasoning = (
                f"Account is {days} days overdue.{broken_ptp_note} "
                "EC Suspend campaign is the standard lifecycle action at this stage before hard collections handover."
            )

    elif effective_days <= 90:
        neverpaid_note = " Trigger 90-day neverpaid campaign." if type_ == "NVP" else ""
        bureau_note = (
            " Bureau listing already in place — skip bureau update."
            if sub["bureau_listed"]
            else " Update bureau listing."
        )
        recommended_action = (
            f"Remove debit order.{neverpaid_note} Initiate hard collections.{bureau_note}"
        )
        campaign_type = "HARD_COLLECTIONS"
        urgency = "HIGH"
        reasoning = (
            f"Account is {days} days overdue.{broken_ptp_note} "
            "Hard collections lifecycle applies. Debit order removal is mandatory at this stage. "
            + (
                "Bureau listing is already in place."
                if sub["bureau_listed"]
                else "Bureau update is required as part of the hard collections process."
            )
        )

    elif effective_days <= 218:
        recommended_action = (
            "Issue final letter of demand. "
            "Initiate PLEA DCA pre-legal allocation. Assign trace campaign."
        )
        campaign_type = "PRE_LEGAL"
        urgency = "CRITICAL"
        reasoning = (
            f"Account is {days} days overdue.{broken_ptp_note} "
            "Pre-legal handover is the mandated lifecycle step. "
            "A final letter of demand and DCA allocation must be initiated immediately."
        )

    else:
        dca_level = sub["dca_placement"] or 1
        recommended_action = (
            f"Escalate DCA placement to level {dca_level}. "
            "Apply escalating settlement pressure. "
            "Initiate legal proceedings assessment."
        )
        campaign_type = "LEGAL"
        urgency = "CRITICAL"
        reasoning = (
            f"Account is {days} days overdue at DCA level {dca_level}.{broken_ptp_note} "
            "Legal stage requires maximum collection pressure. "
            "Escalating DCA placement and litigation assessment are the required actions."
        )

    return {
        "status": "success",
        "subscriber_id": subscriber_id,
        "subscriber_name": sub["name"],
        "days_overdue": days,
        "account_type": type_,
        "balance_owed": sub["balance_owed"],
        "bureau_listed": sub["bureau_listed"],
        "open_epix_tickets": sub["open_epix_tickets"],
        "last_response": sub["last_response"],
        "recommended_action": recommended_action,
        "campaign_type": campaign_type,
        "urgency": urgency,
        "compliant": True,
        "reasoning": reasoning,
    }


# ── Reasoning steps builder ───────────────────────────────────────────────────

def build_reasoning_steps(sub: dict, rec: dict) -> list[str]:
    """Build a deterministic step-by-step reasoning narrative.

    Ported from buildReasoningSteps() in agent2.js.
    Used by the single-subscriber AI mode to populate the frontend reasoning panel.
    """
    steps: list[str] = []

    steps.append(
        f"Profile loaded: {sub['name']} | {sub['account_type']} account | "
        f"{sub['days_overdue']}d overdue | R{float(sub['balance_owed']):.2f} balance."
    )

    if sub["balance_owed"] < 200:
        steps.append(
            f"Balance R{sub['balance_owed']} is below the R200 threshold. "
            "Collections cost exceeds recovery value."
        )
        steps.append(
            "Compliance rule applied: flag for small balance write-off. "
            "No outreach campaign recommended."
        )
        steps.append(f"Final recommendation: {rec['campaign_type']} | Urgency: {rec['urgency']}.")
        return steps

    if sub["open_epix_tickets"]:
        steps.append(
            "Open EPIX billing ticket detected. Initiating collections action during an "
            "active billing dispute is non-compliant."
        )
        steps.append(
            "Compliance rule applied: place account on EPIX hold until billing query is resolved."
        )
        steps.append(f"Final recommendation: {rec['campaign_type']} | Urgency: {rec['urgency']}.")
        return steps

    effective_days = (
        sub["days_overdue"] + 15
        if sub["last_response"] == "BROKEN_PTP"
        else sub["days_overdue"]
    )

    if sub["last_response"] == "BROKEN_PTP":
        steps.append(
            f"BROKEN_PTP modifier applied: previous promise to pay was broken. "
            f"Effective days set to {effective_days} (actual: {sub['days_overdue']})."
        )
    else:
        steps.append(
            f"Last response: {sub['last_response']}. "
            f"No broken-PTP modifier required. Effective days: {effective_days}."
        )

    if effective_days <= 15:
        stage_name = "Days 1-15 (early stage)"
    elif effective_days <= 30:
        stage_name = "Days 16-30 (warning stage)"
    elif effective_days <= 60:
        stage_name = "Days 31-60 (suspension stage)"
    elif effective_days <= 90:
        stage_name = "Days 61-90 (hard collections)"
    elif effective_days <= 218:
        stage_name = "Days 91-218 (pre-legal)"
    else:
        stage_name = "Days 219+ (legal / DCA)"

    steps.append(
        f"Lifecycle stage: {stage_name}. "
        f"Applying {sub['account_type']} account type modifiers."
    )
    steps.append(
        "Bureau listed: "
        + ("yes — skip bureau update" if sub["bureau_listed"] else "no — bureau update may be required")
        + "."
    )
    steps.append(f"Campaign selected: {rec['campaign_type']} | Urgency: {rec['urgency']}.")
    steps.append(f"Recommended action: {rec['recommended_action']}")

    return steps
