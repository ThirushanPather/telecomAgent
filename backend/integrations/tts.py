"""
ElevenLabs text-to-speech integration.

Returns raw MP3 bytes on success, or None when credentials are absent / API fails.
"""

import logging
import re

logger = logging.getLogger(__name__)

# Matches *action descriptions*, **bold**, and bare asterisks.
_MARKDOWN_RE = re.compile(r"\*+[^*]*\*+|\*+")


def _clean(text: str) -> str:
    """Strip markdown and action descriptions that sound bad when spoken."""
    return _MARKDOWN_RE.sub("", text).strip()


def synthesise_speech(text: str) -> bytes | None:
    """Convert text to MP3 audio via ElevenLabs.

    Returns:
        Raw MP3 bytes on success.
        None if credentials are missing or the API call fails.
    """
    from config import settings  # noqa: PLC0415

    if not settings.ELEVENLABS_API_KEY:
        logger.warning("[TTS] ELEVENLABS_API_KEY not set — skipping synthesis.")
        return None

    cleaned = _clean(text)
    if not cleaned:
        return None

    try:
        from elevenlabs.client import ElevenLabs  # noqa: PLC0415

        client = ElevenLabs(api_key=settings.ELEVENLABS_API_KEY)
        audio = client.text_to_speech.convert(
            voice_id=settings.ELEVENLABS_VOICE_ID,
            text=cleaned,
            model_id="eleven_turbo_v2",
            voice_settings={
                "stability": 0.5,
                "similarity_boost": 0.75,
            },
        )
        # SDK returns a generator of bytes chunks — join them.
        if hasattr(audio, "__iter__") and not isinstance(audio, (bytes, bytearray)):
            audio = b"".join(audio)
        logger.info("[TTS] Synthesised %d chars → %d bytes", len(cleaned), len(audio))
        return audio
    except Exception as exc:
        logger.error("[TTS] ElevenLabs API error: %s", exc)
        return None
