// Muse-Relay-Worker: relay agent between the browser chat UI and the
// processing backend.
//
// The Worker is a thin edge: health checks and CORS preflights are served
// here, everything else is forwarded to the RelayCoordinator Durable
// Object so browser and MCP requests share one consistent session store.
// Skill description: "intended as a relay UI for Muse, which does not
// support Windows".

import { handleRequest, corsHeaders } from "./routes.js";
import { RelayCoordinator } from "./relay-do.js";

function json(value, status = 200) {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store", ...corsHeaders() },
  });
}

const app = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method === "GET" && pathname === "/healthz") {
      return json({ status: "ok", service: "muse-relay-worker" });
    }

    // Production: single Durable Object owns all relay state.
    if (env.RELAY_DO) {
      const stub = env.RELAY_DO.getByName("global");
      return stub.fetch(request);
    }

    // No DO binding (unit tests, wrangler dev): handle in-process.
    return handleRequest(request, env);
  },
};

export default app;
export { RelayCoordinator };
