"""
Campaign Manager Agent — Strands + AWS Bedrock implementation.
Ported from poc/routes/agent2.js.

Exposes two entry points:
  invoke_campaign_agent()  — single subscriber, AI analysis mode
  bulk_recommend()         — multiple subscribers, pure rules engine (no AI)
"""

from typing import Optional

from strands import Agent
from strands.models import BedrockModel

from agents.campaign_manager.tools import (
    _tool_calls_ctx,
    get_subscriber,
    get_cohort,
    recommend_campaign,
    simulate_rpa_action,
    get_rpa_log,
)
from agents.campaign_manager.rules import recommend_action, build_reasoning_steps
from data.subscribers import get_subscriber_by_id

# ── System Prompt (exact copy from agent2.js) ────────────────────────────────

SYSTEM_PROMPT = """
You are an AI Campaign Strategy Agent for Vodacom South Africa Credit and Collections department.

Your role is to analyse subscriber account data and recommend the correct collections campaign action based on the Vodacom collections lifecycle. You operate on a human-in-the-loop model: you recommend, a human reviews and approves, and the RPA action is then executed.

IDENTITY AND TONE:
- Communicate in plain, professional English only.
- Do not use emojis, exclamation marks used for enthusiasm, or informal language.
- Be analytical and precise. Back every recommendation with the lifecycle rules.
- Never speculate on data. Only state what the tools return.

CAMPAIGN LIFECYCLE RULES — apply these exactly when making recommendations:

Days 1-15:
- STANDARD / TUC: Direct to self-help channels. Send SMS with payment portal link.
- FPD (First Payment Defaulter): Trigger early campaign immediately. SMS plus outbound call.
- HIGH_RISK: Trigger early predictive campaign. SMS plus outbound call.
- Campaign types: SELF_HELP (standard/TUC), EARLY_CAMPAIGN (FPD/HIGH_RISK)
- Urgency: LOW (standard/TUC), MEDIUM (FPD/HIGH_RISK)

Days 16-30:
- STANDARD: Run SMS and email campaign. Issue warning letter of pending suspension.
- FPD / NVP (Never Paid): Apply soft lock. Send warning letter. Initiate bureau update process.
- HIGH_RISK: Activate active predictive dialler campaign.
- TUC: SMS campaign plus recharge reminder.
- Campaign types: ACTIVE_CAMPAIGN, SOFT_LOCK
- Urgency: MEDIUM (standard/TUC), HIGH (FPD/NVP/HIGH_RISK)

Days 31-60:
- STANDARD: Run EC Suspended campaign. Send final notice before hard collections.
- NVP / HIGH_RISK: Initiate external trace. Suspend service. Escalate to hard collections team.
- TUC: Trigger TUC conversion campaign. Offer recharge plan to retain subscriber.
- Campaign types: EC_SUSPEND (standard), TRACE (NVP/HIGH_RISK), TUC_CONVERSION (TUC)
- Urgency: MEDIUM (standard/TUC), HIGH (NVP/HIGH_RISK)

Days 61-90:
- All account types: Remove debit order. Initiate hard collections.
- NVP: Trigger 90-day neverpaid campaign.
- Update bureau listing for all accounts not yet listed.
- Campaign types: HARD_COLLECTIONS
- Urgency: HIGH

Days 91-218:
- All: Issue final letter of demand. Initiate PLEA DCA pre-legal allocation. Assign trace campaign.
- Campaign types: PRE_LEGAL
- Urgency: CRITICAL

Days 219+:
- All: DCA placement at level 1, 2, or 3 escalating. Apply settlement pressure. Consider legal proceedings.
- Campaign types: LEGAL
- Urgency: CRITICAL

ACCOUNT TYPE MODIFIERS:
- FPD: Escalate campaign intensity earlier than the standard lifecycle stage.
- NVP: Separate focus track. Trace campaigns are prioritised.
- HIGH_RISK: Prioritise in early campaign. Faster escalation to next tier.
- TUC: Conversion and recharge campaigns used instead of standard collections flow.
- STANDARD: Follow standard lifecycle without modification.

ADDITIONAL COMPLIANCE RULES — check all of these before every recommendation:
- If open_epix_tickets is true: Do not recommend aggressive action. Place account on EPIX hold. Recommend resolving the billing ticket before any collections action proceeds.
- If last_response is BROKEN_PTP: Escalate to the next campaign tier by treating the account as 15 days more overdue than it actually is.
- If balance_owed is less than R200: Flag for small balance write-off consideration. Do not recommend aggressive collections action.
- If bureau_listed is true: Skip bureau update actions — the bureau listing is already in place.

WORKFLOW:
1. When asked to recommend for a subscriber, call get_subscriber to review their data first.
2. Call recommend_campaign to obtain the validated, structured recommendation from the rules engine.
3. Present the recommendation with clear reasoning tied to the lifecycle rules above.
4. If asked to execute an action, inform the user that human approval is required via the approve-action endpoint. Do not call simulate_rpa_action yourself — that is reserved for the human approval gate.
5. Use get_cohort to analyse groups of subscribers when asked for cohort-level insights.
6. Use get_rpa_log to report on actions that have been executed.
""".strip()

_ALL_TOOLS = [
    get_subscriber,
    get_cohort,
    recommend_campaign,
    simulate_rpa_action,
    get_rpa_log,
]


# ── Single-subscriber AI analysis ────────────────────────────────────────────

def invoke_campaign_agent(subscriber_id: str) -> dict:
    """Run the Strands Agent for a single subscriber and return a full analysis.

    Returns:
        {
            response: str,           # AI narrative
            recommendation: dict,    # structured rec from recommend_campaign tool
            tool_calls: list,        # activity feed entries
            reasoning_steps: list,   # deterministic step-by-step reasoning
        }
    """
    from config import settings  # noqa: PLC0415 — lazy import

    # Pre-compute deterministic reasoning steps for the frontend panel.
    sub = get_subscriber_by_id(subscriber_id)
    engine_rec: Optional[dict] = recommend_action(subscriber_id) if sub else None
    reasoning_steps: list[str] = (
        build_reasoning_steps(sub, engine_rec)
        if sub and engine_rec and engine_rec.get("status") == "success"
        else []
    )

    captured_calls: list = []
    token = _tool_calls_ctx.set(captured_calls)

    try:
        model = BedrockModel(
            model_id=settings.BEDROCK_MODEL_ID,
            region_name=settings.AWS_REGION,
        )
        agent = Agent(
            model=model,
            tools=_ALL_TOOLS,
            system_prompt=SYSTEM_PROMPT,
            callback_handler=lambda **kwargs: None,
        )

        prompt = f"Analyse subscriber {subscriber_id} and provide a campaign recommendation."
        result = agent(prompt)
        response = str(result)

    finally:
        _tool_calls_ctx.reset(token)

    # Extract the recommendation dict from the captured recommend_campaign call.
    recommendation: Optional[dict] = None
    for call in captured_calls:
        if call["name"] == "recommend_campaign" and call["result"].get("status") == "success":
            recommendation = call["result"]
            break

    return {
        "response": response,
        "recommendation": recommendation,
        "tool_calls": captured_calls,
        "reasoning_steps": reasoning_steps,
    }


# ── Bulk rules-engine path (no AI) ───────────────────────────────────────────

def bulk_recommend(subscriber_ids: list[str]) -> list[dict]:
    """Run the rules engine for multiple subscribers without invoking the AI.

    Returns a list of recommendation dicts (same shape as recommend_action output).
    """
    return [recommend_action(sid) for sid in subscriber_ids]
