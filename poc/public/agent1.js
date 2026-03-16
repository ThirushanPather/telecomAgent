// ─── State ────────────────────────────────────────────────────────────────────

let chatHistory = [];
let currentAccountContext = null;

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadScenarios();
  document.getElementById('agent1-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') agent1Send();
  });
});

// ─── Scenarios ────────────────────────────────────────────────────────────────

async function loadScenarios() {
  const container = document.getElementById('agent1-scenarios');
  try {
    const res = await fetch('/api/agent1/scenarios');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const scenarios = await res.json();
    renderScenarios(scenarios);
  } catch (err) {
    container.innerHTML = `<div class="activity-empty">Failed to load scenarios: ${esc(err.message)}</div>`;
  }
}

function renderScenarios(scenarios) {
  const container = document.getElementById('agent1-scenarios');
  container.innerHTML = '';
  scenarios.forEach(s => {
    const btn = document.createElement('button');
    btn.className = 'scenario-btn';
    btn.innerHTML = `
      <span class="scenario-btn-title">${esc(s.title)}</span>
      <span class="scenario-btn-desc">${esc(s.description)}</span>
    `;
    btn.addEventListener('click', () => selectScenario(s, btn));
    container.appendChild(btn);
  });
}

function selectScenario(scenario, btnEl) {
  document.querySelectorAll('.scenario-btn').forEach(b => b.classList.remove('active'));
  btnEl.classList.add('active');
  currentAccountContext = scenario.subscriber;
  maskCustomerCard(scenario.subscriber.account_number);
  resetChat();
}

// ─── Customer Card ────────────────────────────────────────────────────────────

function maskCustomerCard(accountNumber) {
  const badge = document.getElementById('verify-badge');
  badge.style.display = 'inline-flex';
  badge.textContent = 'Pending Verification';
  badge.className = 'badge badge--muted';

  setVal('cc-acct',    accountNumber, false, true);
  setVal('cc-name',    '—', true);
  setVal('cc-balance', '—', true);
  setVal('cc-days',    '—', true);
  setVal('cc-plan',    '—', true);
  setVal('cc-type',    '—', true);
  document.getElementById('cc-status-wrap').innerHTML =
    `<div class="card-value card-value--masked" id="cc-status">—</div>`;
}

function populateCustomerCard(r) {
  const badge = document.getElementById('verify-badge');
  badge.style.display = 'inline-flex';
  badge.textContent = 'Verified';
  badge.className = 'badge badge--green';

  setVal('cc-acct',    r.account_number);
  setValClass('cc-name',    r.name,   'card-value card-value--name');
  setValClass('cc-balance', `R ${fmtR(r.balance_owed)}`, 'card-value card-value--balance');

  const daysCls = r.days_overdue > 60
    ? 'card-value card-value--overdue'
    : 'card-value';
  setValClass('cc-days', `${r.days_overdue} days`, daysCls);
  setVal('cc-plan',    r.plan || '—');
  setVal('cc-type',    r.account_type);

  const statusWrap = document.getElementById('cc-status-wrap');
  statusWrap.innerHTML = `<span class="badge ${statusBadge(r.service_status)}">${esc(r.service_status)}</span>`;
}

function setVal(id, value, masked = false, mono = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value;
  el.className = 'card-value' +
    (masked ? ' card-value--masked' : '') +
    (mono   ? '' : '');
}

function setValClass(id, value, className) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value;
  el.className = className;
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

