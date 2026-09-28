// Shared request routing for the relay service.
//
// Used in two places:
//   - RelayCoordinator (src/relay-do.js): production path. Every request is
//     forwarded to a single named Durable Object, so the in-memory session
//     store in relay.js is consistent across all browser and MCP requests.
//   - src/worker.js: falls back to handling requests directly when no
//     RELAY_DO binding is present (unit tests, wrangler dev without DO).
//
// Routes:
//   POST /mcp                          MCP (Streamable HTTP, JSON-RPC)
//                                      requires Authorization: Bearer <secret>
//                                      when RELAY_SHARED_SECRET is set
//   POST /api/sessions                 create a chat session (browser)
//   GET  /api/sessions/:id             session info (browser)
//   DELETE /api/sessions/:id           delete a session (browser)
//   POST /api/sessions/:id/messages    browser -> backend message
//   GET  /api/sessions/:id/stream      SSE: backend -> browser messages

import {
  createSession,
  getSession,
  pushInbox,
  drainOutbox,
  deleteSession,
} from "./relay.js";
import { handleMcp } from "./mcp.js";

const MAX_TEXT = 8000;

export function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
  };
}

function authorized(request, env) {
  const secret = String(env.RELAY_SHARED_SECRET || "");
  if (!secret) return true; // no secret configured: open (dev only)
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

function json(value, status = 200, extraHeaders = {}) {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store", ...corsHeaders(), ...extraHeaders },
  });
}

function sseResponse(sessionId, signal) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event, data) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
      };
      send("connected", JSON.stringify({ session_id: sessionId }));
      try {
        while (!signal.aborted) {
          if (!getSession(sessionId)) {
            send("closed", JSON.stringify({ reason: "session_not_found" }));
            break;
          }
          const msgs = drainOutbox(sessionId) || [];
          for (const m of msgs) send("message", JSON.stringify(m));
          await new Promise((r) => setTimeout(r, 1000));
        }
      } catch {
        // client disconnected
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      // client went away; the loop exits via signal.aborted
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
      ...corsHeaders(),
    },
  });
}

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;

  // ---- MCP service (processing backend) ----
  if (pathname === "/mcp") {
    if (request.method === "GET") {
      return json({ error: "Use POST with a JSON-RPC body (Streamable HTTP)" }, 405);
    }
    if (request.method !== "POST") return json({ error: "Not found" }, 404);
    if (!authorized(request, env)) return json({ error: "Unauthorized" }, 401);
    return handleMcp(request);
  }

  // ---- Browser chat UI API ----
  if (request.method === "POST" && pathname === "/api/sessions") {
    return json({ session: createSession() }, 201);
  }

  const sessionMatch = pathname.match(/^\/api\/sessions\/([A-Za-z0-9-]+)(\/messages|\/stream)?$/);
  if (sessionMatch) {
    const [, id, sub] = sessionMatch;
    const session = getSession(id);
    if (!session) return json({ error: "session_not_found" }, 404);

    if (request.method === "GET" && !sub) {
      return json({
        session: {
          id: session.id,
          createdAt: session.createdAt,
          claimedBy: session.claimedBy,
        },
      });
    }

    if (request.method === "DELETE" && !sub) {
      deleteSession(id);
      return json({ deleted: id });
    }

    if (request.method === "POST" && sub === "/messages") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }
      const text = String(body?.text ?? "");
      if (!text || text.length > MAX_TEXT) {
        return json({ error: `text must be 1..${MAX_TEXT} characters` }, 400);
      }
      const msg = pushInbox(id, text, "user");
      return json({ message: msg }, 201);
    }

    if (request.method === "GET" && sub === "/stream") {
      return sseResponse(id, request.signal);
    }
  }

  return json({ error: "Not found" }, 404);
}
