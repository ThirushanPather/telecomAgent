"""Nova Sonic phone call session via Strands BidiAgent."""

import asyncio
import base64
import json
import logging

from fastapi import WebSocket
from strands.experimental.bidi import BidiAgent
from strands.experimental.bidi.models import BidiNovaSonicModel
from strands.experimental.bidi.types.events import (
    BidiAudioInputEvent,
    BidiAudioStreamEvent,
    BidiResponseCompleteEvent,
    BidiTextInputEvent,
    BidiTranscriptStreamEvent,
    ToolUseStreamEvent,
)

logger = logging.getLogger(__name__)

CALL_CENTER_SYSTEM_PROMPT = """You are Voda, a professional Credit & Collections agent for Vodacom South Africa.

Follow this 5-step call flow:
1. Verify — Call verify_customer_pcc first before discussing any account information.
2. Assess — Check account status; use check_epix_status for service complaints or bill disputes.
3. Negotiate — Offer appropriate payment options based on the account situation.
4. Resolve — Create a payment arrangement, record a promise to pay, apply an extension, or send a payment link.
5. Close — Always call log_call_outcome before ending the conversation.

Rules:
- Never collect card or bank details verbally; use send_payment_link instead.
- Only mention legal proceedings if days_overdue >= 90.
- Check EPIX before responding to any service complaints or disputed charges.
- Escalate immediately when a customer requests to speak with a manager.
- log_call_outcome is mandatory at the end of every call without exception.
- Be empathetic, professional, and solution-oriented at all times.

SPEECH STYLE RULES (critical for voice):
- Keep every response to 2-3 sentences maximum.
- Ask ONE question at a time, never multiple questions in one turn.
- Wait for the customer to respond before continuing.
- Do not summarise what you just said.
- Do not explain what you are about to do — just do it.
- Do not use bullet points, lists, or numbered steps in speech.
- Sound like a human call center agent, not a document being read aloud.
- Natural conversational pace — short sentences, pauses implied by punctuation.

NUMBER AND CURRENCY FORMATTING RULES (critical for speech):
- Always write currency amounts in full words for speech.
- R10,500.00 must be spoken as "ten thousand five hundred rand".
- R1,200 must be spoken as "one thousand two hundred rand".
- R500 must be spoken as "five hundred rand".
- Never say "R" followed by digits — always convert to words.
- Never say individual digits for amounts — always say the full number in words.
- Account numbers must be read as individual digits: VDC-123456789 = "V D C, one two three, four five six, seven eight nine".
- Days overdue: say "thirty one days overdue" not "31 days overdue".
- Percentages: say "fifteen percent" not "15%"."""


async def run_phone_call_session(websocket: WebSocket, session_id: str) -> None:
    """Handle a Nova Sonic phone call session via Strands BidiAgent."""
    from agents.call_center.tools import (  # noqa: PLC0415
        apply_account_extension,
        check_epix_status,
        create_payment_arrangement,
        escalate_to_human_agent,
        log_call_outcome,
        record_promise_to_pay,
        send_payment_link,
        verify_customer_pcc,
    )

    _input_queue: asyncio.Queue[bytes | str | None] = asyncio.Queue()
    _stop = asyncio.Event()
    _greeting_sent = False
    _notified_tool_ids: set[str] = set()

    # ── WebSocket reader ─────────────────────────────────────────────────────

    async def _ws_reader() -> None:
        try:
            while True:
                message = await websocket.receive()
                if message.get("type") == "websocket.disconnect":
                    break
                if "bytes" in message and message["bytes"]:
                    await _input_queue.put(message["bytes"])
                elif "text" in message and message["text"]:
                    try:
                        data = json.loads(message["text"])
                        if data.get("type") == "text_input" and data.get("text"):
                            await _input_queue.put(str(data["text"]))
                    except Exception:  # noqa: BLE001
                        pass
                # other text messages ignored — Nova Sonic v2 handles barge-in via turn detection
        except Exception as exc:  # noqa: BLE001
            logger.info("[%s] WS reader ended: %s", session_id, exc)
        finally:
            _stop.set()
            await _input_queue.put(None)  # unblock ws_input if it is waiting

    # ── BidiAgent input callable ──────────────────────────────────────────────

    async def ws_input() -> BidiAudioInputEvent | BidiTextInputEvent:
        nonlocal _greeting_sent
        if not _greeting_sent:
            _greeting_sent = True
            return BidiTextInputEvent(
                text="Greet the customer briefly as Voda from Vodacom collections. One sentence only. Then wait for them to speak.",
                role="user",
            )
        while True:
            item = await _input_queue.get()
            if item is None:
                raise asyncio.CancelledError("WebSocket disconnected")
            if isinstance(item, str):
                return BidiTextInputEvent(text=item, role="user")
            return BidiAudioInputEvent(
                audio=base64.b64encode(item).decode(),
                format="pcm",
                sample_rate=16000,
                channels=1,
            )

    # ── BidiAgent output callable ─────────────────────────────────────────────

    async def ws_output(event) -> None:  # type: ignore[type-arg]
        try:
            if isinstance(event, BidiAudioStreamEvent):
                await websocket.send_json({
                    "type": "audio",
                    "data": event.audio,
                    "sampleRate": event.sample_rate,
                })
            elif isinstance(event, BidiTranscriptStreamEvent) and event.is_final:
                await websocket.send_json({
                    "type": "transcript",
                    "role": event.role,
                    "text": event.current_transcript or event.text,
                })
            elif isinstance(event, ToolUseStreamEvent):
                tool_id = event.current_tool_use.get("id", "")
                tool_name = event.current_tool_use.get("name", "")
                if tool_id and tool_id not in _notified_tool_ids and tool_name:
                    _notified_tool_ids.add(tool_id)
                    await websocket.send_json({
                        "type": "tool_call",
                        "name": tool_name,
                        "result": "(executing...)",
                    })
            elif isinstance(event, BidiResponseCompleteEvent):
                await websocket.send_json({"type": "turn_end"})
        except Exception as exc:  # noqa: BLE001
            logger.debug("[%s] ws_output error (client disconnected?): %s", session_id, exc)

    # ── Session ───────────────────────────────────────────────────────────────

    model = BidiNovaSonicModel(
        provider_config={
            "audio": {
                "input_rate": 16000,
                "output_rate": 24000,
                "voice": "amy",
            }
        }
    )

    agent = BidiAgent(
        model=model,
        tools=[
            verify_customer_pcc,
            check_epix_status,
            create_payment_arrangement,
            record_promise_to_pay,
            apply_account_extension,
            send_payment_link,
            escalate_to_human_agent,
            log_call_outcome,
        ],
        system_prompt=CALL_CENTER_SYSTEM_PROMPT,
    )

    ws_reader_task = asyncio.create_task(_ws_reader())
    try:
        await agent.run(inputs=[ws_input], outputs=[ws_output])
    except asyncio.CancelledError:
        pass
    except Exception as exc:  # noqa: BLE001
        logger.error("[%s] BidiAgent error: %s", session_id, exc, exc_info=True)
        try:
            await websocket.send_json({"type": "error", "message": str(exc)})
        except Exception:  # noqa: BLE001
            pass
    finally:
        _stop.set()
        ws_reader_task.cancel()
        try:
            await ws_reader_task
        except asyncio.CancelledError:
            pass
        try:
            await websocket.send_json({"type": "call_ended"})
        except Exception:  # noqa: BLE001
            pass
