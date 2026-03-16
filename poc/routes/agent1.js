import { GoogleGenerativeAI } from "@google/generative-ai";
import { Router } from "express";
import twilio from "twilio";
import nodemailer from "nodemailer";
import mockDb from "../data/mockDb.js";

const router = Router();

// ─── Twilio WhatsApp helper ────────────────────────────────────────────────────

async function sendWhatsApp(subscriberName, accountNumber, balance) {
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const body =
    `Vodacom Credit & Collections: Dear ${subscriberName}, your account ` +
    `${accountNumber} has an outstanding balance of R${Number(balance).toFixed(2)}. ` +
    `Please make payment at: https://pay.vodacom.co.za/${accountNumber} ` +
    `- Reply HELP for assistance.`;
  const msg = await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_FROM,
    to:   process.env.TWILIO_WHATSAPP_TO,
    body,
  });
  console.log(`[WhatsApp] Sent SID=${msg.sid} to ${process.env.TWILIO_WHATSAPP_TO}`);
}

// ─── Nodemailer Gmail helper ───────────────────────────────────────────────────

async function sendEmail(subscriberName, accountNumber, balance, daysOverdue) {
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: process.env.SMTP_EMAIL,
      pass: process.env.SMTP_PASSWORD,
    },
  });
  const text =
    `Dear ${subscriberName},\n\n` +
    `This is a reminder that your Vodacom account ${accountNumber} has an ` +
    `outstanding balance of R${Number(balance).toFixed(2)} which is ${daysOverdue} days overdue.\n\n` +
    `Please make payment immediately to avoid further action.\n\n` +
    `Payment link: https://pay.vodacom.co.za/${accountNumber}\n\n` +
    `If you have already made payment, please disregard this notice.\n\n` +
    `Vodacom Credit and Collections`;
  const info = await transporter.sendMail({
    from: process.env.SMTP_EMAIL,
    to:   process.env.SMTP_RECIPIENT,
    subject: `Vodacom Account ${accountNumber} — Payment Required`,
    text,
  });
  console.log(`[Email] Sent messageId=${info.messageId} to ${process.env.SMTP_RECIPIENT}`);
}

// ─── Lazy Gemini model ────────────────────────────────────────────────────────

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
You are Voda, an AI collections agent for Vodacom South Africa. You work in the Credit and Collections department and handle inbound and outbound customer calls regarding overdue accounts.

IDENTITY AND TONE:
- Your name is Voda. Do not introduce yourself as anything else.
- Communicate in plain, professional English only.
- Do not use emojis, exclamation marks used for enthusiasm, filler phrases such as "Great!", "Absolutely!", "Of course!", "Certainly!", or any informal language.
- Be empathetic but direct. Keep responses concise and factual.
- Never speculate on system data. Only state what the tools return.

CALL FLOW — follow this sequence on every call:
1. VERIFY: Before discussing any account details, require the customer to provide their account number, then call verify_customer_pcc. This is a legal requirement under POPIA. Do not proceed without successful verification.
2. ASSESS: Once verified, review the balance, days overdue, and service status returned by the tool.
3. NEGOTIATE: Offer resolution options in strict priority order:
   a. Full payment — send a payment link immediately via send_payment_link
   b. Payment arrangement — monthly instalments via create_payment_arrangement
   c. Promise to pay — a firm commitment to pay by a specific date via record_promise_to_pay
   d. Account extension — only valid if days_overdue is less than 30; use apply_account_extension
   e. Escalate to human agent — last resort; use escalate_to_human_agent
4. RESOLVE: Confirm the agreed action. If payment is involved, always use send_payment_link — never collect payment details verbally.
5. CLOSE: Call log_call_outcome before ending every conversation without exception. Summarise what was agreed and what happens next.

RULES:
- Never discuss any account details before successful verification via verify_customer_pcc.
- Never collect card numbers, banking details, or PINs verbally under any circumstances. Always use send_payment_link.
- Never threaten legal action, credit bureau listing, or debt collector referral unless the account's days_overdue is 90 or greater.
- If a customer disputes their balance, call check_epix_status before responding to check for billing anomalies or open tickets.
- If a customer reports a service issue, call check_epix_status before suggesting it is payment-related.

