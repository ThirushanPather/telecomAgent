// ─── State ────────────────────────────────────────────────────────────────────

let chatHistory = [];
let currentAccountContext = null;
let voiceMode = false;
let currentAudio = null;
let recognition = null;

// ─── Scenario Opening Messages ────────────────────────────────────────────────

const SCENARIO_OPENERS = {
  1: (sub) => `Hi, my name is ${sub.name} and my line has been suspended. My account number is ${sub.account_number}. Can you help me?`,
  2: (sub) => `Hello, I am ${sub.name}, account number ${sub.account_number}. I have been struggling to pay my bill and would like to set up a payment arrangement if possible.`,
  3: (sub) => `Good day, this is ${sub.name}. My account number is ${sub.account_number}. I believe I already paid my balance but it is still showing as overdue. Can you check this?`,
  4: (sub) => `Hi, my name is ${sub.name}, account number ${sub.account_number}. I cannot pay right now but I can commit to paying by the end of this week.`,
  5: (sub) => `Hello, I am ${sub.name} and my account number is ${sub.account_number}. I have been receiving pre-legal notices and I need to understand my options before this goes further.`,
};

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadScenarios();
  document.getElementById('agent1-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') agent1Send();
  });
  initVoice();
  const voiceToggleCheckbox = document.getElementById('voice-mode-toggle');
  if (voiceToggleCheckbox) {
    voiceToggleCheckbox.addEventListener('change', function() {
      onVoiceToggle(this.checked);
    });
  }
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
    setTimeout(() => { container.innerHTML = '<div class="activity-empty">Reload the page to retry.</div>'; }, 5000);
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

async function selectScenario(scenario, btnEl) {
  document.querySelectorAll('.scenario-btn').forEach(b => b.classList.remove('active'));
  btnEl.classList.add('active');
  currentAccountContext = scenario.subscriber;
  maskCustomerCard(scenario.subscriber.account_number);
  resetChat();

  const opener = SCENARIO_OPENERS[scenario.id];
  if (opener && scenario.subscriber) {
    const input = document.getElementById('agent1-input');
    input.value = opener(scenario.subscriber);
    await agent1Send();
  }
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
    speakReply(data.response);

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

  // Prepend in reverse so the batch appears top-to-bottom in call order,
  // with this batch above any entries from earlier in the conversation.
  [...toolCalls].reverse().forEach(tc => {
    feed.insertBefore(buildEntry(tc), feed.firstChild);

    // Auto-populate the customer card on successful verification
    if (tc.name === 'verify_customer_pcc' && tc.result?.status === 'verified') {
      populateCustomerCard(tc.result);
    }
  });
}

