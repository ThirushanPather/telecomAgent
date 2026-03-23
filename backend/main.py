from pathlib import Path
from typing import Any, Optional

import uvicorn
from fastapi import FastAPI, Response, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

_FRONTEND_DIR = Path(__file__).parent.parent / "poc" / "public"

from data.subscribers import get_all_subscribers
from data.rpa_log import get_rpa_log
from agents.call_center.agent import invoke_call_center_agent
from agents.call_center.scenarios import SCENARIOS
from agents.campaign_manager.agent import invoke_campaign_agent, bulk_recommend
from agents.campaign_manager.tools import run_simulate_rpa


class ChatRequest(BaseModel):
    messages: list[Any]
    accountContext: Optional[dict] = None


class RecommendRequest(BaseModel):
    subscriber_id: str


class RecommendBulkRequest(BaseModel):
    subscriber_ids: list[str]


class ApproveActionRequest(BaseModel):
    subscriber_id: str
    action_type: str
    details: Optional[str] = ""

app = FastAPI(title="Vodacom Credit & Collections AI Agent")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8000", "http://127.0.0.1:8000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Health ---

@app.get("/health")
async def health():
    return {"status": "ok"}


# --- Agent 1 stubs ---

@app.post("/api/agent1/chat")
def agent1_chat(body: ChatRequest):
    # Sync def — FastAPI runs this in a thread pool, which is correct for
    # blocking Bedrock calls and keeps contextvars working per-request.
    return invoke_call_center_agent(body.messages, body.accountContext)


@app.get("/api/agent1/scenarios")
def agent1_scenarios():
    return SCENARIOS


# --- Agent 2 ---

@app.post("/api/agent2/recommend")
def agent2_recommend(body: RecommendRequest):
    # Single subscriber — AI analysis mode (blocking Bedrock call).
    return invoke_campaign_agent(body.subscriber_id)


@app.post("/api/agent2/recommend-bulk")
def agent2_recommend_bulk(body: RecommendBulkRequest):
    # Multiple subscribers — deterministic rules engine, no AI.
    recs = bulk_recommend(body.subscriber_ids)
    return {"count": len(recs), "recommendations": recs}


@app.post("/api/agent2/approve-action")
def agent2_approve_action(body: ApproveActionRequest):
    # Human approval gate — runs RPA action directly, then fires webhook.
    result = run_simulate_rpa(body.subscriber_id, body.action_type, body.details or "")
    if result["status"] == "error":
        from fastapi import HTTPException  # noqa: PLC0415
        raise HTTPException(status_code=400, detail=result["message"])

    # Fire webhook if configured — fail silently.
    try:
        from config import settings  # noqa: PLC0415
        if settings.WEBHOOK_URL:
            import httpx  # noqa: PLC0415
            from datetime import datetime  # noqa: PLC0415
            httpx.post(
                settings.WEBHOOK_URL,
                json={
                    "event":           "RPA_ACTION_APPROVED",
                    "timestamp":       datetime.now().isoformat(),
                    "subscriber_id":   result["subscriber_id"],
                    "subscriber_name": result["subscriber_name"],
                    "action_type":     result["action_type"],
                    "reference":       result["reference"],
                    "recommended_by":  "AI_AGENT",
                    "approved_by":     "HUMAN_OPERATOR",
                },
                timeout=5.0,
            )
    except Exception:
        pass  # webhook errors never block the response

    return result


@app.get("/api/agent2/subscribers")
def agent2_subscribers():
    subs = get_all_subscribers()
    return {"count": len(subs), "subscribers": subs}


@app.get("/api/agent2/rpa-log")
def agent2_rpa_log():
    log = get_rpa_log()
    return {"count": len(log), "actions": log}


# --- TTS ---

class TtsRequest(BaseModel):
    text: str


@app.post("/api/tts")
def tts(body: TtsRequest):
    from integrations.tts import synthesise_speech  # noqa: PLC0415
    from fastapi import HTTPException               # noqa: PLC0415

    audio = synthesise_speech(body.text)
    if audio is None:
        raise HTTPException(status_code=503, detail="TTS unavailable")
    return Response(content=audio, media_type="audio/mpeg")


# --- Nova Sonic phone call ---

@app.websocket("/ws/phone-call/{session_id}")
async def phone_call_ws(websocket: WebSocket, session_id: str):
    import logging  # noqa: PLC0415
    from integrations.nova_sonic import run_phone_call_session  # noqa: PLC0415

    _log = logging.getLogger(__name__)
    _log.info("[%s] Phone call WebSocket connected", session_id)
    await websocket.accept()
    try:
        await run_phone_call_session(websocket, session_id)
    except Exception as exc:  # noqa: BLE001
        _log.error("[%s] WebSocket error: %s", session_id, exc, exc_info=True)
    finally:
        _log.info("[%s] Phone call WebSocket closed", session_id)
        try:
            await websocket.close()
        except Exception:  # noqa: BLE001
            pass


# --- Serve frontend (must be last) ---

app.mount("/", StaticFiles(directory=_FRONTEND_DIR, html=True), name="static")


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True, log_level="info")
