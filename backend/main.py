from pathlib import Path
from typing import Any, Optional

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

_FRONTEND_DIR = Path(__file__).parent.parent / "poc" / "public"

from data.subscribers import get_all_subscribers
from data.rpa_log import get_rpa_log
from agents.call_center.agent import invoke_call_center_agent
from agents.call_center.scenarios import SCENARIOS


class ChatRequest(BaseModel):
    messages: list[Any]
    accountContext: Optional[dict] = None

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


# --- Agent 2 stubs ---

@app.post("/api/agent2/recommend")
async def agent2_recommend():
    return {"status": "not implemented"}


@app.post("/api/agent2/recommend-bulk")
async def agent2_recommend_bulk():
    return {"status": "not implemented"}


@app.post("/api/agent2/approve-action")
async def agent2_approve_action():
    return {"status": "not implemented"}


@app.get("/api/agent2/subscribers")
async def agent2_subscribers():
    return get_all_subscribers()


@app.get("/api/agent2/rpa-log")
async def agent2_rpa_log():
    return get_rpa_log()


# --- Serve frontend (must be last) ---

app.mount("/", StaticFiles(directory=_FRONTEND_DIR, html=True), name="static")


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
