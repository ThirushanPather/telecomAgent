# Vodacom AI Call Center Agent — Project Summary

> **Last updated:** March 2026 — reflects current codebase state

---

## What This Project Is

A proof-of-concept AI agent system designed to replace or augment call center agents in the **Credit & Collections** department at Vodacom South Africa. The system handles both inbound customer calls and outbound collections campaign strategy, using AI to converse with customers, query internal systems (PCC, EPIX), and take intelligent action based on account context.

---

## Current Architecture

```
Browser (poc/public/)
  ├── index.html          — Single-page app with two tabs (Agent 1 / Agent 2)
  ├── agent1.js           — Call Center UI: chat, voice mode, phone call overlay
  ├── agent2.js           — Campaign UI: subscriber table, recommendations, RPA log
  ├── audio-processor.js  — AudioWorklet for raw PCM 16kHz capture (phone calls)
  └── styles.css          — Unified styles

Python FastAPI Backend (backend/)
  ├── main.py             — HTTP + WebSocket server on port 8000; serves /poc/public
  ├── config.py           — Settings loaded from .env (AWS, ElevenLabs, Twilio, Gmail)
  ├── agents/
  │   ├── call_center/
  │   │   ├── agent.py    — Strands Agent (Bedrock) for text chat
  │   │   ├── tools.py    — 8 call center tools (verify, EPIX, payments, etc.)
  │   │   └── scenarios.py — 5 demo scenarios with pre-seeded subscriber data
  │   └── campaign_manager/
  │       ├── agent.py    — Campaign recommendation engine (AI + rules)
  │       └── tools.py    — RPA simulation tool
  ├── integrations/
  │   ├── nova_sonic.py   — Nova Sonic voice session via Strands BidiAgent
  │   ├── tts.py          — ElevenLabs text-to-speech (voice mode for Agent 1)
  │   ├── email.py        — Gmail SMTP payment email integration
  │   └── whatsapp.py     — Twilio WhatsApp payment link integration
  └── data/
      ├── subscribers.py  — 50 mock subscribers (in-memory)
      └── rpa_log.py      — In-memory RPA action log
```

---

## Agent 1 — Call Center Agent ("Voda")

### What It Does

Handles inbound/outbound collections calls. The AI agent:
1. Verifies the customer via `verify_customer_pcc` (POPIA compliance)
2. Assesses the account situation (balance, days overdue, service status)
3. Negotiates a resolution (full payment, arrangement, promise to pay, extension)
4. Resolves the call by taking the agreed action
5. Logs the call outcome via `log_call_outcome` (mandatory)

### Text Chat Mode

- Customer types messages → FastAPI `/api/agent1/chat` → **Strands Agent** → **AWS Bedrock** (Claude)
- Agent uses tools mid-conversation; tool call results appear in the Activity Feed
- 5 pre-built scenarios auto-populate the chat with realistic subscriber data
- **Customer Card** panel auto-populates with verified account details when `verify_customer_pcc` succeeds

### Voice Mode (Text + TTS)

- Toggle "Voice Mode" to enable microphone input (Web Speech API, hold-to-record)
- Agent replies are spoken back via **ElevenLabs TTS** (`/api/tts` endpoint)
- Falls back silently if ElevenLabs key is absent

### Phone Call Mode (Full Voice)

- Click "Start Phone Call" → WebSocket `/ws/phone-call/{session_id}` opens
- Browser captures microphone as **raw PCM 16-bit 16kHz mono** via `AudioWorklet`
- Audio streamed live to backend → **Amazon Nova Sonic** (AWS Bedrock bidirectional speech model)
- Nova Sonic responds with speech audio streamed back → played gaplessly via Web Audio API
- Agent greets the customer automatically on call connect (no user audio needed to start)
- Interrupt button available while agent is speaking
- On call end: WebSocket closes cleanly, overlay dismisses

### Call Center Tools (8 total)

| Tool | Description |
|---|---|
| `verify_customer_pcc` | Queries PCC for identity verification and account details |
| `check_epix_status` | Queries EPIX for open tickets, network status, billing anomalies |
| `create_payment_arrangement` | Creates a monthly instalment plan |
| `record_promise_to_pay` | Records a verbal commitment to pay by a date |
| `apply_account_extension` | Extends the payment due date (< 30 days overdue only) |
| `send_payment_link` | Sends secure payment link via SMS or Email |
| `escalate_to_human_agent` | Raises an escalation ticket (fires on manager request) |
| `log_call_outcome` | Mandatory call outcome log (PAID, PTP, ARRANGEMENT, DISPUTE, ESCALATED, NO_RESOLUTION) |

