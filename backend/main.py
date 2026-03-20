import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

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
async def agent1_chat():
    return {"status": "not implemented"}


@app.get("/api/agent1/scenarios")
async def agent1_scenarios():
    return {"status": "not implemented"}


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
    return {"status": "not implemented"}


@app.get("/api/agent2/rpa-log")
async def agent2_rpa_log():
    return {"status": "not implemented"}


# --- Serve frontend (must be last) ---

app.mount("/", StaticFiles(directory="poc/public", html=True), name="static")


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
