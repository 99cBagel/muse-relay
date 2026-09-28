// In-memory relay session store.
//
// A session is a bidirectional message pipe between one browser chat UI
// (the "frontend", e.g. a Windows desktop on muse-relay.vercel.app) and one
// processing backend (e.g. Muse on iPhone, connected over MCP).
//
//   inbox  : frontend -> backend messages, consumed by relay_receive
//   outbox : backend  -> frontend messages, consumed by the SSE stream
//
// NOTE: state lives in the isolate's memory. If the Worker is evicted or a
// request lands on a different isolate, sessions are lost. For durable
// sessions, back this store with a Durable Object or KV.

const sessions = new Map();

function now() {
  return new Date().toISOString();
}

export function createSession() {
  const id = crypto.randomUUID();
  const session = {
    id,
    createdAt: now(),
    claimedBy: null,
    inbox: [],
    outbox: [],
    // waiters for relay_receive long-poll: [{ resolve, timer }]
    waiters: [],
  };
  sessions.set(id, session);
  return publicSession(session);
}

export function getSession(id) {
  return sessions.get(id) || null;
}

export function listSessions() {
  return [...sessions.values()].map((s) => ({
    id: s.id,
    createdAt: s.createdAt,
    claimedBy: s.claimedBy,
    pendingInbox: s.inbox.length,
    pendingOutbox: s.outbox.length,
  }));
}

export function claimSession(id, agentName) {
  const s = getSession(id);
  if (!s) return null;
  s.claimedBy = agentName || "agent";
  return publicSession(s);
}

export function pushInbox(id, text, from = "user") {
  const s = getSession(id);
  if (!s) return null;
  const msg = { id: crypto.randomUUID(), from, text: String(text), ts: now() };
  // Wake one long-poller if any, otherwise queue.
  const waiter = s.waiters.shift();
  if (waiter) {
    clearTimeout(waiter.timer);
    waiter.resolve(msg);
  } else {
    s.inbox.push(msg);
  }
  return msg;
}

export function pushOutbox(id, text, from = "agent") {
  const s = getSession(id);
  if (!s) return null;
  const msg = { id: crypto.randomUUID(), from, text: String(text), ts: now() };
  s.outbox.push(msg);
  return msg;
}

export function shiftInbox(id) {
  const s = getSession(id);
  if (!s) return null;
  return s.inbox.shift() || null;
}

export function drainOutbox(id) {
  const s = getSession(id);
  if (!s) return null;
  const msgs = s.outbox;
  s.outbox = [];
  return msgs;
}

// Long-poll: resolve with the next inbox message, waiting up to timeoutMs.
// Resolves to null on timeout.
export function receiveInbox(id, timeoutMs = 25000) {
  const s = getSession(id);
  if (!s) return Promise.resolve({ session: null });
  const msg = s.inbox.shift();
  if (msg) return Promise.resolve({ session: publicSession(s), message: msg });
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const i = s.waiters.findIndex((w) => w.resolve === resolveFn);
      if (i >= 0) s.waiters.splice(i, 1);
      resolve({ session: publicSession(s), message: null });
    }, Math.max(0, Math.min(timeoutMs, 60000)));
    const resolveFn = (m) => resolve({ session: publicSession(s), message: m });
    s.waiters.push({ resolve: resolveFn, timer });
  });
}

export function deleteSession(id) {
  const s = getSession(id);
  if (!s) return false;
  for (const w of s.waiters) {
    clearTimeout(w.timer);
    w.resolve(null);
  }
  sessions.delete(id);
  return true;
}

function publicSession(s) {
  return {
    id: s.id,
    createdAt: s.createdAt,
    claimedBy: s.claimedBy,
    pendingInbox: s.inbox.length,
    pendingOutbox: s.outbox.length,
  };
}

// Test-only: reset all state.
export function __reset() {
  sessions.clear();
}