OBJECTION HANDLING:
- "I already paid" or disputed balance: Acknowledge, call check_epix_status for billing discrepancies. If unresolved, escalate via escalate_to_human_agent with reason "payment not reflected".
- "I cannot afford the full amount": Offer create_payment_arrangement. Frame it as the most flexible option available.
- "My service is not working": Call check_epix_status first. If an open ticket exists, acknowledge it and note the reference. If the service was suspended due to non-payment, explain that payment will restore service within a defined timeframe.
- "I want to speak to a manager or supervisor": Use escalate_to_human_agent with urgency set to HIGH immediately without pushback.
- "This is unfair" or general frustration: Acknowledge the frustration briefly, then redirect to what can be resolved on the call.
`.trim();

// ─── Tool Declarations ────────────────────────────────────────────────────────

const tools = [
  {
    functionDeclarations: [
      {
        name: "verify_customer_pcc",
        description:
          "Queries the PCC billing system to verify a customer's identity and retrieve their account details. Must be called before any account information is discussed. Required for POPIA compliance.",
        parameters: {
          type: "OBJECT",
          properties: {
            account_number: {
              type: "STRING",
              description: "The customer's Vodacom account number (e.g. VDC-123456789).",
            },
          },
          required: ["account_number"],
        },
      },
      {
        name: "check_epix_status",
        description:
          "Queries the EPIX system for open service tickets, network status, and unbilled data for the account. Call this when a customer disputes their bill or reports a service issue.",
        parameters: {
          type: "OBJECT",
          properties: {
            account_number: {
              type: "STRING",
              description: "The customer's Vodacom account number.",
            },
          },
          required: ["account_number"],
        },
      },
      {
        name: "create_payment_arrangement",
        description:
          "Creates a formal payment arrangement (instalment plan) for an overdue account. Use this when the customer cannot pay in full but agrees to fixed monthly payments.",
        parameters: {
          type: "OBJECT",
          properties: {
            account_number: {
              type: "STRING",
              description: "The customer's Vodacom account number.",
            },
            monthly_amount: {
              type: "NUMBER",
              description: "The agreed monthly instalment amount in Rands.",
            },
            num_months: {
              type: "NUMBER",
              description: "The number of months over which the balance will be paid.",
            },
          },
          required: ["account_number", "monthly_amount", "num_months"],
        },
      },
      {
        name: "record_promise_to_pay",
        description:
          "Records a customer's verbal commitment to pay a specific amount by a specific date. Use when the customer agrees to pay but cannot do so right now.",
        parameters: {
          type: "OBJECT",
          properties: {
            account_number: {
              type: "STRING",
              description: "The customer's Vodacom account number.",
            },
            promise_date: {
              type: "STRING",
              description: "The date the customer has committed to pay, in YYYY-MM-DD format.",
            },
            amount: {
              type: "NUMBER",
              description: "The amount the customer has committed to pay in Rands.",
            },
          },
          required: ["account_number", "promise_date", "amount"],
        },
      },
      {
        name: "apply_account_extension",
        description:
          "Applies a payment due date extension to an account. Only valid when the account is fewer than 30 days overdue. Do not offer or attempt this for accounts 30 or more days overdue.",
        parameters: {
          type: "OBJECT",
          properties: {
            account_number: {
              type: "STRING",
              description: "The customer's Vodacom account number.",
            },
            extension_days: {
              type: "NUMBER",
              description: "Number of additional days to extend the due date. Maximum 14.",
            },
          },
          required: ["account_number", "extension_days"],
        },
      },
      {
        name: "send_payment_link",
        description:
          "Sends a secure payment link to the customer via SMS or email. Use this whenever the customer agrees to pay. Never collect payment details verbally — always use this tool instead.",
        parameters: {
          type: "OBJECT",
          properties: {
            account_number: {
              type: "STRING",
              description: "The customer's Vodacom account number.",
            },
            channel: {
              type: "STRING",
              description: "Delivery channel for the payment link. Must be SMS or EMAIL.",
            },
          },
          required: ["account_number", "channel"],
        },
      },
      {
        name: "escalate_to_human_agent",
        description:
          "Escalates the call to a human collections agent. Use when: the customer requests a manager, the dispute cannot be resolved via tools, or the situation requires manual intervention.",
        parameters: {
          type: "OBJECT",
          properties: {
            account_number: {
              type: "STRING",
              description: "The customer's Vodacom account number.",
            },
            reason: {
              type: "STRING",
              description: "A brief description of why the escalation is needed.",
            },
            urgency: {
              type: "STRING",
              description: "Urgency level: LOW, MEDIUM, or HIGH.",
            },
          },
          required: ["account_number", "reason", "urgency"],
        },
      },
      {
        name: "log_call_outcome",
        description:
          "Logs the final outcome of the call. Must be called before every conversation ends without exception.",
        parameters: {
          type: "OBJECT",
          properties: {
            account_number: {
              type: "STRING",
              description: "The customer's Vodacom account number.",
            },
            outcome: {
              type: "STRING",
              description:
                "The call outcome. Must be one of: PAID, PTP, ARRANGEMENT, DISPUTE, ESCALATED, NO_RESOLUTION.",
            },
            notes: {
              type: "STRING",
              description: "A brief summary of what was discussed and agreed on the call.",
            },
          },
          required: ["account_number", "outcome", "notes"],
        },
      },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ref() {
  return `REF-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function dateFromToday(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split("T")[0];
}

