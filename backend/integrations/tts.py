"""
ElevenLabs text-to-speech integration.

Returns raw MP3 bytes on success, or None when credentials are absent / API fails.
"""

import logging
import re

logger = logging.getLogger(__name__)

# Matches *action descriptions*, **bold**, and bare asterisks.
_MARKDOWN_RE = re.compile(r"\*+[^*]*\*+|\*+")
# Matches Rand amounts like R10,500.00 or R1200 or R500.50
_CURRENCY_RE = re.compile(r"R(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)")

_ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight",
         "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
         "sixteen", "seventeen", "eighteen", "nineteen"]
_TENS = ["", "", "twenty", "thirty", "forty", "fifty",
         "sixty", "seventy", "eighty", "ninety"]


def _int_to_words(n: int) -> str:
    if n == 0:
        return "zero"
    if n < 0:
        return "minus " + _int_to_words(-n)
    if n < 20:
        return _ONES[n]
    if n < 100:
        rest = (" " + _ONES[n % 10]) if n % 10 else ""
        return _TENS[n // 10] + rest
    if n < 1_000:
        rest = (" " + _int_to_words(n % 100)) if n % 100 else ""
        return _ONES[n // 100] + " hundred" + rest
    if n < 1_000_000:
        rest = (" " + _int_to_words(n % 1_000)) if n % 1_000 else ""
        return _int_to_words(n // 1_000) + " thousand" + rest
    rest = (" " + _int_to_words(n % 1_000_000)) if n % 1_000_000 else ""
    return _int_to_words(n // 1_000_000) + " million" + rest


def _currency_to_words(match: re.Match) -> str:
    raw = match.group(1).replace(",", "")
    try:
        amount = float(raw)
    except ValueError:
        return match.group(0)
    rands = int(amount)
    cents = round((amount - rands) * 100)
    result = _int_to_words(rands) + " rand"
    if cents:
        result += " and " + _int_to_words(cents) + " cents"
    return result


def _clean(text: str) -> str:
    """Strip markdown and normalise numbers/symbols that sound bad when spoken."""
    # Remove markdown: **bold**, *italic*, bare asterisks
    text = _MARKDOWN_RE.sub("", text)
    # Currency: R10,500.00 → "ten thousand five hundred rand"
    text = _CURRENCY_RE.sub(_currency_to_words, text)
    # Remaining special characters
    text = text.replace("##", "").replace("#", "")
    text = re.sub(r"[•\-–—] +", "", text)   # bullet/dash list markers
    text = text.replace("%", " percent")
    text = text.replace("&", " and")
    return text.strip()


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
