import { GoogleGenerativeAI } from "@google/generative-ai";
import { Router } from "express";
import mockDb from "../data/mockDb.js";

const router = Router();

// Lazy — initialized on first request so dotenv has already run by then.
let _model = null;
function getModel() {
  if (!_model) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    _model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      tools,
      generationConfig: {
        thinkingConfig: { thinkingBudget: 0 },
      },
      systemInstruction: SYSTEM_INSTRUCTION,
    });
  }
  return _model;
}

// ─── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_INSTRUCTION = `
You are an AI Campaign Strategy Agent for Vodacom South Africa Credit and Collections department.

Your role is to analyse subscriber account data and recommend the correct collections campaign action based on the Vodacom collections lifecycle. You operate on a human-in-the-loop model: you recommend, a human reviews and approves, and the RPA action is then executed.

IDENTITY AND TONE:
- Communicate in plain, professional English only.
- Do not use emojis, exclamation marks used for enthusiasm, or informal language.
- Be analytical and precise. Back every recommendation with the lifecycle rules.
- Never speculate on data. Only state what the tools return.

CAMPAIGN LIFECYCLE RULES — apply these exactly when making recommendations:

Days 1-15:
- STANDARD / TUC: Direct to self-help channels. Send SMS with payment portal link.
- FPD (First Payment Defaulter): Trigger early campaign immediately. SMS plus outbound call.
- HIGH_RISK: Trigger early predictive campaign. SMS plus outbound call.
- Campaign types: SELF_HELP (standard/TUC), EARLY_CAMPAIGN (FPD/HIGH_RISK)
- Urgency: LOW (standard/TUC), MEDIUM (FPD/HIGH_RISK)

Days 16-30:
- STANDARD: Run SMS and email campaign. Issue warning letter of pending suspension.
- FPD / NVP (Never Paid): Apply soft lock. Send warning letter. Initiate bureau update process.
- HIGH_RISK: Activate active predictive dialler campaign.
- TUC: SMS campaign plus recharge reminder.
- Campaign types: ACTIVE_CAMPAIGN, SOFT_LOCK
- Urgency: MEDIUM (standard/TUC), HIGH (FPD/NVP/HIGH_RISK)

Days 31-60:
- STANDARD: Run EC Suspended campaign. Send final notice before hard collections.
- NVP / HIGH_RISK: Initiate external trace. Suspend service. Escalate to hard collections team.
- TUC: Trigger TUC conversion campaign. Offer recharge plan to retain subscriber.
- Campaign types: EC_SUSPEND (standard), TRACE (NVP/HIGH_RISK), TUC_CONVERSION (TUC)
- Urgency: MEDIUM (standard/TUC), HIGH (NVP/HIGH_RISK)

Days 61-90:
- All account types: Remove debit order. Initiate hard collections.
- NVP: Trigger 90-day neverpaid campaign.
- Update bureau listing for all accounts not yet listed.
- Campaign types: HARD_COLLECTIONS
- Urgency: HIGH

Days 91-218:
- All: Issue final letter of demand. Initiate PLEA DCA pre-legal allocation. Assign trace campaign.
- Campaign types: PRE_LEGAL
- Urgency: CRITICAL

Days 219+:
- All: DCA placement at level 1, 2, or 3 escalating. Apply settlement pressure. Consider legal proceedings.
- Campaign types: LEGAL
- Urgency: CRITICAL

ACCOUNT TYPE MODIFIERS:
- FPD: Escalate campaign intensity earlier than the standard lifecycle stage.
- NVP: Separate focus track. Trace campaigns are prioritised.
- HIGH_RISK: Prioritise in early campaign. Faster escalation to next tier.
- TUC: Conversion and recharge campaigns used instead of standard collections flow.
- STANDARD: Follow standard lifecycle without modification.

ADDITIONAL COMPLIANCE RULES — check all of these before every recommendation:
- If open_epix_tickets is true: Do not recommend aggressive action. Place account on EPIX hold. Recommend resolving the billing ticket before any collections action proceeds.
- If last_response is BROKEN_PTP: Escalate to the next campaign tier by treating the account as 15 days more overdue than it actually is.
- If balance_owed is less than R200: Flag for small balance write-off consideration. Do not recommend aggressive collections action.
- If bureau_listed is true: Skip bureau update actions — the bureau listing is already in place.

