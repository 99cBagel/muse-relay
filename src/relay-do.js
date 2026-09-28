// RelayCoordinator: the single Durable Object that owns all relay state.
//
// Why this exists: a plain Worker keeps session state in isolate memory,
// and Cloudflare may route each request to a different isolate — so a
// session created by the browser was invisible to the MCP backend (and
// vice versa). Forwarding every request to one named Durable Object
// instance ("global") gives all callers a single, consistent view of
// sessions, inboxes, and outboxes.
//
// The session store itself (src/relay.js) is unchanged: its module-level
// Map now lives inside this DO's isolate, where exactly one instance
// exists, so it behaves as global state.

import { handleRequest } from "./routes.js";

export class RelayCoordinator {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    return handleRequest(request, this.env);
  }
}
