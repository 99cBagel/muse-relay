import Chat from "./chat";

// Server component: reads the non-public env var and hands it to the
// client chat UI as a prop, so it never needs a NEXT_PUBLIC_* name.
export default function Page() {
  const workerUrl = (process.env.MUSE_RELAY_WORKER_URL || "").replace(/\/$/, "");
  return <Chat workerUrl={workerUrl} />;
}
