# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working 
with code in this repository.

## Project Overview

This is a **Vodacom Credit & Collections AI Agent POC** with two agents:

- **Agent 1 — Call Center Agent ("Voda"):** Handles inbound/outbound 
  collections calls. Verifies customers, checks account and EPIX data, 
  creates payment arrangements, records PTPs, escalates to humans.

- **Agent 2 — Campaign Strategy Agent:** Analyses a mock subscriber 
  database and recommends the correct collections campaign action based 
  on the Vodacom collections lifecycle (Days 1-30, 31-60, 61-90, 
  91-218, Legal). Operates on a human-in-the-loop model: AI recommends, 
  human approves, RPA action is simulated.

## Target File Structure
```
/poc
  server.js
  /routes
    agent1.js
    agent2.js
  /data
    mockDb.js
    subscribers.js
  /public
    index.html
    agent1.js
    agent2.js
    styles.css
  .env
  package.json
```

## Running the Project
```bash
node server.js
# or with auto-reload:
npx nodemon server.js
```

Runs on `http://localhost:3001`. Open `http://localhost:3001` in browser.

## Environment

Requires a `.env` file at the project root with:
```
GEMINI_API_KEY=your_key_here
```

## Architecture

**Stateless backend, stateful frontend pattern:**

- `server.js` — mounts `/api/agent1` and `/api/agent2` route groups, 
  serves `/public` as static files.
- `routes/agent1.js` — Gemini tool-use loop for the call center agent. 
  Receives full conversation history + account context on each request. 
  Returns final text response AND a `tool_calls[]` array for the 
  frontend thinking panel.
- `routes/agent2.js` — Campaign recommendation engine. Exposes 
  endpoints for single and bulk recommendations, human approval gate, 
  subscriber listing, and RPA action log.
- `data/mockDb.js` — In-memory store with three collections: 
  subscribers, campaignRecommendations, rpaActionLog.
- `data/subscribers.js` — Seeds 50 mock subscribers on startup.

**Human-in-the-loop (Agent 2):**
AI recommendation is generated and displayed. No RPA action fires until 
the human clicks "Approve & Execute". Approval calls 
`/api/agent2/approve-action` which calls `simulate_rpa_action`.

## Key Dependency Notes

- ES modules (`"type": "module"`) — use `import`/`export` only.
- `@google/generative-ai` SDK v0.24+ — function declarations use 
  `type: "OBJECT"` (uppercase). `response.functionCalls()` is a method.
- Express v5 installed — note breaking changes from v4.
- No frontend frameworks — vanilla HTML/CSS/JS only.
- No emojis anywhere in the codebase, UI, or agent responses.