WORKFLOW:
1. When asked to recommend for a subscriber, call get_subscriber to review their data first.
2. Call recommend_campaign to obtain the validated, structured recommendation from the rules engine.
3. Present the recommendation with clear reasoning tied to the lifecycle rules above.
4. If asked to execute an action, inform the user that human approval is required via the approve-action endpoint. Do not call simulate_rpa_action yourself — that is reserved for the human approval gate.
5. Use get_cohort to analyse groups of subscribers when asked for cohort-level insights.
6. Use get_rpa_log to report on actions that have been executed.
`.trim();

// ─── Tool Declarations ────────────────────────────────────────────────────────

const tools = [
  {
    functionDeclarations: [
      {
        name: "get_subscriber",
        description:
          "Fetches a single subscriber record from the database by subscriber ID. Use this to review a subscriber's full profile before making a recommendation.",
        parameters: {
          type: "OBJECT",
          properties: {
            subscriber_id: {
              type: "STRING",
              description: "The subscriber ID, e.g. SUB-001.",
            },
          },
          required: ["subscriber_id"],
        },
      },
      {
        name: "get_cohort",
        description:
          "Filters subscribers by lifecycle criteria. Returns a list of matching subscribers. Use this when analysing groups or cohorts rather than individual accounts.",
        parameters: {
          type: "OBJECT",
          properties: {
            days_overdue_min: {
              type: "NUMBER",
              description: "Minimum days overdue (inclusive). Omit to apply no lower bound.",
            },
            days_overdue_max: {
              type: "NUMBER",
              description: "Maximum days overdue (inclusive). Omit to apply no upper bound.",
            },
            account_type: {
              type: "STRING",
              description:
                "Filter by account type. One of: FPD, NVP, HIGH_RISK, TUC, STANDARD.",
            },
            service_status: {
              type: "STRING",
              description:
                "Filter by service status. One of: ACTIVE, SOFT_LOCKED, SUSPENDED, DELETED.",
            },
            last_response: {
              type: "STRING",
              description:
                "Filter by last contact response. One of: PAID, PTP, NO_ANSWER, DISPUTE, BROKEN_PTP, NONE.",
            },
          },
          required: [],
        },
      },
      {
        name: "recommend_campaign",
        description:
          "Runs the Vodacom campaign rules engine for a specific subscriber and returns a validated, structured campaign recommendation. Returns recommended_action, campaign_type, urgency (LOW|MEDIUM|HIGH|CRITICAL), reasoning, and a compliance flag.",
        parameters: {
          type: "OBJECT",
          properties: {
            subscriber_id: {
              type: "STRING",
              description: "The subscriber ID to analyse.",
            },
          },
          required: ["subscriber_id"],
        },
      },
      {
        name: "simulate_rpa_action",
        description:
          "Simulates and logs an RPA action for a subscriber after human approval. Records the action in the RPA action log with status COMPLETED and returns a reference number. Action types: SEND_SMS | SEND_EMAIL | TRIGGER_CALL | SOFT_LOCK | SUSPEND | SEND_LETTER | ALLOCATE_DCA | WRITE_OFF.",
        parameters: {
          type: "OBJECT",
          properties: {
            subscriber_id: {
              type: "STRING",
              description: "The subscriber ID.",
            },
            action_type: {
              type: "STRING",
              description:
                "The RPA action type: SEND_SMS | SEND_EMAIL | TRIGGER_CALL | SOFT_LOCK | SUSPEND | SEND_LETTER | ALLOCATE_DCA | WRITE_OFF.",
            },
            details: {
              type: "STRING",
              description: "Optional notes or details about the action being executed.",
            },
          },
          required: ["subscriber_id", "action_type"],
        },
      },
      {
        name: "get_rpa_log",
        description:
          "Returns all entries in the RPA action log. Use this to report on actions that have been executed.",
        parameters: {
          type: "OBJECT",
          properties: {},
          required: [],
        },
      },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ref() {
  return `RPA-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

// ─── Rules Engine ─────────────────────────────────────────────────────────────
// Deterministic campaign recommendation based on lifecycle rules.
// Called by the recommend_campaign tool executor and the /recommend-bulk endpoint.

