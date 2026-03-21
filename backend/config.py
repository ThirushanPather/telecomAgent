from dotenv import load_dotenv
import os

load_dotenv()


def _require(var: str) -> str:
    value = os.getenv(var)
    if not value:
        raise ValueError(f"Required environment variable missing: {var}")
    return value


class Settings:
    AWS_REGION: str = _require("AWS_REGION")
    BEDROCK_MODEL_ID: str = _require("BEDROCK_MODEL_ID")
    WEBHOOK_URL: str | None = os.getenv("WEBHOOK_URL")

    # Gmail SMTP — optional; falls back to simulation if absent
    GMAIL_USER: str | None = os.getenv("GMAIL_USER")
    GMAIL_APP_PASSWORD: str | None = os.getenv("GMAIL_APP_PASSWORD")
    SMTP_RECIPIENT: str | None = os.getenv("SMTP_RECIPIENT")

    # Twilio WhatsApp — optional; falls back to simulation if absent
    TWILIO_ACCOUNT_SID: str | None = os.getenv("TWILIO_ACCOUNT_SID")
    TWILIO_AUTH_TOKEN: str | None = os.getenv("TWILIO_AUTH_TOKEN")
    TWILIO_WHATSAPP_FROM: str | None = os.getenv("TWILIO_WHATSAPP_FROM")
    TWILIO_WHATSAPP_TO: str | None = os.getenv("TWILIO_WHATSAPP_TO")

    # ElevenLabs TTS — optional; returns None if absent
    ELEVENLABS_API_KEY: str | None = os.getenv("ELEVENLABS_API_KEY")
    ELEVENLABS_VOICE_ID: str = os.getenv("ELEVENLABS_VOICE_ID") or "YPtbPhafrxFTDAeaPP4w"

    def __setattr__(self, _name, _value):
        raise AttributeError("Settings is frozen")


settings = Settings()