function addMessage(sender, text) {
  const box = document.getElementById('agent1-chat-box');
  const div = document.createElement('div');
  div.className = `message ${sender}`;
  div.innerHTML = esc(text).replace(/\n/g, '<br>');
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function newCall() {
  currentAccountContext = null;
  document.querySelectorAll('.scenario-btn').forEach(b => b.classList.remove('active'));

  const badge = document.getElementById('verify-badge');
  badge.style.display = 'none';

  setVal('cc-acct',    '— select a scenario —', true);
  setVal('cc-name',    '—', true);
  setVal('cc-balance', '—', true);
  setVal('cc-days',    '—', true);
  setVal('cc-plan',    '—', true);
  setVal('cc-type',    '—', true);
  document.getElementById('cc-status-wrap').innerHTML =
    `<div class="card-value card-value--masked" id="cc-status">—</div>`;

  resetChat();
}

function resetChat() {
  chatHistory = [];
  document.getElementById('agent1-chat-box').innerHTML = '';
  clearActivity();
  addMessage('bot', 'Hello, thank you for calling Vodacom. My name is Voda. How can I assist you today?');
}

async function agent1Send() {
  const input  = document.getElementById('agent1-input');
  const btn    = document.getElementById('agent1-send-btn');
  const status = document.getElementById('agent1-status');
  const text   = input.value.trim();
  if (!text) return;

  addMessage('user', text);
  input.value = '';
  input.disabled = true;
  btn.disabled   = true;
  status.textContent = 'Voda is typing...';

  try {
    const messages = [...chatHistory, { role: 'user', parts: [{ text }] }];
    const body = { messages };
    if (currentAccountContext && chatHistory.length === 0) {
      body.accountContext = currentAccountContext;
    }

    const res = await fetch('/api/agent1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    chatHistory.push({ role: 'user',  parts: [{ text }] });
    chatHistory.push({ role: 'model', parts: [{ text: data.response }] });

    addMessage('bot', data.response);

    if (data.tool_calls && data.tool_calls.length > 0) {
      renderToolCalls(data.tool_calls);
    }
  } catch (err) {
    console.error(err);
    addMessage('bot', 'Sorry, I could not reach the server. Please check the backend is running.');
  } finally {
    input.disabled = false;
    btn.disabled   = false;
    status.textContent = '';
    input.focus();
  }
}

// ─── Activity Feed ────────────────────────────────────────────────────────────

function renderToolCalls(toolCalls) {
  const feed = document.getElementById('agent1-activity');
  const empty = feed.querySelector('.activity-empty');
  if (empty) empty.remove();

  toolCalls.forEach(tc => {
    feed.appendChild(buildEntry(tc));

    // Auto-populate the customer card on successful verification
    if (tc.name === 'verify_customer_pcc' && tc.result?.status === 'verified') {
      populateCustomerCard(tc.result);
    }
  });

  feed.scrollTop = feed.scrollHeight;
}

function buildEntry(tc) {
  const div = document.createElement('div');
  div.className = 'activity-entry';

  const params = formatParams(tc.args);
  const result = formatResult(tc.name, tc.result);

  div.innerHTML = `
    <div class="activity-tool">${esc(tc.name)}</div>
    ${params ? `<div class="activity-params">${esc(params)}</div>` : ''}
    <div class="activity-result">${esc(result)}</div>
  `;
  return div;
}

function formatParams(args) {
  if (!args || typeof args !== 'object') return '';
  return Object.entries(args).map(([k, v]) => `${k}: ${v}`).join('  |  ');
}

function formatResult(name, r) {
  if (!r) return 'No result';
  if (r.status === 'error') return `Error: ${r.message}`;
  switch (name) {
    case 'verify_customer_pcc':
      return r.status === 'verified'
        ? `Verified — ${r.name} | Balance: R${fmtR(r.balance_owed)} | ${r.days_overdue}d overdue | ${r.service_status}`
        : (r.message || 'Not found');
    case 'check_epix_status':
      return `Open tickets: ${r.open_tickets} | Network: ${r.network_status}`;
    case 'create_payment_arrangement':
    case 'record_promise_to_pay':
    case 'apply_account_extension':
    case 'send_payment_link':
    case 'log_call_outcome':
      return r.message || JSON.stringify(r).slice(0, 120);
    case 'escalate_to_human_agent':
      return `Escalated | Ticket: ${r.ticket_number} | Urgency: ${r.urgency}`;
    default:
      return r.message || JSON.stringify(r).slice(0, 120);
  }
}

function clearActivity() {
  document.getElementById('agent1-activity').innerHTML =
    '<div class="activity-empty">Tool calls will appear here as the conversation progresses.</div>';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(s) {
  return { ACTIVE: 'badge--green', SOFT_LOCKED: 'badge--amber', SUSPENDED: 'badge--orange', DELETED: 'badge--red' }[s] || 'badge--muted';
}

function fmtR(n) {
  return Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