function runRulesEngine(subscriber_id) {
  const sub = mockDb.getSubscriber(subscriber_id);
  if (!sub) {
    return { status: "error", message: `Subscriber ${subscriber_id} not found.` };
  }

  const days = sub.days_overdue;
  const type = sub.account_type;

  // Small balance write-off
  if (sub.balance_owed < 200) {
    return {
      status: "success",
      subscriber_id,
      subscriber_name: sub.name,
      days_overdue: days,
      account_type: type,
      balance_owed: sub.balance_owed,
      recommended_action:
        "Flag for small balance write-off consideration. No aggressive collections action is warranted at this balance level.",
      campaign_type: "SMALL_BALANCE_WRITE_OFF",
      urgency: "LOW",
      compliant: true,
      reasoning:
        `Balance of R${sub.balance_owed} is below the R200 threshold. The cost of collections action exceeds the recoverable amount. ` +
        "Flag for write-off review rather than initiating any outreach campaign.",
    };
  }

  // EPIX hold — open ticket blocks aggressive action
  if (sub.open_epix_tickets) {
    return {
      status: "success",
      subscriber_id,
      subscriber_name: sub.name,
      days_overdue: days,
      account_type: type,
      balance_owed: sub.balance_owed,
      recommended_action:
        "Place account on EPIX hold. Resolve the open billing ticket before initiating any collections campaign.",
      campaign_type: "EPIX_HOLD",
      urgency: "LOW",
      compliant: true,
      reasoning:
        "An open EPIX billing ticket is present on this account. Initiating aggressive collections action while a billing dispute is unresolved is non-compliant. " +
        "The billing query must be resolved first before any outreach or restrictions are applied.",
    };
  }

  // BROKEN_PTP modifier: treat account as 15 days further overdue
  const effectiveDays = sub.last_response === "BROKEN_PTP" ? days + 15 : days;
  const brokenPtpNote =
    sub.last_response === "BROKEN_PTP"
      ? " Previous promise to pay was broken, escalating to the next campaign tier."
      : "";

  let recommended_action, campaign_type, urgency, reasoning;

  if (effectiveDays <= 15) {
    if (type === "FPD" || type === "HIGH_RISK") {
      recommended_action =
        "Trigger early predictive campaign. Initiate outbound call and send SMS with payment portal link.";
      campaign_type = "EARLY_CAMPAIGN";
      urgency = "MEDIUM";
      reasoning =
        `Account is ${days} days overdue with a ${type} risk profile.${brokenPtpNote} ` +
        "Early campaign intervention is required to prevent further default at this profile level.";
    } else {
      recommended_action =
        "Direct customer to self-help channels. Send SMS with secure payment portal link.";
      campaign_type = "SELF_HELP";
      urgency = "LOW";
      reasoning =
        `Account is ${days} days overdue.${brokenPtpNote} ` +
        "Standard profile at this stage warrants a self-help nudge before any escalation is considered.";
    }
  } else if (effectiveDays <= 30) {
    if (type === "FPD" || type === "NVP") {
      recommended_action =
        "Apply soft lock to the account. Send warning letter. Initiate bureau update process.";
      campaign_type = "SOFT_LOCK";
      urgency = "HIGH";
      reasoning =
        `${type} account at ${days} days overdue.${brokenPtpNote} ` +
        "Soft lock and bureau notice are the mandated lifecycle actions for this profile at this stage to prompt immediate payment.";
    } else if (type === "HIGH_RISK") {
      recommended_action =
        "Activate active predictive dialler campaign. Send combined SMS and email outreach.";
      campaign_type = "ACTIVE_CAMPAIGN";
      urgency = "HIGH";
      reasoning =
        `HIGH_RISK account at ${days} days overdue.${brokenPtpNote} ` +
        "Active multi-channel outreach is required before the suspension threshold is reached.";
    } else {
      recommended_action =
        "Run SMS and email campaign. Issue warning letter of pending service suspension.";
      campaign_type = "ACTIVE_CAMPAIGN";
      urgency = "MEDIUM";
      reasoning =
        `Account is ${days} days overdue.${brokenPtpNote} ` +
        "Multi-channel outreach with a suspension warning is the standard lifecycle action at this stage.";
    }
  } else if (effectiveDays <= 60) {
    if (type === "NVP" || type === "HIGH_RISK") {
      recommended_action =
        "Initiate external trace. Suspend service. Escalate to hard collections team.";
      campaign_type = "TRACE";
      urgency = "HIGH";
      reasoning =
        `${type} account at ${days} days overdue.${brokenPtpNote} ` +
        "External trace is prioritised for this profile. Service suspension is enforced at this lifecycle stage.";
    } else if (type === "TUC") {
      recommended_action =
        "Trigger TUC conversion campaign. Offer a recharge plan to retain the subscriber.";
      campaign_type = "TUC_CONVERSION";
      urgency = "MEDIUM";
      reasoning =
        `TUC subscriber at ${days} days overdue.${brokenPtpNote} ` +
        "A conversion campaign may recover the account without escalating to hard collections.";
    } else {
      recommended_action =
        "Run EC Suspended campaign. Send final notice before transition to hard collections.";
      campaign_type = "EC_SUSPEND";
      urgency = "MEDIUM";
      reasoning =
        `Account is ${days} days overdue.${brokenPtpNote} ` +
        "EC Suspend campaign is the standard lifecycle action at this stage before hard collections handover.";
    }
  } else if (effectiveDays <= 90) {
    const neverpaidNote = type === "NVP" ? " Trigger 90-day neverpaid campaign." : "";
    const bureauNote = sub.bureau_listed
      ? " Bureau listing already in place — skip bureau update."
      : " Update bureau listing.";
    recommended_action =
      `Remove debit order.${neverpaidNote} Initiate hard collections.${bureauNote}`;
    campaign_type = "HARD_COLLECTIONS";
    urgency = "HIGH";
    reasoning =
      `Account is ${days} days overdue.${brokenPtpNote} ` +
      "Hard collections lifecycle applies. Debit order removal is mandatory at this stage. " +
      (sub.bureau_listed
        ? "Bureau listing is already in place."
        : "Bureau update is required as part of the hard collections process.");
  } else if (effectiveDays <= 218) {
    recommended_action =
      "Issue final letter of demand. Initiate PLEA DCA pre-legal allocation. Assign trace campaign.";
    campaign_type = "PRE_LEGAL";
    urgency = "CRITICAL";
    reasoning =
      `Account is ${days} days overdue.${brokenPtpNote} ` +
      "Pre-legal handover is the mandated lifecycle step. A final letter of demand and DCA allocation must be initiated immediately.";
  } else {
    const dcaLevel = sub.dca_placement ?? 1;
    recommended_action = `Escalate DCA placement to level ${dcaLevel}. Apply escalating settlement pressure. Initiate legal proceedings assessment.`;
    campaign_type = "LEGAL";
    urgency = "CRITICAL";
    reasoning =
      `Account is ${days} days overdue at DCA level ${dcaLevel}.${brokenPtpNote} ` +
      "Legal stage requires maximum collection pressure. Escalating DCA placement and litigation assessment are the required actions.";
  }

  return {
    status: "success",
    subscriber_id,
    subscriber_name: sub.name,
    days_overdue: days,
    account_type: type,
    balance_owed: sub.balance_owed,
    bureau_listed: sub.bureau_listed,
    open_epix_tickets: sub.open_epix_tickets,
    last_response: sub.last_response,
    recommended_action,
    campaign_type,
    urgency,
    compliant: true,
    reasoning,
  };
}

