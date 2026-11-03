import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import { listMembers, previewEmail, sendTestEmail, type EmailType } from "./api";
import { Tabs } from "./components";
import { Panel } from "./ui";

const types = [{ value: "weekly", label: "Weekly recap" }, { value: "monthly", label: "Monthly leaderboard" }] as const;
const timing: Record<EmailType, string> = {
  weekly: "Sends Mondays 8:00 am Central. Preview it as any member would receive it.",
  monthly: "Sends on the 1st at 8:00 am Central, covering the month before. This preview shows the current month so far.",
};

/** Admins see exactly what goes out and can email a test copy to themselves only. */
export function EmailPreview() {
  const [type, setType] = useState<EmailType>("weekly");
  const [userId, setUserId] = useState("");
  const [state, setState] = useState({ busy: false, message: "" });
  const members = useQuery({ queryKey: ["members"], queryFn: listMembers });
  const q = useQuery({ queryKey: ["email-preview", type, userId], queryFn: () => previewEmail(type, type === "weekly" ? userId || undefined : undefined) });
  return (
    <Panel title="Email preview" action={<Tabs label="Email type" value={type} onChange={(t) => { setType(t); setState({ busy: false, message: "" }); }} options={types} />}>
      <p className="hint">{timing[type]}</p>
      <div className="pr-preview-bar">
        {type === "weekly" && (
          <select aria-label="Preview as member" value={userId} onChange={(e) => setUserId(e.target.value)} data-testid="preview-member-select">
            <option value="">Preview as me</option>
            {(members.data ?? []).filter((m) => !m.is_you).map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}
          </select>
        )}
        <button className="button secondary" disabled={state.busy || !q.data} data-testid="send-test-email-btn" onClick={async () => {
          setState({ busy: true, message: "" });
          try {
            const r = await sendTestEmail(type, type === "weekly" ? userId : undefined);
            setState({ busy: false, message: `Test sent to ${r.sent_to}.` });
          } catch (error) {
            setState({ busy: false, message: (error as Error).message });
          }
        }}><Mail size={16} /> {state.busy ? "Sending…" : "Email me a test"}</button>
      </div>
      {state.message && <p role="status" data-testid="test-email-status">{state.message}</p>}
      {q.isLoading ? <p role="status">Rendering preview…</p> : q.error ? <p role="alert" className="error">{(q.error as Error).message}</p> : q.data && (
        <>
          <p className="pr-preview-meta" data-testid="preview-meta"><strong>Subject:</strong> {q.data.subject} · <strong>{q.data.recipients}</strong> opted-in recipient{q.data.recipients === 1 ? "" : "s"}</p>
          <iframe className="pr-preview-frame" title={`${type} email preview`} sandbox="" srcDoc={q.data.html} data-testid="email-preview-frame" />
        </>
      )}
    </Panel>
  );
}
