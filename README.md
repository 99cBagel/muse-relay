# Muse-Relay-Worker

Relay agent: a Cloudflare Worker that bridges a browser chat UI and a
processing backend. The Worker is packaged as an MCP service so the backend
(e.g. Muse on iPhone) can claim chat sessions and shuttle messages.

**Usage scenario**

- **iPhone Muse**: connected to the Worker, and start the Worker (as the MCP
  processing backend).
- **Windows desktop**: browser visits `muse-relay.vercel.app` → shows
  `connecting....` → chat box UI.

Messages flow: browser → Worker session inbox → backend (`relay_receive`) →
backend replies (`relay_send`) → Worker session outbox → browser SSE stream.

## Layout

```
Muse-Relay-Worker/
├── src/worker.js        Cloudflare Worker: REST API + MCP endpoint
├── src/relay.js         in-memory session store (inbox/outbox queues)
├── src/mcp.js           MCP server (Streamable HTTP, JSON-RPC, no deps)
├── test/relay.test.js   node --test suite
├── wrangler.jsonc       Worker config (deploy manually: wrangler deploy)
├── web/                 Next.js chat UI (Vercel deploy)
├── SKILL.md             MCP service skill description
└── .env.example
```

## Worker (deploy manually from local terminal)

```bash
npm install
npm test
wrangler login
wrangler secret put RELAY_SHARED_SECRET   # backend auth for /mcp
CLOUDFLARE_API_TOKEN=xxx wrangler deploy
```

Endpoints:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/healthz` | — | health check |
| POST | `/api/sessions` | — | create chat session (browser) |
| GET | `/api/sessions/:id` | — | session info |
| POST | `/api/sessions/:id/messages` | — | browser → backend message |
| GET | `/api/sessions/:id/stream` | — | SSE: backend → browser messages |
| DELETE | `/api/sessions/:id` | — | close session |
| POST | `/mcp` | Bearer `RELAY_SHARED_SECRET` | MCP JSON-RPC (backend) |

### MCP tools (for the processing backend)

- `relay_list_sessions` — active browser sessions waiting for a backend
- `relay_claim_session` — claim a session (`session_id`, `agent_name`)
- `relay_receive` — long-poll the next browser message (`session_id`, `timeout_ms`)
- `relay_send` — reply to the browser (`session_id`, `text`)

Backend loop: `relay_list_sessions` → `relay_claim_session` → loop
`relay_receive` (timeout ~25s) → process → `relay_send`.

> Session state lives in the `RelayCoordinator` Durable Object
> (`src/relay-do.js`): one named instance owns all sessions, so the browser
> and the MCP backend always see the same store no matter which isolate
> serves a request. `wrangler deploy` applies the DO migration
> automatically; no extra setup is needed.

## Web frontend (Vercel)

```bash
cd web
npm install
npm run build
```

Deploy to Vercel from this repo (root directory `web`, or import `web/` as the
project). Set the environment variable:

- `MUSE_RELAY_WORKER_URL` = your Worker URL, e.g.
  `https://muse-relay-worker.<account>.workers.dev`

Preferred production endpoint: `muse-relay.vercel.app` (set as the custom
domain in Vercel project settings). The UI shows `connecting....` while it
creates a relay session, then the chat box.

## Skill

`SKILL.md` describes the MCP service: *"intended as a relay UI for Muse,
which does not support Windows"*.

## Reference

Example worker this follows: https://github.com/99cBagel/homelab-line-agent-worker
