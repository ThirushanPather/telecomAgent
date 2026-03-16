// ─── State ────────────────────────────────────────────────────────────────────

let allSubscribers    = [];
let filteredSubs      = [];
let selectedIds       = new Set();
let agent2Ready       = false;

// ─── Init ─────────────────────────────────────────────────────────────────────

function initAgent2() {
  if (agent2Ready) return;
  agent2Ready = true;
  loadSubscribers();
  refreshRpaLog();
}

async function loadSubscribers() {
  const tbody = document.getElementById('subscribers-tbody');
  try {
    const res = await fetch('/api/agent2/subscribers');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    allSubscribers = data.subscribers;
    filteredSubs   = allSubscribers;
    document.getElementById('sub-count-badge').textContent = allSubscribers.length;
    renderTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Failed to load: ${esc(err.message)}</td></tr>`;
  }
}

// ─── Table ────────────────────────────────────────────────────────────────────

function applyFilters() {
  const type    = document.getElementById('filter-type').value;
  const daysMin = parseFloat(document.getElementById('filter-days-min').value) || 0;
  const daysMax = parseFloat(document.getElementById('filter-days-max').value) || Infinity;
  const status  = document.getElementById('filter-status').value;

  filteredSubs = allSubscribers.filter(s => {
    if (type   && s.account_type   !== type)   return false;
    if (status && s.service_status !== status)  return false;
    if (s.days_overdue < daysMin || s.days_overdue > daysMax) return false;
    return true;
  });

  const visible = new Set(filteredSubs.map(s => s.id));
  for (const id of [...selectedIds]) if (!visible.has(id)) selectedIds.delete(id);

  renderTable();
  updateSelectionUI();
}

function renderTable() {
  const tbody = document.getElementById('subscribers-tbody');
  if (!filteredSubs.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No subscribers match the current filters.</td></tr>`;
    return;
  }
  tbody.innerHTML = '';
  filteredSubs.forEach(sub => {
    const checked = selectedIds.has(sub.id) ? 'checked' : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="checkbox" ${checked} onchange="toggleRow('${esc(sub.id)}', this)"></td>
      <td class="td-name">${esc(sub.name)}</td>
      <td><span class="badge ${typeBadge(sub.account_type)}">${esc(sub.account_type)}</span></td>
      <td class="td-mono ${sub.days_overdue > 90 ? 'td-red' : ''}">${sub.days_overdue}d</td>
      <td class="td-balance">R ${fmtR(sub.balance_owed)}</td>
      <td><span class="badge ${statusBadge(sub.service_status)}">${esc(sub.service_status)}</span></td>
      <td class="td-mono">${esc(sub.last_response)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function toggleRow(id, cb) {
  cb.checked ? selectedIds.add(id) : selectedIds.delete(id);
  updateSelectionUI();
}

function toggleSelectAll(masterCb) {
  const rows = document.querySelectorAll('#subscribers-tbody input[type="checkbox"]');
  rows.forEach((cb, i) => {
    cb.checked = masterCb.checked;
    const sub = filteredSubs[i];
    if (!sub) return;
    masterCb.checked ? selectedIds.add(sub.id) : selectedIds.delete(sub.id);
  });
  updateSelectionUI();
}

function updateSelectionUI() {
  const n = selectedIds.size;
  document.getElementById('selected-count').textContent = `${n} selected`;
  document.getElementById('analyse-btn').disabled = n === 0;
}

// ─── Analysis ─────────────────────────────────────────────────────────────────

async function analyseSelected() {
  const ids = [...selectedIds];
  if (!ids.length) return;

  const recsPanel  = document.getElementById('recommendations-panel');
  const countBadge = document.getElementById('recs-count-badge');
  const analyseBtn = document.getElementById('analyse-btn');

  recsPanel.innerHTML = '<div class="loading-state">Generating recommendations...</div>';
  countBadge.style.display = 'none';
  analyseBtn.disabled = true;
  clearReasoning();

  try {
    if (ids.length === 1) {
      // Single subscriber — use AI /recommend endpoint with reasoning_steps
      logReason('System', 'Running AI analysis for selected subscriber...', 'info');

      const res = await fetch('/api/agent2/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriber_id: ids[0] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      recsPanel.innerHTML = '';

      if (data.recommendation && data.recommendation.status === 'success') {
        recsPanel.appendChild(buildRecCard(data.recommendation));
        countBadge.textContent = 1;
        countBadge.style.display = 'inline-flex';
      } else {
        recsPanel.innerHTML = '<div class="empty-state">No recommendation could be generated.</div>';
      }

      if (data.reasoning_steps && data.reasoning_steps.length) {
        logReason('Agent Reasoning', 'Step-by-step analysis:', 'info');
        logReasoningSteps(data.reasoning_steps);
      }

    } else {
      // Multiple subscribers — use deterministic /recommend-bulk (faster)
      logReason('System', `Analysing ${ids.length} subscribers via rules engine...`, 'info');

      const res = await fetch('/api/agent2/recommend-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriber_ids: ids }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      recsPanel.innerHTML = '';
      let ok = 0;

      data.recommendations.forEach(rec => {
        if (rec.status === 'success') {
          ok++;
          recsPanel.appendChild(buildRecCard(rec));
          logReason(rec.subscriber_name, rec.reasoning, rec.urgency);
        } else {
          logReason('Error', rec.message || 'Unknown error', 'error');
        }
      });

      if (!ok) {
        recsPanel.innerHTML = '<div class="empty-state">No recommendations could be generated.</div>';
      }

      countBadge.textContent = ok;
      countBadge.style.display = ok > 0 ? 'inline-flex' : 'none';
      logReason('System', `Analysis complete. ${ok} recommendation${ok !== 1 ? 's' : ''} generated.`, 'info');
    }
  } catch (err) {
    recsPanel.innerHTML = `<div class="empty-state">Error: ${esc(err.message)}</div>`;
    logReason('Error', err.message, 'error');
  } finally {
    analyseBtn.disabled = selectedIds.size === 0;
  }
}

// ─── Recommendation Cards ─────────────────────────────────────────────────────

const CAMPAIGN_TO_RPA = {
  SELF_HELP:             'SEND_SMS',
  EARLY_CAMPAIGN:        'TRIGGER_CALL',
  ACTIVE_CAMPAIGN:       'SEND_SMS',
  SOFT_LOCK:             'SOFT_LOCK',
  EC_SUSPEND:            'SUSPEND',
  TRACE:                 'TRIGGER_CALL',
  TUC_CONVERSION:        'SEND_SMS',
  HARD_COLLECTIONS:      'SEND_LETTER',
  PRE_LEGAL:             'SEND_LETTER',
  LEGAL:                 'ALLOCATE_DCA',
  SMALL_BALANCE_WRITE_OFF: 'WRITE_OFF',
  EPIX_HOLD:             'SEND_EMAIL',
};

function buildRecCard(rec) {
  const rpaAction = CAMPAIGN_TO_RPA[rec.campaign_type] || 'SEND_SMS';
  const urgencyClass = rec.campaign_type === 'EPIX_HOLD' ? 'rec-card--HOLD' : `rec-card--${rec.urgency}`;

  const card = document.createElement('div');
  card.className = `rec-card ${urgencyClass}`;
  card.dataset.subId = rec.subscriber_id;

  card.innerHTML = `
    <div class="rec-card-header">
      <div>
        <div class="rec-card-name">${esc(rec.subscriber_name)}</div>
        <div class="rec-card-sub">${esc(rec.subscriber_id)} &nbsp;&bull;&nbsp; ${rec.days_overdue}d overdue &nbsp;&bull;&nbsp; R ${fmtR(rec.balance_owed)}</div>
      </div>
      <div class="rec-card-badges">
        <span class="rec-campaign-badge">${esc(rec.campaign_type)}</span>
        <span class="badge ${urgencyBadge(rec.urgency)}">${esc(rec.urgency)}</span>
      </div>
    </div>
    <div class="rec-card-action">${esc(rec.recommended_action)}</div>
    <div class="rec-card-reasoning">${esc(rec.reasoning)}</div>
    <div class="rec-card-footer">
      <span class="rec-card-rpa-label">RPA: ${esc(rpaAction)}</span>
      <button class="btn btn--primary" style="padding:5px 13px; font-size:11.5px;"
        onclick="approveAction('${esc(rec.subscriber_id)}', '${esc(rpaAction)}', this)">
        Approve &amp; Execute
      </button>
    </div>
  `;
  return card;
}

async function approveAction(subscriberId, actionType, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = 'Executing...';

  try {
    const res = await fetch('/api/agent2/approve-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscriber_id: subscriberId,
        action_type:   actionType,
        details:       'Approved via Campaign Strategy Agent',
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const footer = btnEl.closest('.rec-card-footer');
    footer.innerHTML = `
      <div class="rec-card-approved">
        <span class="badge badge--green">RPA Logged</span>
        <span class="rec-card-ref">${esc(data.reference)}</span>
      </div>
    `;

    logReason(subscriberId, `${actionType} executed successfully. Ref: ${data.reference}`, 'success');
    refreshRpaLog();
  } catch (err) {
    btnEl.disabled = false;
    btnEl.textContent = 'Approve & Execute';
    logReason('Error', `Failed to execute ${actionType} for ${subscriberId}: ${err.message}`, 'error');
  }
}

// ─── Analysis Log ─────────────────────────────────────────────────────────────

const REASON_COLORS = {
  info:     'var(--text-dim)',
  success:  'var(--green)',
  error:    'var(--red)',
  LOW:      'var(--green)',
  MEDIUM:   'var(--amber)',
  HIGH:     'var(--orange)',
  CRITICAL: 'var(--red)',
};

function logReason(label, text, type = 'info') {
  const feed = document.getElementById('agent2-reasoning');
  const empty = feed.querySelector('.activity-empty');
  if (empty) empty.remove();

  const color = REASON_COLORS[type] || 'var(--text-dim)';
  const div = document.createElement('div');
  div.className = 'activity-entry';
  div.innerHTML = `
    <div class="activity-tool" style="color:${color};">${esc(label)}</div>
    <div class="activity-result">${esc(text)}</div>
  `;
  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;
}

function logReasoningSteps(steps) {
  const feed = document.getElementById('agent2-reasoning');
  steps.forEach((step, i) => {
    const div = document.createElement('div');
    div.className = 'activity-entry';
    div.innerHTML = `<div class="activity-step"><span class="activity-step-num">${i + 1}.</span> ${esc(step)}</div>`;
    feed.appendChild(div);
  });
  feed.scrollTop = feed.scrollHeight;
}

function clearReasoning() {
  document.getElementById('agent2-reasoning').innerHTML =
    '<div class="activity-empty">Reasoning will appear here during analysis.</div>';
}

// ─── RPA Action Log ───────────────────────────────────────────────────────────

async function refreshRpaLog() {
  const body  = document.getElementById('rpa-log-body');
  const badge = document.getElementById('rpa-count-badge');
  try {
    const res = await fetch('/api/agent2/rpa-log');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // Only show actions that came from agent2 (have action_type field)
    const a2actions = data.actions.filter(a => a.action_type && VALID_RPA.has(a.action_type));
    badge.textContent = a2actions.length;

    if (!a2actions.length) {
      body.innerHTML = '<div class="empty-state">No RPA actions executed yet.</div>';
      return;
    }

    const reversed = [...a2actions].reverse();
    const table = document.createElement('table');
    table.className = 'rpa-log-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>Time</th>
          <th>Subscriber</th>
          <th>Action</th>
          <th>Reference</th>
          <th>Status</th>
        </tr>
      </thead>
    `;
    const tb = document.createElement('tbody');
    reversed.forEach(a => {
      const t = a.executed_at ? new Date(a.executed_at).toLocaleTimeString('en-ZA') : '—';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${esc(t)}</td>
        <td>${esc(a.subscriber_name || a.subscriber_id || '—')}</td>
        <td><span class="badge badge--muted">${esc(a.action_type)}</span></td>
        <td>${esc(a.reference || '—')}</td>
        <td><span class="badge badge--green">COMPLETED</span></td>
      `;
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    body.innerHTML = '';
    body.appendChild(table);
  } catch (err) {
    body.innerHTML = `<div class="empty-state">Failed to load: ${esc(err.message)}</div>`;
  }
}

const VALID_RPA = new Set([
  'SEND_SMS','SEND_EMAIL','TRIGGER_CALL',
  'SOFT_LOCK','SUSPEND','SEND_LETTER','ALLOCATE_DCA','WRITE_OFF',
]);

// ─── Badge Helpers ────────────────────────────────────────────────────────────

function statusBadge(s) {
  return { ACTIVE:'badge--green', SOFT_LOCKED:'badge--amber', SUSPENDED:'badge--orange', DELETED:'badge--red' }[s] || 'badge--muted';
}
function typeBadge(t) {
  return { FPD:'badge--red', NVP:'badge--orange', HIGH_RISK:'badge--red', TUC:'badge--amber', STANDARD:'badge--muted' }[t] || 'badge--muted';
}
function urgencyBadge(u) {
  return { LOW:'badge--green', MEDIUM:'badge--amber', HIGH:'badge--orange', CRITICAL:'badge--red' }[u] || 'badge--muted';
}

// ─── Utilities ────────────────────────────────────────────────────────────────

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
