"""
Gmail SMTP integration — ported from sendEmail() in poc/routes/agent1.js.

Uses Python's built-in smtplib/email.mime (no extra package required).
Falls back to simulation mode silently when credentials are not configured.
"""

import logging
import smtplib
from email.mime.text import MIMEText

import os

logger = logging.getLogger(__name__)


def send_payment_email(
    to_address: str,
    customer_name: str,
    account_number: str,
    amount: float,
    days_overdue: int,
    reference: str,
) -> dict:
    """Send a payment reminder email via Gmail SMTP.

    Ports the exact Nodemailer template from poc/routes/agent1.js.

    Returns:
        { sent: bool, simulated: bool }  on success/simulation
        { sent: bool, error: str }        on failure
    """
    gmail_user = os.getenv("GMAIL_USER")
    app_password = os.getenv("GMAIL_APP_PASSWORD")
    recipient = os.getenv("SMTP_RECIPIENT") or to_address

    if not gmail_user or not app_password:
        logger.warning("[Email] GMAIL_USER or GMAIL_APP_PASSWORD not set — simulating send.")
        return {"sent": False, "simulated": True}

    subject = f"Vodacom Account {account_number} — Payment Required"
    body = (
        f"Dear {customer_name},\n\n"
        f"This is a reminder that your Vodacom account {account_number} has an "
        f"outstanding balance of R{float(amount):.2f} which is {days_overdue} days overdue.\n\n"
        f"Please make payment immediately to avoid further action.\n\n"
        f"Payment link: https://pay.vodacom.co.za/{account_number}\n\n"
        f"If you have already made payment, please disregard this notice.\n\n"
        f"Vodacom Credit and Collections"
    )

    msg = MIMEText(body)
    msg["Subject"] = subject
    msg["From"] = gmail_user
    msg["To"] = recipient

    try:
        with smtplib.SMTP("smtp.gmail.com", 587) as smtp:
            smtp.ehlo()
            smtp.starttls()
            smtp.login(gmail_user, app_password)
            smtp.sendmail(gmail_user, recipient, msg.as_string())
        logger.info("[Email] Sent to %s (ref %s)", recipient, reference)
        return {"sent": True, "simulated": False}
    except Exception as exc:
        logger.error("[Email] Failed: %s", exc)
        return {"sent": False, "error": str(exc)}
