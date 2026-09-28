"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ChatMessage = {
  id: string;
  from: "user" | "agent";
  text: string;
  ts: string;
};

type Phase = "connecting" | "ready" | "error";


export default function Chat({ workerUrl }: { workerUrl: string }) {
  const WORKER_URL = workerUrl;
  const [phase, setPhase] = useState<Phase>("connecting");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  // Create a relay session, then open the SSE stream for backend replies.
  useEffect(() => {
    if (!WORKER_URL) {
      setPhase("error");
      setError("Worker URL is not configured (MUSE_RELAY_WORKER_URL).");
      return;
    }
    let es: EventSource | null = null;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`${WORKER_URL}/api/sessions`, { method: "POST" });
        if (!res.ok) throw new Error(`session create failed (${res.status})`);
        const { session } = await res.json();
        if (cancelled) return;
        setSessionId(session.id);

        es = new EventSource(`${WORKER_URL}/api/sessions/${session.id}/stream`);
        es.addEventListener("connected", () => {
          if (!cancelled) setPhase("ready");
        });
        es.addEventListener("message", (e) => {
          const msg = JSON.parse((e as MessageEvent).data) as ChatMessage;
          setMessages((prev) =>
            prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]
          );
        });
        es.addEventListener("closed", () => {
          if (!cancelled) {
            setPhase("error");
            setError("Session closed by the relay.");
          }
        });
        es.onerror = () => {
          if (!cancelled) {
            setPhase("error");
            setError("Lost connection to the relay worker.");
          }
        };
      } catch (err) {
        if (!cancelled) {
          setPhase("error");
          setError(err instanceof Error ? err.message : "Could not reach the relay worker.");
        }
      }
    })();

    return () => {
      cancelled = true;
      es?.close();
    };
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !sessionId || sending) return;
    setSending(true);
    const optimistic: ChatMessage = {
      id: `local-${Date.now()}`,
      from: "user",
      text,
      ts: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setDraft("");
    try {
      const res = await fetch(`${WORKER_URL}/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(`send failed (${res.status})`);
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setDraft(text);
      setError(err instanceof Error ? err.message : "Send failed.");
    } finally {
      setSending(false);
    }
  }, [draft, sessionId, sending]);

  return (
    <div className="chat-shell">
      <header className="chat-header">
        <h1>Muse Relay</h1>
        <span className={`status-dot ${phase === "ready" ? "ready" : phase === "error" ? "error" : ""}`} />
        <span className="status-text">
          {phase === "connecting" ? "connecting...." : phase === "ready" ? "connected" : "error"}
        </span>
      </header>

      {phase === "connecting" && (
        <div className="center">
          <div className="spinner" />
          <div>connecting....</div>
        </div>
      )}

      {phase === "error" && (
        <div className="center">
          <div>Something went wrong.</div>
          <div>{error}</div>
        </div>
      )}

      {phase === "ready" && (
        <>
          <div className="chat-log" ref={logRef}>
            {messages.length === 0 && (
              <div className="center">
                <div>Connected. Say hello — your message is relayed to the backend agent.</div>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`msg ${m.from}`}>
                {m.text}
              </div>
            ))}
          </div>
          <div className="chat-input">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Type a message…"
              maxLength={8000}
              autoFocus
            />
            <button onClick={send} disabled={sending || !draft.trim()}>
              Send
            </button>
          </div>
        </>
      )}
    </div>
  );
}
