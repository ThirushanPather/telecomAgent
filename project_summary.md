# Vodacom AI Call Center Agent — Project Summary

## What This Project Is

A proof-of-concept AI agent designed to replace or augment call center agents in the **Credit & Collections** department at Vodacom. The agent interacts with customers via text (and eventually voice), uses RPA bots to query internal systems (PCC, EPIX), and takes intelligent action based on account context.

---

## What Has Been Done (PoC — March 2026)

- **Architecture & planning** completed — full system design with logic flow diagrams mapping inbound/outbound customer journeys
- **Google AI Studio (Gemini 2.5 Flash)** selected as the AI model for the PoC
- **Working backend server** built (`Node.js + Express`) that:
  - Accepts chat messages from a frontend UI
  - Passes conversation history to the Gemini model
  - Supports **Function Calling (Tool Use)** — the AI can decide to call tools mid-conversation
- **Two mock RPA tools** implemented as placeholders:
  - `verify_customer_pcc` — simulates querying PCC for customer account details (name, balance, due date, status)
  - `check_epix_status` — simulates querying EPIX for open tickets and network status
- **Chat UI** (basic HTML) built for demonstration purposes
- **End-to-end tested**: customer types their account number → AI calls the PCC tool → AI responds with real mock account data naturally in conversation

---

## How It Currently Works (Technical)

```
Customer types message
  → Frontend (index.html) sends to Node.js backend
  → Backend sends message to Gemini AI with conversation history
  → Gemini decides if it needs to call a tool (e.g. verify_customer_pcc)
  → If yes: backend executes the mock tool, returns data to Gemini
  → Gemini composes a natural language response using the data
  → Response sent back to frontend and displayed to customer
```

**Files:**
- [poc/server.js](file:///c:/Users/thiru/Documents/Vodacom%20Work/AI%20Agent/poc/server.js) — backend Node.js server with AI + tool logic
- [poc/index.html](file:///c:/Users/thiru/Documents/Vodacom%20Work/AI%20Agent/poc/index.html) — basic chat UI
- [poc/.env](file:///c:/Users/thiru/Documents/Vodacom%20Work/AI%20Agent/poc/.env) — stores the Google AI Studio API key (secured, not shared)

---

## Current Concerns

| Concern | Detail |
|---|---|
| **Rate limits** | Google AI Studio free tier has strict per-minute limits. Resolved by enabling billing. |
| **Data privacy** | Using Google AI Studio means customer data leaves Vodacom infrastructure. Not suitable for production. |
| **No real RPA connection yet** | Tools are mocked — no actual PCC or EPIX queries happening |
| **No voice layer** | Currently text only. Speech-to-text and text-to-speech not yet integrated. |
| **Single user** | No authentication, session management, or multi-user support |

---

## Vision & Future Implementation Plan

### Phase 1 — PoC (✅ Done)
- Text-based AI agent with mock PCC/EPIX tool calls
- Demonstrate concept to line manager

### Phase 2 — Real RPA Integration
- Build UiPath bots that can query PCC and EPIX using real credentials
- Replace mock tool functions with calls to **UiPath Orchestrator REST API**
- AI agent triggers bots, waits for completion, reads output, responds to customer

### Phase 3 — Payment Arrangement Negotiator
- Extend the agent to handle payment arrangement conversations
- Define allowed thresholds (e.g. max 3-month plan, min 30% upfront)
- Agent negotiates within those thresholds and logs the arrangement via RPA

### Phase 4 — Outbound Collections Intelligence
- Agent scans outstanding balance database (0–180 days arrears)
- Segments customers by risk profile
- Decides: SMS, email, WhatsApp, or outbound call per customer
- Executed as a scheduled overnight batch job

### Phase 5 — Voice Layer
- Add Speech-to-Text (STT) at the front: customer calls in, speech transcribed to text
- Add Text-to-Speech (TTS) at the back: AI response read back as voice
- Full inbound voice agent replacing the initial call routing layer

### Phase 6 — Production on Azure (Microsoft)
- Migrate from Google AI Studio → **Azure OpenAI (GPT-4o)**
- Host backend on **Azure App Service** or **Azure Container Apps**
- Use **Copilot Studio** for agent-assist (human agent copilot in Teams/CRM)
- Leverage existing Vodacom Microsoft Enterprise Agreement for licensing

---

## Other AI Agent Opportunities Identified (Collections Department)

1. **Agent Assist Copilot** — AI sits alongside human agents, pulls account info in real-time and suggests next-best-action
2. **Promise-to-Pay Monitor** — watches accounts after a payment promise, auto-reminds and escalates if broken
3. **Early Warning System** — detects at-risk accounts before they go 30 days overdue, triggers proactive outreach
4. **Dispute Resolution Agent** — reviews billing disputes, auto-credits valid ones, escalates invalid ones
5. **Legal/Escalation Triage** — determines if a debt is worth legal action before handing to collections agency

---

## What to Present to the Line Manager

### The Pitch (1 slide / 1 paragraph)
> *"We have built a working proof-of-concept AI call center agent that can handle customer queries, look up account information from internal systems, and respond naturally in conversation — without any human agent involvement. The technology is proven and ready for the next phase. The integration with our existing UiPath RPA bots and Microsoft Azure infrastructure is a clear, low-risk path to production."*

### Key Points
- **It works today** — fully functional demo available
- **Built on technology Vodacom already licenses** — Microsoft Azure + OpenAI is the production target
- **RPA integration is the bridge** — no need to rebuild any existing systems; the AI simply calls the bots we build in UiPath
- **Phased, low-risk approach** — each phase delivers standalone value and builds on the last
- **Biggest opportunity**: Payment arrangement negotiator and outbound smart collections could directly increase collection rates and reduce headcount pressure

### Suggested Demo Script
1. Open the chat UI
2. Type: *"Hi, I need help with my account"*
3. Show the agent asking for verification
4. Provide account number: `VODA-987654321`
5. Show the agent automatically looking up the account (PCC tool fires in background)
6. Show the natural response with account name, balance, due date

---

## UiPath Integration Context (For Next Phase)

The AI agent is already designed to call tools (functions). Replacing the mock tools with real UiPath calls requires:

1. Build a UiPath bot that accepts **input arguments** (e.g. customer ID) and returns **output arguments** (e.g. account JSON)
2. Publish the bot to UiPath Orchestrator
3. Get Orchestrator API credentials (URL, Client ID, Secret, Tenant, Folder)
4. Replace [executeTool()](file:///c:/Users/thiru/Documents/Vodacom%20Work/AI%20Agent/poc/server.js#63-96) in [server.js](file:///c:/Users/thiru/Documents/Vodacom%20Work/AI%20Agent/poc/server.js) with REST calls to the Orchestrator API:
   - `POST /odata/Jobs` → start the bot
   - `GET /odata/Jobs({id})` → poll until complete
   - Read output arguments from the completed job response
5. The AI agent then uses those real results to respond to the customer

This is a well-defined, implementable integration with clear API documentation from UiPath.