const PLAN_BY_TYPE = {
  STANDARD: "Vodacom Smart M (500MB + Unlimited WhatsApp)",
  NVP: "Vodacom Smart S (200MB)",
  FPD: "Vodacom Smart S (200MB)",
  HIGH_RISK: "Vodacom Red (10GB + Unlimited Calls)",
  TUC: "Vodacom Smart XL (5GB)",
};

function findSubscriber(account_number) {
  return mockDb
    .getSubscribers()
    .find((s) => s.account_number === account_number);
}

// ─── Tool Executors ───────────────────────────────────────────────────────────

function executeTool(name, args) {
  console.log(`[TOOL] ${name}`, args);

  if (name === "verify_customer_pcc") {
    const sub = findSubscriber(args.account_number);
    if (!sub) {
      return {
        status: "not_found",
        message: "No account found matching that account number. Please ask the customer to confirm their account number.",
      };
    }
    const due_date = dateFromToday(-sub.days_overdue);
    return {
      status: "verified",
      name: sub.name,
      account_number: sub.account_number,
      balance_owed: sub.balance_owed,
      days_overdue: sub.days_overdue,
      service_status: sub.service_status,
      account_type: sub.account_type,
      plan: PLAN_BY_TYPE[sub.account_type] ?? "Vodacom Smart M",
      due_date,
      bureau_listed: sub.bureau_listed,
      dca_placement: sub.dca_placement,
    };
  }

  if (name === "check_epix_status") {
    const sub = findSubscriber(args.account_number);
    if (!sub) {
      return { status: "error", message: "Account not found in EPIX." };
    }
    const hasTicket = sub.open_epix_tickets;
    return {
      status: "success",
      account_number: sub.account_number,
      open_tickets: hasTicket ? 1 : 0,
      ticket_reference: hasTicket ? `TKT-${sub.id}-001` : null,
      ticket_description: hasTicket
        ? "Billing query: customer reported incorrect charge on last invoice."
        : null,
      network_status:
        sub.service_status === "ACTIVE" ? "Fully Operational" : "Service impacted due to account status",
      unbilled_data: `${(Math.random() * 3).toFixed(1)} GB`,
      last_bill_date: dateFromToday(-30),
    };
  }

  if (name === "create_payment_arrangement") {
    const sub = findSubscriber(args.account_number);
    if (!sub) {
      return { status: "error", message: "Account not found." };
    }
    const total = args.monthly_amount * args.num_months;
    const arrangement = {
      type: "payment_arrangement",
      account_number: args.account_number,
      monthly_amount: args.monthly_amount,
      num_months: args.num_months,
      total_committed: parseFloat(total.toFixed(2)),
      first_payment_date: dateFromToday(7),
      reference: ref(),
      logged_at: new Date().toISOString(),
    };
    mockDb.addAction(arrangement);
    mockDb.updateSubscriber(sub.id, { last_response: "PTP", last_contact_date: dateFromToday(0) });
    return {
      status: "success",
      message: `Payment arrangement created. ${args.num_months} monthly payments of R${args.monthly_amount}. First payment due ${arrangement.first_payment_date}.`,
      reference: arrangement.reference,
    };
  }

  if (name === "record_promise_to_pay") {
    const sub = findSubscriber(args.account_number);
    if (!sub) {
      return { status: "error", message: "Account not found." };
    }
    const ptp = {
      type: "promise_to_pay",
      account_number: args.account_number,
      promise_date: args.promise_date,
      amount: args.amount,
      reference: ref(),
      logged_at: new Date().toISOString(),
    };
    mockDb.addAction(ptp);
    mockDb.updateSubscriber(sub.id, { last_response: "PTP", last_contact_date: dateFromToday(0) });
    return {
      status: "success",
      message: `Promise to pay recorded. Customer has committed to pay R${args.amount} by ${args.promise_date}.`,
      reference: ptp.reference,
    };
  }

  if (name === "apply_account_extension") {
    const sub = findSubscriber(args.account_number);
    if (!sub) {
      return { status: "error", message: "Account not found." };
    }
    if (sub.days_overdue >= 30) {
      return {
        status: "error",
        message: `Extension not available. Account is ${sub.days_overdue} days overdue. Extensions are only available for accounts fewer than 30 days overdue.`,
      };
    }
    const days = Math.min(args.extension_days, 14);
    const new_due_date = dateFromToday(days);
    const extension = {
      type: "account_extension",
      account_number: args.account_number,
      extension_days: days,
      new_due_date,
      reference: ref(),
      logged_at: new Date().toISOString(),
    };
    mockDb.addAction(extension);
    return {
      status: "success",
      message: `Extension of ${days} days applied. New payment due date is ${new_due_date}.`,
      new_due_date,
      reference: extension.reference,
    };
  }

  if (name === "send_payment_link") {
    const sub = findSubscriber(args.account_number);
    if (!sub) {
      return { status: "error", message: "Account not found." };
    }
    const channel = args.channel?.toUpperCase();
    if (!["SMS", "EMAIL"].includes(channel)) {
      return { status: "error", message: "Channel must be SMS or EMAIL." };
    }
    const destination = channel === "SMS" ? sub.msisdn : sub.name.split(" ")[0].toLowerCase() + "@vodacom.co.za";
    const link = {
      type: "payment_link",
      account_number: args.account_number,
      channel,
      destination,
      reference: ref(),
      logged_at: new Date().toISOString(),
    };
    mockDb.addAction(link);

    // Fire real communications — errors are logged but never surface to the agent.
    sendWhatsApp(sub.name, args.account_number, sub.balance_owed)
      .catch((e) => console.error("[WhatsApp] Failed:", e.message));

    if (channel === "EMAIL") {
      sendEmail(sub.name, args.account_number, sub.balance_owed, sub.days_overdue)
        .catch((e) => console.error("[Email] Failed:", e.message));
    }

    return {
      status: "success",
      message: `Secure payment link sent via ${channel} to ${destination}.`,
      reference: link.reference,
    };
  }

  if (name === "escalate_to_human_agent") {
    const sub = findSubscriber(args.account_number);
    const ticket_number = `ESC-${Date.now().toString().slice(-6)}`;
    const escalation = {
      type: "escalation",
      account_number: args.account_number,
      reason: args.reason,
      urgency: args.urgency,
      ticket_number,
      logged_at: new Date().toISOString(),
    };
    mockDb.addAction(escalation);
    if (sub) {
      mockDb.updateSubscriber(sub.id, { last_response: "NO_ANSWER", last_contact_date: dateFromToday(0) });
    }
    return {
      status: "success",
      message: `Escalation raised. A human agent will contact the customer. Ticket: ${ticket_number}.`,
      ticket_number,
      urgency: args.urgency,
    };
  }

  if (name === "log_call_outcome") {
    const validOutcomes = ["PAID", "PTP", "ARRANGEMENT", "DISPUTE", "ESCALATED", "NO_RESOLUTION"];
    if (!validOutcomes.includes(args.outcome)) {
      return {
        status: "error",
        message: `Invalid outcome. Must be one of: ${validOutcomes.join(", ")}.`,
      };
    }
    const sub = findSubscriber(args.account_number);
    const log = {
      type: "call_outcome",
      account_number: args.account_number,
      outcome: args.outcome,
      notes: args.notes,
      logged_at: new Date().toISOString(),
    };
    mockDb.addAction(log);
    if (sub) {
      const responseMap = {
        PAID: "PAID",
        PTP: "PTP",
        ARRANGEMENT: "PTP",
        DISPUTE: "DISPUTE",
        ESCALATED: "NO_ANSWER",
        NO_RESOLUTION: "NO_ANSWER",
      };
      mockDb.updateSubscriber(sub.id, {
        last_response: responseMap[args.outcome],
        last_contact_method: "CALL",
        last_contact_date: dateFromToday(0),
      });
    }
    return {
      status: "success",
      message: `Call outcome logged: ${args.outcome}.`,
    };
  }

  return { status: "error", message: `Unknown tool: ${name}` };
}