function buildEntry(tc) {
  const div = document.createElement('div');
  div.className = 'activity-entry';

  const params = formatParams(tc.args);
  const result = formatResult(tc.name, tc.result);

  const toolLine = params
    ? `[TOOL] ${tc.name}  |  ${params}`
    : `[TOOL] ${tc.name}`;

  div.innerHTML = `
    <div class="activity-tool">${esc(toolLine)}</div>
    <div class="activity-result">Result: ${esc(result)}</div>
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

// ─── Voice Mode ────────────────────────────────────────────────────────────────

function initVoice() {
  const micBtn = document.getElementById('mic-btn');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SR) {
    // Insert a note that appears only when voice mode is toggled on without SR support
    const note = document.createElement('span');
    note.id = 'no-voice-note';
    note.style.cssText = 'font-size:10px; color:var(--text-dim); display:none;';
    note.textContent = 'Voice input requires Chrome';
    micBtn.insertAdjacentElement('afterend', note);
    return;
  }

  recognition = new SR();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-ZA';

  recognition.onresult = (e) => {
    let transcript = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      transcript += e.results[i][0].transcript;
    }
    document.getElementById('agent1-input').value = transcript;
  };

  recognition.onend = () => {
    micBtn.classList.remove('recording');
    const input = document.getElementById('agent1-input');
    if (input.value.trim() && voiceMode) {
      agent1Send();
    }
  };

  recognition.onerror = (e) => {
    micBtn.classList.remove('recording');
    if (e.error !== 'no-speech' && e.error !== 'aborted') {
      const status = document.getElementById('agent1-status');
      status.textContent = `Voice error: ${e.error}`;
      setTimeout(() => { status.textContent = ''; }, 3000);
    }
  };

  micBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    document.getElementById('agent1-input').value = '';
    try { recognition.start(); } catch (_) {}
    micBtn.classList.add('recording');
  });

  micBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    document.getElementById('agent1-input').value = '';
    try { recognition.start(); } catch (_) {}
    micBtn.classList.add('recording');
  }, { passive: false });

  micBtn.addEventListener('mouseup', () => { try { recognition.stop(); } catch (_) {} });
  micBtn.addEventListener('touchend', () => { try { recognition.stop(); } catch (_) {} });
}

function onVoiceToggle(on) {
  voiceMode = on;
  const micBtn    = document.getElementById('mic-btn');
  const indicator = document.getElementById('voice-active-indicator');
  const noNote    = document.getElementById('no-voice-note');

  if (on) {
    if (recognition) {
      micBtn.style.display = 'inline-flex';
    } else if (noNote) {
      noNote.style.display = 'inline';
    }
    indicator.style.display = 'inline-flex';
  } else {
    micBtn.style.display = 'none';
    if (noNote) noNote.style.display = 'none';
    indicator.style.display = 'none';
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
  }
}

// ─── Phone Call Mode ────────────────────────────────────────────────────────────

let phoneCallActive      = false;
let phoneCallWs          = null;
let isAgentSpeaking      = false;

// Web Audio context — created lazily on first user interaction.
let audioCtx             = null;
let nextAudioTime        = 0;        // scheduled end of last queued chunk
let activeSources        = [];       // BufferSourceNodes currently playing

// AudioWorklet capture (replaces MediaRecorder)
let audioStream          = null;     // MediaStream from getUserMedia
let audioWorkletNode     = null;     // AudioWorkletNode for PCM capture

async function loadCallSubscribers() {
  const select = document.getElementById('call-subscriber-select');
  try {
    const res = await fetch('/api/agent2/subscribers');
    if (!res.ok) return;
    const data = await res.json();
    select.innerHTML = '<option value="">— select a customer —</option>';
    data.subscribers.forEach(s => {
      const opt = document.createElement('option');
      opt.value = JSON.stringify({ name: s.name, account_number: s.account_number, msisdn: s.msisdn });
      opt.textContent = `${s.id} — ${s.name} (${s.days_overdue} days overdue)`;
      select.appendChild(opt);
    });
  } catch (_) {
    select.innerHTML = '<option value="">— failed to load —</option>';
  }
}

function injectSubscriber() {
  const select = document.getElementById('call-subscriber-select');
  if (!select.value) return;
  const sub = JSON.parse(select.value);
  const msisdn = sub.msisdn.replace('+', '');
  sendTextToAgent(
    `My name is ${sub.name}, my account number is ${sub.account_number} and my MSISDN is ${msisdn}`
  );
}

function sendTextToAgent(text) {
  if (!phoneCallWs || phoneCallWs.readyState !== WebSocket.OPEN) return;
  phoneCallWs.send(JSON.stringify({ type: 'text_input', text }));
  appendCallTranscript('user', text);
}

function sendCallText() {
  const input = document.getElementById('call-text-input');
  const text = input.value.trim();
  if (!text) return;
  sendTextToAgent(text);
  input.value = '';
}

function startPhoneCall() {
  const sessionId = crypto.randomUUID();

  // Hide chat content, show overlay.
  document.getElementById('agent1-chat-box').style.display  = 'none';
  document.getElementById('agent1-status').style.display    = 'none';
  document.getElementById('agent1-input-row').style.display = 'none';
  document.getElementById('phone-call-overlay').style.display = 'flex';

  loadCallSubscribers();
  setCallStatus('Connecting...');

  const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  phoneCallWs = new WebSocket(`${wsProto}//${location.host}/ws/phone-call/${sessionId}`);
  phoneCallWs.binaryType = 'arraybuffer';

  phoneCallWs.onopen = async () => {
    setCallStatus('Connected — speak to Voda');
    phoneCallActive = true;
    nextAudioTime = 0;

    try {
      audioStream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });

      // AudioContext must be created after a user gesture.
      audioCtx = new AudioContext({ sampleRate: 16000 });

      const source = audioCtx.createMediaStreamSource(audioStream);
      await audioCtx.audioWorklet.addModule('/audio-processor.js');
      audioWorkletNode = new AudioWorkletNode(audioCtx, 'pcm-processor');
      source.connect(audioWorkletNode);

      let _chunkCount = 0;
      audioWorkletNode.port.onmessage = (ev) => {
        if (phoneCallWs?.readyState === WebSocket.OPEN) {
          _chunkCount++;
          if (_chunkCount <= 5 || _chunkCount % 50 === 0) {
            console.log(`[Phone] Sending PCM chunk #${_chunkCount}: ${ev.data.byteLength} bytes`);
          }
          phoneCallWs.send(ev.data);
        }
      };

      console.log('[Phone] AudioWorklet PCM capture started at 16 kHz');
    } catch (err) {
      setCallStatus(`Mic error: ${esc(err.message)}`);
    }
  };

  phoneCallWs.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch (_) { return; }
    if (msg.type !== 'audio') {
      console.log('[Phone] WS message received:', msg);
    } else {
      console.log('[Phone] WS audio chunk received, sampleRate:', msg.sampleRate,
                  'data length:', msg.data?.length);
    }
    handleCallMessage(msg);
  };

  phoneCallWs.onclose = () => endPhoneCall();
  phoneCallWs.onerror = () => { setCallStatus('Connection error'); endPhoneCall(); };
}