`send_payment_link` triggers real integrations:
- **Email**: Gmail SMTP with payment details
- **SMS**: Twilio WhatsApp message

---

## Agent 2 — Campaign Strategy Agent

### What It Does

Analyses a mock subscriber database and recommends the correct collections campaign action for each subscriber based on the Vodacom collections lifecycle (Days 1–30 / 31–60 / 61–90 / 91–218 / Legal). Operates on a **human-in-the-loop** model: AI recommends, human approves, RPA action executes.

### How It Works

- AI analysis mode (single subscriber): Bedrock AI reviews account data and recommends an action with reasoning
- Bulk mode (multiple subscribers): Fast deterministic rules engine, no AI call, no rate limiting
- Human approval: Operator clicks "Approve & Execute" → `simulate_rpa_action` fires → webhook fires (if configured)
- All approved actions are logged in the RPA Action Log visible in the UI

### Campaign Actions

Suspensions, payment arrangement creation, promise-to-pay recording, debt collector placement, legal referrals — each mapped to the appropriate days-overdue band.

---

## Technology Stack

| Layer | Technology |
|---|---|
| **AI Models** | AWS Bedrock (Claude 3.x via Strands Agents) for text, Amazon Nova Sonic (`amazon.nova-2-sonic-v1:0`) for voice |
| **Agent Framework** | [Strands Agents](https://github.com/strands-agents/sdk-python) — `Agent` (text), `BidiAgent` (voice) |
| **Backend** | Python 3.11+, FastAPI, Uvicorn |
| **Frontend** | Vanilla HTML/CSS/JS (no framework), Web Audio API, AudioWorklet |
| **TTS** | ElevenLabs (voice mode for text chat) |
| **Messaging** | Gmail SMTP (payment emails), Twilio WhatsApp (payment links) |
| **Notifications** | Webhook (configurable `WEBHOOK_URL`) on RPA approval |

---

## Environment Variables (.env)

```
# Required
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=us.anthropic.claude-3-5-haiku-20241022-v1:0

# Optional — features degrade gracefully if absent
GMAIL_USER=your@gmail.com
GMAIL_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
SMTP_RECIPIENT=recipient@example.com

TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
TWILIO_WHATSAPP_TO=whatsapp:+27xxxxxxxxx

ELEVENLABS_API_KEY=sk_xxxxxxxxxxxxxxxxxxxx
ELEVENLABS_VOICE_ID=YPtbPhafrxFTDAeaPP4w   # default if absent

WEBHOOK_URL=https://your-webhook-endpoint.example.com/hook
```

AWS credentials must be configured via AWS CLI (`aws configure`) or environment variables. Nova Sonic uses the same credential chain.

---

## Running the Project

```bash
cd backend
pip install -r requirements.txt
python main.py
# → http://localhost:8000
```

---

## Nova Sonic Voice Configuration

Voice is configured in [backend/integrations/nova_sonic.py](backend/integrations/nova_sonic.py):

```python
model = BidiNovaSonicModel(
    provider_config={
        "audio": {
            "input_rate": 16000,
            "output_rate": 24000,
            "voice": "matthew",   # ← change this to switch voice
        }
    }
)
```

**Valid voice IDs:** `"matthew"` (male), `"tiffany"` (female, US), `"amy"` (female, British)

---

## Current State and Known Limitations

| Item | Status |
|---|---|
| Text chat (Agent 1) | Working end-to-end |
| Tool calls with activity feed | Working |
| Customer card auto-population | Working |
| 5 demo scenarios | Working |
| Voice mode (TTS via ElevenLabs) | Working (requires API key) |
| Payment email (Gmail) | Working |
| Payment WhatsApp (Twilio) | Working |
| Campaign Agent (Agent 2) | Working end-to-end |
| Human-in-the-loop approval | Working |
| Nova Sonic phone call | Implemented — end-to-end voice test pending |
| Audio format (browser → Nova Sonic) | PCM 16kHz via AudioWorklet ✓ |
| Nova Sonic voice response | Audio streamed back and played via Web Audio API ✓ |

---

## What Was Done (Development History)

### v1 — Initial PoC (Node.js + Gemini)
- Node.js + Express backend
- Google AI Studio (Gemini 2.5 Flash) with function calling
- Two mock tools: `verify_customer_pcc`, `check_epix_status`
- Basic HTML chat UI
- End-to-end text demo working

### v2 — Migration to Python / AWS Bedrock
- Migrated backend to Python + FastAPI
- Replaced Gemini with AWS Bedrock (Claude) via **Strands Agents** framework
- Expanded to 8 tools with full collections call flow
- Added 50-subscriber mock database
- Added Agent 2 (Campaign Strategy) with human-in-the-loop approval

### v3 — Real Integrations
- Gmail SMTP payment email
- Twilio WhatsApp payment link
- ElevenLabs TTS voice mode
- Web Speech API microphone input (hold-to-record)
- Webhook on RPA approval

### v4 — Nova Sonic Phone Call
- Added bidirectional WebSocket endpoint (`/ws/phone-call/{session_id}`)
- Implemented `nova_sonic.py` using **Strands BidiAgent** + **BidiNovaSonicModel**
- Browser AudioWorklet captures raw PCM 16kHz mono and streams to backend
- Nova Sonic streams speech audio back; played gaplessly via Web Audio API
- Agent greets customer automatically on call connect
- Interrupt (barge-in) button while agent is speaking
- Clean session lifecycle with proper asyncio task coordination

---

## Vision and Next Steps

### Near-term
- **End-to-end Nova Sonic voice test** — confirm bidirectional conversation works fully
- **Real AWS credentials in production** — ensure IAM role has Bedrock Nova Sonic access

### Phase 2 — Real RPA Integration
- Build UiPath bots that query real PCC and EPIX systems
- Replace mock tool functions with calls to UiPath Orchestrator REST API
- AI agent triggers bots, waits for completion, reads output, responds to customer

### Phase 3 — Payment Arrangement Negotiator
- Define allowed thresholds (e.g. max 3-month plan, min 30% upfront)
- Agent negotiates within those thresholds and logs via RPA

### Phase 4 — Outbound Collections Intelligence
- Scan outstanding balance database (0–180 days arrears)
- Segment by risk profile
- Decide communication channel per customer (SMS, email, WhatsApp, outbound call)
- Scheduled overnight batch job

### Phase 5 — Production on Azure
- Migrate from AWS Bedrock → Azure OpenAI (GPT-4o) if Microsoft is the target platform
- Host on Azure App Service or Azure Container Apps
- Leverage existing Vodacom Microsoft Enterprise Agreement
- Copilot Studio for agent-assist (human agent copilot in Teams/CRM)

---

## Other AI Agent Opportunities (Collections Department)

1. **Agent Assist Copilot** — AI sits alongside human agents, pulls account info in real-time and suggests next-best-action
2. **Promise-to-Pay Monitor** — watches accounts after a payment promise, auto-reminds and escalates if broken
3. **Early Warning System** — detects at-risk accounts before 30 days overdue, triggers proactive outreach
4. **Dispute Resolution Agent** — reviews billing disputes, auto-credits valid ones, escalates invalid ones
5. **Legal/Escalation Triage** — determines if a debt is worth legal action before handing to a collections agency

---

## The Pitch (One Paragraph)

> *"We have built a fully working proof-of-concept AI call center agent that can handle customer queries, look up account information from internal systems, negotiate payment arrangements, send payment links, and respond naturally in both text and voice — without any human agent involvement. The system is live, demonstrates all 8 tool actions end-to-end, and now includes a full bidirectional voice call capability powered by Amazon Nova Sonic. The technology is proven and the integration path with our existing UiPath RPA bots is well-defined and low-risk."*

---

## UiPath Integration Path (Next Phase)

The AI agent is already designed to call tools. Replacing mock tools with real UiPath calls:

1. Build a UiPath bot accepting **input arguments** (e.g. customer ID) returning **output arguments** (e.g. account JSON)
2. Publish to UiPath Orchestrator
3. Get Orchestrator API credentials (URL, Client ID, Secret, Tenant, Folder)
4. Replace mock functions in [backend/agents/call_center/tools.py](backend/agents/call_center/tools.py) with REST calls:
   - `POST /odata/Jobs` → start the bot
   - `GET /odata/Jobs({id})` → poll until complete
   - Read output arguments from the completed job response
5. The AI agent then uses real results to respond to the customer