// ─── POST /chat ───────────────────────────────────────────────────────────────
// Body: { messages: [{role, parts}...], accountContext?: {...subscriber} }
// messages[0..n-2] = prior history, messages[n-1] = latest user message.

router.post("/chat", async (req, res) => {
  try {
    const { messages = [], accountContext } = req.body;

    if (!messages.length) {
      return res.status(400).json({ error: "messages array is required and must not be empty" });
    }

    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== "user") {
      return res.status(400).json({ error: "Last message in messages array must be a user message" });
    }

    const history = messages.slice(0, -1);
    const userText = lastMsg.parts.map((p) => p.text).join("");

    // If an accountContext object is provided, prepend it as context for this turn.
    // Injected as a user/model exchange at the top of history so the model has
    // the subscriber record without needing to call verify_customer_pcc first.
    let effectiveHistory = history;
    if (accountContext && history.length === 0) {
      effectiveHistory = [
        {
          role: "user",
          parts: [{ text: `[SYSTEM CONTEXT — do not repeat this to the customer] Active account context loaded:\n${JSON.stringify(accountContext, null, 2)}` }],
        },
        {
          role: "model",
          parts: [{ text: "Account context received. I will use this information during the call." }],
        },
      ];
    }

    const chat = getModel().startChat({ history: effectiveHistory });
    let result = await chat.sendMessage(userText);

    const tool_calls = [];
    let maxLoops = 5;

    while (maxLoops-- > 0) {
      const calls = result.response.functionCalls?.();
      if (!calls || calls.length === 0) break;

      console.log("[TOOL LOOP] Requested:", calls.map((c) => c.name).join(", "));

      const toolResponseParts = calls.map((call) => {
        const toolResult = executeTool(call.name, call.args);
        tool_calls.push({ name: call.name, args: call.args, result: toolResult });
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
    console.log("[Agent1] tool_calls:", JSON.stringify(tool_calls, null, 2));
    res.json({ response, tool_calls });
  } catch (error) {
    console.error("[Agent1 ERROR]", error?.message ?? error);
    res.status(500).json({ error: "Failed to generate response", detail: error?.message });
  }
});

// ─── GET /scenarios ───────────────────────────────────────────────────────────
// Returns 5 pre-built demo scenarios, each matched to a real subscriber in mockDb.

router.get("/scenarios", (req, res) => {
  const all = mockDb.getSubscribers();

  function find(predicate, fallback = 0) {
    return all.find(predicate) ?? all[fallback];
  }

  const scenarios = [
    {
      id: 1,
      title: "Suspended line with open service ticket",
      description: "Customer calls about a suspended line. EPIX has an open billing ticket.",
      subscriber: find(
        (s) => s.service_status === "SUSPENDED" && s.open_epix_tickets === true
      ),
    },
    {
      id: 2,
      title: "Payment arrangement request",
      description: "Customer is 30-60 days overdue and wants to set up a payment arrangement.",
      subscriber: find(
        (s) => s.days_overdue >= 30 && s.days_overdue <= 60
      ),
    },
    {
      id: 3,
      title: "Disputed balance",
      description: "Customer claims they have already paid and disputes the outstanding balance.",
      subscriber: find(
        (s) => s.last_response === "DISPUTE" || s.open_epix_tickets === true,
        2
      ),
    },
    {
      id: 4,
      title: "Promise to pay",
      description: "Customer is 15-30 days overdue and wants to commit to paying by end of week.",
      subscriber: find(
        (s) => s.days_overdue >= 15 && s.days_overdue <= 30
      ),
    },
    {
      id: 5,
      title: "Pre-legal escalation",
      description: "Customer is 90+ days overdue, uncooperative, and requires pre-legal escalation.",
      subscriber: find(
        (s) => s.days_overdue >= 90 && s.bureau_listed === true
      ),
    },
  ];

  res.json(scenarios);
});

export default router;