function handleCallMessage(msg) {
  switch (msg.type) {
    case 'audio':
      isAgentSpeaking = true;
      setCallStatus('Agent speaking...');
      document.getElementById('call-interrupt-btn').style.display = 'inline-flex';
      playPCMChunk(msg.data, msg.sampleRate || 24000);
      break;

    case 'transcript':
      appendCallTranscript(msg.role, msg.text);
      break;

    case 'tool_call':
      appendCallToolEntry(msg.name, msg.result);
      break;

    case 'turn_end':
      isAgentSpeaking = false;
      document.getElementById('call-interrupt-btn').style.display = 'none';
      setCallStatus('Listening...');
      break;

    case 'error':
      setCallStatus(`Error: ${esc(msg.message)}`);
      setTimeout(() => endPhoneCall(), 2000);
      break;
  }
}

function endPhoneCall() {
  // Stop AudioWorklet capture
  if (audioWorkletNode) {
    audioWorkletNode.disconnect();
    audioWorkletNode = null;
  }
  if (audioStream) {
    audioStream.getTracks().forEach(t => t.stop());
    audioStream = null;
  }
  if (audioCtx && audioCtx.state !== 'closed') {
    audioCtx.close();
    audioCtx = null;
  }

  if (phoneCallWs) {
    phoneCallWs.onclose = null; // prevent re-entry
    phoneCallWs.close();
    phoneCallWs = null;
  }

  stopAllCallAudio();

  document.getElementById('phone-call-overlay').style.display = 'none';
  document.getElementById('agent1-chat-box').style.display    = '';
  document.getElementById('agent1-status').style.display      = '';
  document.getElementById('agent1-input-row').style.display   = '';

  phoneCallActive = false;
  isAgentSpeaking = false;
  setCallStatus('');
}

function interruptAgent() {
  if (phoneCallWs?.readyState === WebSocket.OPEN) {
    phoneCallWs.send(JSON.stringify({ type: 'interrupt' }));
  }
  stopAllCallAudio();
  isAgentSpeaking = false;
  document.getElementById('call-interrupt-btn').style.display = 'none';
  setCallStatus('Listening...');
}

// PCM 16-bit signed mono → Web Audio API gapless playback.
function playPCMChunk(base64Data, sampleRate) {
  if (!audioCtx) return;
  try {
    const binary = atob(base64Data);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const pcm16   = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768.0;

    const buffer = audioCtx.createBuffer(1, float32.length, sampleRate || 24000);
    buffer.copyToChannel(float32, 0);

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);

    // Schedule chunks back-to-back for gapless playback.
    const startTime = Math.max(audioCtx.currentTime + 0.05, nextAudioTime);
    source.start(startTime);
    nextAudioTime = startTime + buffer.duration;

    activeSources.push(source);
    source.onended = () => {
      const idx = activeSources.indexOf(source);
      if (idx !== -1) activeSources.splice(idx, 1);
    };
  } catch (_) {}
}

function stopAllCallAudio() {
  for (const src of activeSources) { try { src.stop(); } catch (_) {} }
  activeSources = [];
  nextAudioTime = 0;
}

function setCallStatus(text) {
  const el = document.getElementById('call-status');
  if (el) el.textContent = text;
}

function appendCallTranscript(role, text) {
  const feed = document.getElementById('call-transcript');
  if (!feed) return;
  const div = document.createElement('div');
  div.className = role === 'user' ? 'message user' : 'message bot';
  div.textContent = text;
  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;
}

function appendCallToolEntry(name, result) {
  const feed = document.getElementById('call-transcript');
  if (!feed) return;
  const div = document.createElement('div');
  div.className = 'activity-entry';
  div.style.cssText = 'width:100%;';
  div.innerHTML = `<div class="activity-tool">${esc(name)}</div>`
    + `<div class="activity-result">${esc(JSON.stringify(result))}</div>`;
  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;
}

window.startPhoneCall   = startPhoneCall;
window.endPhoneCall     = endPhoneCall;
window.interruptAgent   = interruptAgent;
window.injectSubscriber = injectSubscriber;
window.sendCallText     = sendCallText;

async function speakReply(text) {
  if (!voiceMode) return;
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return; // 503 or other — silent fallback
    const blob = new Blob([await res.arrayBuffer()], { type: 'audio/mpeg' });
    const url  = URL.createObjectURL(blob);
    if (currentAudio) {
      currentAudio.pause();
      if (currentAudio._blobUrl) URL.revokeObjectURL(currentAudio._blobUrl);
    }
    const audio = new Audio(url);
    audio._blobUrl = url;
    currentAudio = audio;
    audio.play().catch(() => {});
    audio.onended = () => {
      URL.revokeObjectURL(url);
      if (currentAudio === audio) currentAudio = null;
    };
  } catch (_) {
    // Silent — TTS failures never interrupt the chat
  }
}
