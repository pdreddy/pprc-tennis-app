import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import { getChallengeSettings, listMembers, saveChallengeSettings, sendRecapsNow, setMemberRole } from "./api";
import { Callout, DataTable } from "./components";
import { Empty, Panel } from "./ui";
import { EmailPreview } from "./email-preview";
import "./players.css";

const roles = [
  { value: "player", label: "Player" },
  { value: "organizer", label: "Organizer" },
  { value: "admin", label: "Club admin" },
];

function RoleSelect({ userId, role, disabled }: { userId: string; role: string; disabled: boolean }) {
  const qc = useQueryClient();
  const [state, setState] = useState({ busy: false, error: "" });
  if (disabled) return <span className="muted">{role === "owner" ? "Owner" : roles.find((r) => r.value === role)?.label}</span>;
  return (
    <span className="pr-role">
      <select
        aria-label="Club role"
        data-testid={`role-select-${userId}`}
        value={role}
        disabled={state.busy}
        onChange={async (e) => {
          setState({ busy: true, error: "" });
          try {
            await setMemberRole(userId, e.target.value);
            await qc.invalidateQueries({ queryKey: ["members"] });
            setState({ busy: false, error: "" });
          } catch (error) {
            setState({ busy: false, error: (error as Error).message });
          }
        }}
      >
        {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
      </select>
      {state.error && <small role="alert" className="error">{state.error}</small>}
    </span>
  );
}

function RecapSender() {
  const [state, setState] = useState({ busy: false, message: "" });
  return (
    <Panel title="Weekly rating recap">
      <p className="hint">Goes out automatically every Monday at 8:00 am Central to players who turned it on. Send now to deliver this week's recap early; nobody gets it twice in a week.</p>
      <button className="button primary" disabled={state.busy} data-testid="send-recaps-btn" onClick={async () => {
        setState({ busy: true, message: "" });
        try {
          const r = await sendRecapsNow();
          setState({ busy: false, message: `Sent ${r.sent} of ${r.opted_in} opted-in players for ${r.week}${r.failed ? ` · ${r.failed} failed` : ""}.` });
        } catch (error) {
          setState({ busy: false, message: (error as Error).message });
        }
      }}>
        <Mail size={16} /> {state.busy ? "Sending…" : "Send this week's recap now"}
      </button>
      {state.message && <p role="status" data-testid="send-recaps-status">{state.message}</p>}
    </Panel>
  );
}

function ChallengeSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["challenge-settings"], queryFn: getChallengeSettings });
  const [message, setMessage] = useState("");
  if (!q.data) return null;
  return (
    <Panel title="Challenge settings">
      <p className="hint">Players get one friendly reminder (in-app and email) after {q.data.reminder_after_days} quiet days. Unanswered challenges then close automatically.</p>
      <form className="pr-preview-bar" onSubmit={async (e) => {
        e.preventDefault();
        setMessage("");
        try {
          const days = Number(new FormData(e.currentTarget).get("days"));
          await saveChallengeSettings(days);
          await qc.invalidateQueries({ queryKey: ["challenge-settings"] });
          setMessage(`Saved · challenges expire after ${days} days`);
        } catch (error) {
          setMessage((error as Error).message);
        }
      }}>
        <label htmlFor="expiry-days">Expire after</label>
        <input id="expiry-days" name="days" type="number" min={3} max={30} defaultValue={q.data.challenge_expiry_days} key={q.data.challenge_expiry_days} className="pr-days-input" onChange={() => setMessage("")} data-testid="challenge-expiry-input" /> days
        <button className="button secondary" data-testid="challenge-expiry-save">Save</button>
      </form>
      {message && <p role="status" data-testid="challenge-expiry-status">{message}</p>}
    </Panel>
  );
}

export function MembersRoles() {
  const [q, setQ] = useState("");
  const members = useQuery({ queryKey: ["members"], queryFn: listMembers });
  const rows = (members.data ?? []).filter((m) => m.display_name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div data-testid="members-roles">
      <h1>Members & roles</h1>
      <Callout>Organizers run events and verify results. Club admins can also change roles and send recaps.</Callout>
      <RecapSender />
      <EmailPreview />
      <ChallengeSettings />
      <Panel title="Members">
        <input className="pr-member-search" placeholder="Search members" aria-label="Search members" value={q} onChange={(e) => setQ(e.target.value)} data-testid="members-search" />
        {members.isLoading ? <p role="status">Loading members…</p> : members.error ? <p role="alert" className="error">{(members.error as Error).message}</p> : (
          <DataTable
            rows={rows}
            rowKey={(m) => m.user_id}
            empty={<Empty title="No members match" />}
            columns={[
              { key: "name", header: "Member", cell: (m) => <strong>{m.display_name}{m.is_you ? " (you)" : ""}</strong> },
              { key: "role", header: "Role", cell: (m) => <RoleSelect userId={m.user_id} role={m.role} disabled={m.is_you || m.role === "owner"} /> },
            ]}
          />
        )}
      </Panel>
    </div>
  );
}
