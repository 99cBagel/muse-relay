// Minimal MCP (Model Context Protocol) server over Streamable HTTP.
//
// Exposes the relay as an MCP service so a processing backend (e.g. Muse on
// iPhone) can claim chat sessions and shuttle messages to/from the browser
// chat UI. Skill description: "intended as a relay UI for Muse, which does
// not support Windows".
//
// This is a dependency-free JSON-RPC 2.0 implementation supporting:
//   initialize, notifications/initialized, ping, tools/list, tools/call
// POST /mcp with Content-Type: application/json. (GET SSE streaming is not
// implemented; POST returns plain JSON responses, which Streamable HTTP
// allows.)

import {
  listSessions,
  getSession,
  claimSession,
  receiveInbox,
  pushOutbox,
} from "./relay.js";

export const SKILL_DESCRIPTION =
  "intended as a relay UI for Muse, which does not support Windows";

const SERVER_INFO = { name: "muse-relay-worker", version: "0.1.0" };
const PROTOCOL_VERSION = "2025-03-26";

const TOOLS = [
  {
    name: "relay_list_sessions",
    description:
      "List active relay chat sessions (browser frontends waiting for a backend agent).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "relay_claim_session",
    description:
      "Claim a relay chat session as the processing backend agent. After claiming, use relay_receive to read user messages and relay_send to reply.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Session id from relay_list_sessions." },
        agent_name: { type: "string", description: "Name shown as the claimed backend agent." },
      },
      required: ["session_id"],
      additionalProperties: false,
    },
  },
  {
    name: "relay_receive",
    description:
      "Wait for the next message from the browser chat UI on a claimed session. Long-polls up to timeout_ms (default 25000, max 60000). Returns message or null on timeout.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        timeout_ms: { type: "integer", minimum: 0, maximum: 60000 },
      },
      required: ["session_id"],
      additionalProperties: false,
    },
  },
  {
    name: "relay_send",
    description:
      "Send a reply from the backend agent to the browser chat UI on a session.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        text: { type: "string", description: "Message text (up to 8000 chars)." },
      },
      required: ["session_id", "text"],
      additionalProperties: false,
    },
  },
];

function ok(id, result) {
  return Response.json({ jsonrpc: "2.0", id, result }, { headers: { "cache-control": "no-store" } });
}

function err(id, code, message) {
  return Response.json(
    { jsonrpc: "2.0", id: id ?? null, error: { code, message } },
    { headers: { "cache-control": "no-store" } }
  );
}

function toolResult(id, payload, isError = false) {
  return ok(id, {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    isError,
  });
}

async function callTool(name, args) {
  switch (name) {
    case "relay_list_sessions":
      return { sessions: listSessions() };
    case "relay_claim_session": {
      const s = claimSession(args.session_id, args.agent_name);
      if (!s) return { error: "session_not_found", session_id: args.session_id };
      return { claimed: s };
    }
    case "relay_receive": {
      if (!getSession(args.session_id))
        return { error: "session_not_found", session_id: args.session_id };
      const { message } = await receiveInbox(args.session_id, args.timeout_ms ?? 25000);
      return { message };
    }
    case "relay_send": {
      const text = String(args.text ?? "");
      if (!text || text.length > 8000)
        return { error: "text must be 1..8000 characters" };
      const msg = pushOutbox(args.session_id, text);
      if (!msg) return { error: "session_not_found", session_id: args.session_id };
      return { sent: msg };
    }
    default:
      return { error: "unknown_tool", name };
  }
}

export async function handleMcp(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return err(null, -32700, "Parse error: expected a JSON-RPC body");
  }
  const { id, method, params } = body || {};
  if (body?.jsonrpc !== "2.0" || typeof method !== "string") {
    return err(id, -32600, "Invalid Request");
  }

  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    case "notifications/initialized":
      return new Response(null, { status: 202 });
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: TOOLS });
    case "tools/call": {
      const name = params?.name;
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return toolResult(id, { error: "unknown_tool", name }, true);
      try {
        const payload = await callTool(name, params?.arguments ?? {});
        return toolResult(id, payload, Boolean(payload?.error));
      } catch (e) {
        return toolResult(id, { error: String(e?.message || e) }, true);
      }
    }
    default:
      return err(id, -32601, `Method not found: ${method}`);
  }
}