// ─── RPA Action Executor ──────────────────────────────────────────────────────

const VALID_ACTION_TYPES = [
  "SEND_SMS", "SEND_EMAIL", "TRIGGER_CALL", "SOFT_LOCK",
  "SUSPEND", "SEND_LETTER", "ALLOCATE_DCA", "WRITE_OFF",
];

function runSimulateRpaAction(subscriber_id, action_type, details) {
  if (!VALID_ACTION_TYPES.includes(action_type)) {
    return {
      status: "error",
      message: `Invalid action_type. Must be one of: ${VALID_ACTION_TYPES.join(", ")}.`,
    };
  }

  const sub = mockDb.getSubscriber(subscriber_id);
  const reference = ref();

  const action = {
    reference,
    subscriber_id,
    subscriber_name: sub?.name ?? "Unknown",
    action_type,
    details: details ?? "",
    status: "COMPLETED",
    executed_at: new Date().toISOString(),
  };

  mockDb.addAction(action);

  return {
    status: "success",
    reference,
    action_type,
    subscriber_id,
    subscriber_name: sub?.name ?? "Unknown",
    message: `RPA action ${action_type} executed for subscriber ${subscriber_id}.`,
    executed_at: action.executed_at,
  };
}

// ─── Tool Executors ───────────────────────────────────────────────────────────

function executeTool(name, args) {
  console.log(`[TOOL] ${name}`, args);

  if (name === "get_subscriber") {
    const sub = mockDb.getSubscriber(args.subscriber_id);
    if (!sub) {
      return { status: "error", message: `Subscriber ${args.subscriber_id} not found.` };
    }
    return { status: "success", subscriber: sub };
  }

  if (name === "get_cohort") {
    let subs = mockDb.getSubscribers();

    if (args.days_overdue_min != null) {
      subs = subs.filter((s) => s.days_overdue >= args.days_overdue_min);
    }
    if (args.days_overdue_max != null) {
      subs = subs.filter((s) => s.days_overdue <= args.days_overdue_max);
    }
    if (args.account_type) {
      subs = subs.filter((s) => s.account_type === args.account_type);
    }
    if (args.service_status) {
      subs = subs.filter((s) => s.service_status === args.service_status);
    }
    if (args.last_response) {
      subs = subs.filter((s) => s.last_response === args.last_response);
    }

    return {
      status: "success",
      count: subs.length,
      subscribers: subs,
    };
  }

  if (name === "recommend_campaign") {
    return runRulesEngine(args.subscriber_id);
  }

  if (name === "simulate_rpa_action") {
    return runSimulateRpaAction(args.subscriber_id, args.action_type, args.details);
  }

  if (name === "get_rpa_log") {
    const log = mockDb.getActionLog();
    return {
      status: "success",
      count: log.length,
      actions: log,
    };
  }

  return { status: "error", message: `Unknown tool: ${name}` };
}

