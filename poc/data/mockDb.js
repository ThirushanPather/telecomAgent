// Shared in-memory store for both agents.
// No file I/O — all data lives in process memory.

const _store = {
  subscribers: [],
  campaignRecommendations: [],
  rpaActionLog: [],
};

const mockDb = {
  // ─── Subscribers ────────────────────────────────────────────────────────────

  getSubscribers: () => _store.subscribers,

  setSubscribers: (data) => {
    _store.subscribers = data;
  },

  getSubscriber: (id) => _store.subscribers.find((s) => s.id === id),

  updateSubscriber: (id, updates) => {
    const idx = _store.subscribers.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    _store.subscribers[idx] = { ..._store.subscribers[idx], ...updates };
    return _store.subscribers[idx];
  },

  // ─── Campaign Recommendations ────────────────────────────────────────────────

  getRecommendations: () => _store.campaignRecommendations,

  addRecommendation: (rec) => {
    _store.campaignRecommendations.push(rec);
    return rec;
  },

  getRecommendation: (id) =>
    _store.campaignRecommendations.find((r) => r.id === id),

  updateRecommendation: (id, updates) => {
    const idx = _store.campaignRecommendations.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    _store.campaignRecommendations[idx] = {
      ..._store.campaignRecommendations[idx],
      ...updates,
    };
    return _store.campaignRecommendations[idx];
  },

  clearRecommendations: () => {
    _store.campaignRecommendations = [];
  },

  // ─── RPA Action Log ──────────────────────────────────────────────────────────

  getActionLog: () => _store.rpaActionLog,

  addAction: (action) => {
    _store.rpaActionLog.push(action);
    return action;
  },

  clearActionLog: () => {
    _store.rpaActionLog = [];
  },
};

export default mockDb;
