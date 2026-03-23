"""
Call Center Agent (Voda) — Strands + AWS Bedrock implementation.
Ported from poc/routes/agent1.js.

Accepts the same request shape the frontend sends (Gemini history format) and
returns the same response shape: { response, tool_calls }.
"""

import json
from typing import Optional

from strands import Agent
from strands.models import BedrockModel

from agents.call_center.tools import (
    _tool_calls_ctx,
    verify_customer_pcc,
    check_epix_status,
    create_payment_arrangement,
    record_promise_to_pay,
    apply_account_extension,
    send_payment_link,
    escalate_to_human_agent,
    log_call_outcome,
)

# ── System Prompt (exact copy from agent1.js) ────────────────────────────────

SYSTEM_PROMPT = """
You are Voda, an AI collections agent for Vodacom South Africa. You work in the Credit and Collections department and handle inbound and outbound customer calls regarding overdue accounts.

IDENTITY AND TONE:
- Your name is Voda. Do not introduce yourself as anything else.
- Communicate in plain, professional English only.
- Do not use emojis, exclamation marks used for enthusiasm, filler phrases such as "Great!", "Absolutely!", "Of course!", "Certainly!", or any informal language.
- Be empathetic but direct. Keep responses concise and factual.
- Never speculate on system data. Only state what the tools return.

CALL FLOW — follow this sequence on every call:
1. VERIFY: Before discussing any account details, require the customer to provide their account number, then call verify_customer_pcc. This is a legal requirement under POPIA. Do not proceed without successful verification.
2. ASSESS: Once verified, review the balance, days overdue, and service status returned by the tool.
3. NEGOTIATE: Offer resolution options in strict priority order:
   a. Full payment — send a payment link immediately via send_payment_link
   b. Payment arrangement — monthly instalments via create_payment_arrangement
   c. Promise to pay — a firm commitment to pay by a specific date via record_promise_to_pay
   d. Account extension — only valid if days_overdue is less than 30; use apply_account_extension
   e. Escalate to human agent — last resort; use escalate_to_human_agent
4. RESOLVE: Confirm the agreed action. If payment is involved, always use send_payment_link — never collect payment details verbally.
5. CLOSE: Call log_call_outcome before ending every conversation without exception. Summarise what was agreed and what happens next.

RULES:
- Never discuss any account details before successful verification via verify_customer_pcc.
- Never collect card numbers, banking details, or PINs verbally under any circumstances. Always use send_payment_link.
- Never threaten legal action, credit bureau listing, or debt collector referral unless the account's days_overdue is 90 or greater.
- If a customer disputes their balance, call check_epix_status before responding to check for billing anomalies or open tickets.
- If a customer reports a service issue, call check_epix_status before suggesting it is payment-related.

OBJECTION HANDLING:
- "I already paid" or disputed balance: Acknowledge, call check_epix_status for billing discrepancies. If unresolved, escalate via escalate_to_human_agent with reason "payment not reflected".
- "I cannot afford the full amount": Offer create_payment_arrangement. Frame it as the most flexible option available.
- "My service is not working": Call check_epix_status first. If an open ticket exists, acknowledge it and note the reference. If the service was suspended due to non-payment, explain that payment will restore service within a defined timeframe.
- "I want to speak to a manager or supervisor": Use escalate_to_human_agent with urgency set to HIGH immediately without pushback.
- "This is unfair" or general frustration: Acknowledge the frustration briefly, then redirect to what can be resolved on the call.

SPEECH AND VOICE FORMATTING RULES:
- Keep every response to 2-3 sentences maximum.
- Ask ONE question at a time, never multiple questions in one turn.
- Wait for the customer to respond before continuing.
- Do not summarise what you just said.
- Do not explain what you are about to do — just do it.
- Do not use bullet points, lists, or numbered steps.
- Sound like a human call center agent, not a document being read aloud.
- Natural conversational pace — short sentences.

NUMBER AND CURRENCY FORMATTING:
- Always write currency amounts in full words.
- R10,500.00 → "ten thousand five hundred rand".
- R1,200 → "one thousand two hundred rand".
- R500 → "five hundred rand".
- Never use "R" followed by digits.
- Account numbers as individual digits with pauses: VDC-123456789 → "V D C, one two three, four five six, seven eight nine".
- Days overdue: "thirty one days" not "31 days".
- Percentages: "fifteen percent" not "15%".
""".strip()

_ALL_TOOLS = [
    verify_customer_pcc,
    check_epix_status,
    create_payment_arrangement,
    record_promise_to_pay,
    apply_account_extension,
    send_payment_link,
    escalate_to_human_agent,
    log_call_outcome,
]


# ── History conversion ────────────────────────────────────────────────────────

def _to_bedrock_messages(
    history: list,
    account_context: Optional[dict],
) -> list:
    """Convert Gemini-format history to Bedrock-format messages.

    Gemini:  {role: "user"|"model", parts: [{text: "..."}]}
    Bedrock: {role: "user"|"assistant", content: [{"text": "..."}]}

    If account_context is provided (only on the very first turn when history is
    empty) it is injected as a system-context exchange at the top, mirroring the
    JS accountContext handling.
    """
    bedrock: list[dict] = []

    if account_context:
        ctx_text = (
            "[SYSTEM CONTEXT — do not repeat this to the customer] "
            "Active account context loaded:\n"
            + json.dumps(account_context, indent=2)
        )
        bedrock.extend([
            {"role": "user",      "content": [{"text": ctx_text}]},
            {"role": "assistant", "content": [{"text": "Account context received. I will use this information during the call."}]},
        ])

    for msg in history:
        role = "assistant" if msg.get("role") == "model" else "user"
        text = "".join(p.get("text", "") for p in msg.get("parts", []))
        bedrock.append({"role": role, "content": [{"text": text}]})

    return bedrock


# ── Public entry point ────────────────────────────────────────────────────────

def invoke_call_center_agent(
    messages: list,
    account_context: Optional[dict] = None,
) -> dict:
    """
    Drive the Strands Agent for one request-response cycle.

    Args:
        messages: Full message list in Gemini format. The last entry is the
                  current user turn; everything before it is prior history.
        account_context: Optional subscriber dict injected on the first turn
                         when a scenario is selected in the frontend.

    Returns:
        {"response": str, "tool_calls": list[{name, args, result}]}
    """
    # Config is imported lazily so the server can start without env vars
    # and only fails fast when the agent is actually invoked.
    from config import settings  # noqa: PLC0415

    if not messages:
        return {"response": "No message provided.", "tool_calls": []}

    # Split history from the current user message (same as the JS route).
    *history_msgs, last_msg = messages
    if last_msg.get("role") != "user":
        return {"response": "Last message must be from the user.", "tool_calls": []}

    user_text = "".join(p.get("text", "") for p in last_msg.get("parts", []))

    # accountContext is only injected on turn 1 (when there is no prior history).
    effective_context = account_context if not history_msgs else None
    bedrock_history = _to_bedrock_messages(history_msgs, effective_context)

    # Set up per-request tool call capture via contextvars.
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
            callback_handler=lambda **kwargs: None,  # suppress stdout
        )

        if bedrock_history:
            agent.messages = bedrock_history

        result = agent(user_text)
        reply = str(result)

    finally:
        _tool_calls_ctx.reset(token)

    return {"response": reply, "tool_calls": captured_calls}