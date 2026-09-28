---
name: "muse-relay"
description: "intended as a relay UI for Muse, which does not support Windows"
---

# Muse Relay (MCP service)

Relay agent specialized in relaying messages between a browser chat frontend
and the processing backend. The frontend is a chat box UI hosted at
`muse-relay.vercel.app`; the backend is whatever MCP client claims a session
(e.g. Muse on iPhone).

Base URL: the deployed Worker URL (set `NEXT_PUBLIC_WORKER_URL` on the web
side). All `/mcp` calls require `Authorization: Bearer <RELAY_SHARED_SECRET>`.
MCP transport: Streamable HTTP — POST JSON-RPC 2.0 to `/mcp`.

## Backend loop

1. `relay_list_sessions` → pick up a session the browser opened.
2. `relay_claim_session` with `session_id` and your `agent_name`.
3. Loop: `relay_receive` (`timeout_ms` up to 60000) to read the next user
   message; process it; `relay_send` the reply text back to the browser.

## Tools

- **relay_list_sessions** — list active sessions: `{ id, createdAt, claimedBy, pendingInbox, pendingOutbox }`.
- **relay_claim_session** — `{ session_id, agent_name? }` → `{ claimed }`.
- **relay_receive** — `{ session_id, timeout_ms? }` → `{ message }`; `message` is null on timeout.
- **relay_send** — `{ session_id, text }` (1–8000 chars) → `{ sent }`.

## Notes

- Sessions are in-memory on the Worker; a browser session disappears if the
  Worker isolate is evicted. Re-list sessions if a receive starts 404ing.
- The browser side needs no auth; only `/mcp` requires the shared secret.
