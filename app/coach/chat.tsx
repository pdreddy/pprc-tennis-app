"use client";

import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string; mock?: boolean };

const STARTERS = ["How do I get to the next level?", "Why do I lose deciding sets?", "Which events should I play next?"];

export function CoachChat({ playerId, firstName, initial, live }: { playerId: number; firstName: string; initial: Msg[]; live: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>(initial);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "nearest" }), [msgs, busy]);

  async function send(message: string) {
    if (!message.trim() || busy) return;
    setMsgs((m) => [...m, { role: "user", content: message }]);
    setText("");
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/coach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerId, message }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setMsgs((m) => [...m, { role: "assistant", content: json.reply, mock: json.mock }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[420px] flex-col border-t-2 border-ink">
      <div className="flex-1 space-y-4 py-5" aria-live="polite">
        {msgs.length === 0 && (
          <p className="text-muted">
            Ask about {firstName}&apos;s results, rating or what to work on. The coach reads the last 12 months of matches.
          </p>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "ml-auto max-w-[80%] rounded-lg bg-court px-4 py-2 text-white" : "max-w-[85%]"}>
            {m.role === "assistant" ? (
              <div className="whitespace-pre-wrap border-l-4 border-ball bg-white px-4 py-3">{m.content}</div>
            ) : (
              m.content
            )}
          </div>
        ))}
        {busy && <p className="text-muted">Coach is reading your results…</p>}
        {error && <p className="text-loss" role="alert">{error}</p>}
        <div ref={end} />
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {STARTERS.map((s) => (
          <button key={s} type="button" className="rounded-full border border-line bg-white px-3 py-1 text-sm hover:border-court" onClick={() => send(s)} disabled={busy}>
            {s}
          </button>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <label htmlFor="msg" className="sr-only">Your question</label>
        <input id="msg" className="field" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask the coach" />
        <button className="btn" disabled={busy || !text.trim()}>Send</button>
      </form>
      {!live && <p className="mt-2 text-sm text-muted">Running on sample replies. Add a Replicate token for live answers.</p>}
    </div>
  );
}