// ─── Shared AI chat loop ──────────────────────────────────────────────────────

async function runChat(userText) {
  const chat = getModel().startChat({ history: [] });
  let result = await chat.sendMessage(userText);

  const tool_calls = [];
  let recommendation = null;
  let maxLoops = 8;

  while (maxLoops-- > 0) {
    const calls = result.response.functionCalls?.();
    if (!calls || calls.length === 0) break;

    console.log("[TOOL LOOP] Requested:", calls.map((c) => c.name).join(", "));

    const toolResponseParts = calls.map((call) => {
      const toolResult = executeTool(call.name, call.args);
      tool_calls.push({ name: call.name, args: call.args, result: toolResult });
      if (call.name === "recommend_campaign" && toolResult.status === "success") {
        recommendation = toolResult;
      }
      return {
        functionResponse: {
          name: call.name,
          response: toolResult,
        },
      };
    });

    result = await chat.sendMessage(toolResponseParts);
  }

  const response = result.response.text();
  return { response, recommendation, tool_calls };
}

// ─── POST /recommend ──────────────────────────────────────────────────────────
// Body: { subscriber_id }
// Returns AI narrative + structured recommendation + tool_calls.

router.post("/recommend", async (req, res) => {
  try {
    const { subscriber_id } = req.body;
    if (!subscriber_id) {
      return res.status(400).json({ error: "subscriber_id is required" });
    }

    const prompt = `Analyse subscriber ${subscriber_id} and provide a campaign recommendation.`;
    const { response, recommendation, tool_calls } = await runChat(prompt);

    console.log("[Agent2] /recommend tool_calls:", JSON.stringify(tool_calls, null, 2));
    res.json({ response, recommendation, tool_calls });
  } catch (error) {
    console.error("[Agent2 ERROR]", error?.message ?? error);
    res.status(500).json({ error: "Failed to generate recommendation", detail: error?.message });
  }
});

// ─── POST /recommend-bulk ─────────────────────────────────────────────────────
// Body: { subscriber_ids: [] }
// Runs the rules engine directly for each subscriber (no AI overhead).

router.post("/recommend-bulk", (req, res) => {
  try {
    const { subscriber_ids = [] } = req.body;
    if (!subscriber_ids.length) {
      return res.status(400).json({ error: "subscriber_ids must be a non-empty array" });
    }

    const recommendations = subscriber_ids.map((id) => runRulesEngine(id));

    console.log(`[Agent2] /recommend-bulk: ${recommendations.length} recommendations generated`);
    res.json({ count: recommendations.length, recommendations });
  } catch (error) {
    console.error("[Agent2 ERROR]", error?.message ?? error);
    res.status(500).json({ error: "Failed to generate bulk recommendations", detail: error?.message });
  }
});

// ─── POST /approve-action ─────────────────────────────────────────────────────
// Body: { subscriber_id, action_type, details }
// Human approval gate — calls simulate_rpa_action after human confirms.

router.post("/approve-action", (req, res) => {
  try {
    const { subscriber_id, action_type, details } = req.body;
    if (!subscriber_id || !action_type) {
      return res.status(400).json({ error: "subscriber_id and action_type are required" });
    }

    const result = runSimulateRpaAction(subscriber_id, action_type, details ?? "");

    if (result.status === "error") {
      return res.status(400).json(result);
    }

    console.log("[Agent2] /approve-action:", JSON.stringify(result, null, 2));
    res.json(result);
  } catch (error) {
    console.error("[Agent2 ERROR]", error?.message ?? error);
    res.status(500).json({ error: "Failed to execute action", detail: error?.message });
  }
});

// ─── GET /subscribers ─────────────────────────────────────────────────────────

router.get("/subscribers", (req, res) => {
  const subscribers = mockDb.getSubscribers();
  res.json({ count: subscribers.length, subscribers });
});

// ─── GET /rpa-log ─────────────────────────────────────────────────────────────

router.get("/rpa-log", (req, res) => {
  const actions = mockDb.getActionLog();
  res.json({ count: actions.length, actions });
});

export default router;
