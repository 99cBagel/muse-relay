import test from "node:test";
import assert from "node:assert/strict";
import {
  createSession,
  getSession,
  listSessions,
  claimSession,
  pushInbox,
  pushOutbox,
  drainOutbox,
  receiveInbox,
  deleteSession,
  __reset,
} from "../src/relay.js";
import { handleMcp } from "../src/mcp.js";
import app from "../src/worker.js";

const env = { RELAY_SHARED_SECRET: "test-secret" };
const auth = { authorization: "Bearer test-secret" };

function req(method, path, body, headers = {}) {
  return new Request(`https://relay.test${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function rpc(method, params, id = 1) {
  const res = await app.fetch(
    req("POST", "/mcp", { jsonrpc: "2.0", id, method, params }, auth),
    env
  );
  assert.equal(res.status, 200);
  return res.json();
}

test("relay session lifecycle", async () => {
  __reset();
  const s = createSession();
  assert.ok(s.id);
  assert.equal(getSession(s.id).claimedBy, null);

  const m1 = pushInbox(s.id, "hello from browser");
  assert.equal(m1.from, "user");
  const m2 = pushOutbox(s.id, "hello from backend");
  assert.equal(m2.from, "agent");

  const drained = drainOutbox(s.id);
  assert.equal(drained.length, 1);
  assert.equal(drained[0].text, "hello from backend");
  assert.equal(drainOutbox(s.id).length, 0);

  const claimed = claimSession(s.id, "iphone-muse");
  assert.equal(claimed.claimedBy, "iphone-muse");
  assert.equal(listSessions().length, 1);

  assert.ok(deleteSession(s.id));
  assert.equal(getSession(s.id), null);
});

test("receiveInbox resolves queued message immediately", async () => {
  __reset();
  const s = createSession();
  pushInbox(s.id, "ping");
  const { message } = await receiveInbox(s.id, 100);
  assert.equal(message.text, "ping");
});

test("receiveInbox long-polls and wakes on push", async () => {
  __reset();
  const s = createSession();
  const p = receiveInbox(s.id, 5000);
  setTimeout(() => pushInbox(s.id, "late hello"), 50);
  const { message } = await p;
  assert.equal(message.text, "late hello");
});

test("receiveInbox times out with null", async () => {
  __reset();
  const s = createSession();
  const { message } = await receiveInbox(s.id, 50);
  assert.equal(message, null);
});

test("MCP initialize + tools/list", async () => {
  __reset();
  const init = await rpc("initialize", { protocolVersion: "2025-03-26" });
  assert.equal(init.result.serverInfo.name, "muse-relay-worker");
  const list = await rpc("tools/list", {});
  const names = list.result.tools.map((t) => t.name);
  assert.deepEqual(names, [
    "relay_list_sessions",
    "relay_claim_session",
    "relay_receive",
    "relay_send",
  ]);
});

test("MCP claim -> receive -> send round trip", async () => {
  __reset();
  const s = createSession();
  pushInbox(s.id, "what time is it?");

  const claimed = await rpc("tools/call", {
    name: "relay_claim_session",
    arguments: { session_id: s.id, agent_name: "iphone-muse" },
  });
  const claimedPayload = JSON.parse(claimed.result.content[0].text);
  assert.equal(claimedPayload.claimed.claimedBy, "iphone-muse");

  const received = await rpc("tools/call", {
    name: "relay_receive",
    arguments: { session_id: s.id, timeout_ms: 1000 },
  });
  const receivedPayload = JSON.parse(received.result.content[0].text);
  assert.equal(receivedPayload.message.text, "what time is it?");

  const sent = await rpc("tools/call", {
    name: "relay_send",
    arguments: { session_id: s.id, text: "3:30 PM" },
  });
  const sentPayload = JSON.parse(sent.result.content[0].text);
  assert.equal(sentPayload.sent.text, "3:30 PM");
  assert.equal(drainOutbox(s.id)[0].text, "3:30 PM");
});

test("MCP requires the shared secret", async () => {
  __reset();
  const res = await app.fetch(req("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "ping" }), env);
  assert.equal(res.status, 401);
});

test("browser API: create session, post message, get info", async () => {
  __reset();
  const created = await app.fetch(req("POST", "/api/sessions"), env);
  assert.equal(created.status, 201);
  const { session } = await created.json();

  const posted = await app.fetch(req("POST", `/api/sessions/${session.id}/messages`, { text: "hi" }), env);
  assert.equal(posted.status, 201);

  const info = await app.fetch(req("GET", `/api/sessions/${session.id}`), env);
  const infoBody = await info.json();
  assert.equal(infoBody.session.id, session.id);

  const missing = await app.fetch(req("GET", "/api/sessions/nope"), env);
  assert.equal(missing.status, 404);
});

test("browser API rejects empty/oversize messages", async () => {
  __reset();
  const { session } = await (await app.fetch(req("POST", "/api/sessions"), env)).json();
  const empty = await app.fetch(req("POST", `/api/sessions/${session.id}/messages`, { text: "" }), env);
  assert.equal(empty.status, 400);
  const big = await app.fetch(
    req("POST", `/api/sessions/${session.id}/messages`, { text: "x".repeat(8001) }),
    env
  );
  assert.equal(big.status, 400);
});
