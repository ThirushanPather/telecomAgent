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

    def __setattr__(self, _name, _value):
        raise AttributeError("Settings is frozen")


settings = Settings()
