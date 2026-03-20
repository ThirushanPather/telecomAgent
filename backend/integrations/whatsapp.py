"""
Twilio WhatsApp integration — ported from sendWhatsApp() in poc/routes/agent1.js.

Falls back to simulation mode silently when credentials are not configured.
"""

import logging
import os

logger = logging.getLogger(__name__)


def send_whatsapp_message(
    to_number: str,
    customer_name: str,
    account_number: str,
    amount: float,
    reference: str,
) -> dict:
    """Send a payment reminder via Twilio WhatsApp.

    Ports the exact message template from poc/routes/agent1.js.

    Args:
        to_number: Recipient number formatted as 'whatsapp:+27XXXXXXXXX'.

    Returns:
        { sent: bool, sid: str }          on success
        { sent: bool, simulated: bool }   when credentials absent
        { sent: bool, error: str }        on failure
    """
    account_sid = os.getenv("TWILIO_ACCOUNT_SID")
    auth_token = os.getenv("TWILIO_AUTH_TOKEN")
    from_number = os.getenv("TWILIO_WHATSAPP_FROM")
    # Honour a fixed test destination if configured; otherwise use subscriber number.
    destination = os.getenv("TWILIO_WHATSAPP_TO") or to_number

    if not account_sid or not auth_token or not from_number:
        logger.warning("[WhatsApp] Twilio credentials not set — simulating send.")
        return {"sent": False, "simulated": True}

    body = (
        f"Vodacom Credit & Collections: Dear {customer_name}, your account "
        f"{account_number} has an outstanding balance of R{float(amount):.2f}. "
        f"Please make payment at: https://pay.vodacom.co.za/{account_number} "
        f"- Reply HELP for assistance."
    )

    try:
        from twilio.rest import Client  # noqa: PLC0415 — lazy import to avoid startup cost
        client = Client(account_sid, auth_token)
        msg = client.messages.create(
            from_=from_number,
            to=destination,
            body=body,
        )
        logger.info("[WhatsApp] Sent SID=%s to %s (ref %s)", msg.sid, destination, reference)
        return {"sent": True, "simulated": False, "sid": msg.sid}
    except Exception as exc:
        logger.error("[WhatsApp] Failed: %s", exc)
        return {"sent": False, "error": str(exc)}
