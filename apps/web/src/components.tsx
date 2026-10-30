/**
 * Reusable UI kit: small, typed, accessible building blocks shared by the tournament screens.
 * Styles live in components.css and are all prefixed `pp-`.
 */
import { useState, type ReactNode } from "react";
import { Dialog } from "./ui";
import "./components.css";

export type Tone = "neutral" | "success" | "warn" | "danger" | "info";

const toneFor = (status: string): Tone => {
  const value = status.toLowerCase();
  if (["finalized", "approved", "paid", "active", "confirmed", "published", "registration open"].includes(value)) return "success";
  if (["reported", "pending", "waitlisted", "scheduled", "draft"].includes(value)) return "warn";
  if (["disputed", "rejected", "withdrawn", "cancelled", "dead"].includes(value)) return "danger";
  if (["bye", "closed", "completed"].includes(value)) return "info";
  return "neutral";
};

/** Status pill; the tone is inferred from the status text unless given. */
export function StatusBadge({ status, tone }: { status: string; tone?: Tone }) {
  return <span className={`pp-badge pp-tone-${tone ?? toneFor(status)}`}>{status}</span>;
}

export function Callout({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return <div className={`pp-callout pp-tone-${tone}`} role={tone === "danger" ? "alert" : "status"}><p>{children}</p></div>;
}

/** Segmented control for switching between views. */
export function Tabs<T extends string>({ value, onChange, options, label }: { value: T; onChange: (value: T) => void; options: readonly { value: T; label: string }[]; label: string }) {
  return (
    <div className="pp-segmented" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" role="tab" aria-selected={value === option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Radio cards for choosing one of a few richly described options (e.g. tournament type). */
export function OptionCards<T extends string>({ value, onChange, options, label }: { value: T; onChange: (value: T) => void; options: readonly { value: T; label: string; description: string }[]; label: string }) {
  return (
    <div className="pp-option-grid" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" role="radio" aria-checked={value === option.value} className="pp-option" onClick={() => onChange(option.value)}>
          <strong>{option.label}</strong>
          <span>{option.description}</span>
        </button>
      ))}
    </div>
  );
}

export function FieldGrid({ children }: { children: ReactNode }) {
  return <div className="pp-grid">{children}</div>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="pp-section-title">{children}</h3>;
}

export function StatGrid({ items }: { items: readonly { label: string; value: ReactNode }[] }) {
  return (
    <dl className="pp-stats">
      {items.map((item) => (
        <div className="pp-stat" key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>
      ))}
    </dl>
  );
}

export type Column<T> = { key: string; header: ReactNode; cell: (row: T) => ReactNode; numeric?: boolean; className?: string };

/** Typed, responsive table with an empty state. */
export function DataTable<T>({ columns, rows, rowKey, caption, empty }: { columns: readonly Column<T>[]; rows: readonly T[]; rowKey: (row: T) => string; caption?: string; empty?: ReactNode }) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <div className="pp-table-wrap">
      <table className="pp-table">
        {caption && <caption>{caption}</caption>}
        <thead><tr>{columns.map((column) => <th key={column.key} scope="col" className={column.numeric ? "num" : column.className}>{column.header}</th>)}</tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>{columns.map((column) => <td key={column.key} className={column.numeric ? "num" : column.className}>{column.cell(row)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type MatchSide = { name: string; score?: number | null; winner?: boolean };

/** One match: two sides with the winner highlighted, a status pill, optional notes and an actions area. */
export function MatchCard({ label, status, home, away, note, children }: { label?: ReactNode; status: string; home: MatchSide; away: MatchSide; note?: ReactNode; children?: ReactNode }) {
  const side = (item: MatchSide) => (
    <div className={`pp-side${item.winner ? " is-winner" : ""}`}>
      <span className="pp-side-name">{item.name}</span>
      {item.score != null && <span className="pp-side-score">{item.score}</span>}
    </div>
  );
  return (
    <article className="pp-match">
      <div className="pp-match-head"><span>{label}</span><StatusBadge status={status === "bye" ? "Bye" : status} /></div>
      {side(home)}
      {side(away)}
      {(note || children) && (
        <div className="pp-match-body">
          {note && <p className="pp-match-note">{note}</p>}
          {children}
        </div>
      )}
    </article>
  );
}

/** Button that asks for a typed reason in a dialog before running (disputes, walkovers, corrections). */
export function PromptAction({ label, title, promptLabel, minLength = 5, submitLabel = "Submit", variant = "secondary", onSubmit }: {
  label: ReactNode; title: string; promptLabel: string; minLength?: number; submitLabel?: string; variant?: string; onSubmit: (value: string) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const close = () => { setOpen(false); setValue(""); setError(""); };
  return (
    <>
      <button type="button" className={`button ${variant}`} onClick={() => setOpen(true)}>{label}</button>
      {open && (
        <Dialog title={title} onClose={close}>
          <form className="pp-dialog-form" onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            try { await onSubmit(value.trim()); close(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to save"); } finally { setBusy(false); }
          }}>
            <label>{promptLabel}<textarea value={value} onChange={(event) => setValue(event.target.value)} minLength={minLength} required autoFocus /></label>
            {error && <div role="alert" className="error">{error}</div>}
            <div className="pp-dialog-actions">
              <button type="button" className="button secondary" onClick={close}>Cancel</button>
              <button className="button primary" disabled={busy || value.trim().length < minLength}>{busy ? "Working…" : submitLabel}</button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}

/** Button that asks for confirmation in a dialog before running a consequential action. */
export function ConfirmAction({ label, title, message, confirmLabel = "Confirm", variant = "secondary", onConfirm }: {
  label: ReactNode; title: string; message: ReactNode; confirmLabel?: string; variant?: string; onConfirm: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const close = () => { setOpen(false); setError(""); };
  return (
    <>
      <button type="button" className={`button ${variant}`} onClick={() => setOpen(true)}>{label}</button>
      {open && (
        <Dialog title={title} onClose={close}>
          <div className="pp-dialog-form">
            <p>{message}</p>
            {error && <div role="alert" className="error">{error}</div>}
            <div className="pp-dialog-actions">
              <button type="button" className="button secondary" onClick={close}>Cancel</button>
              <button type="button" className="button primary" disabled={busy} onClick={async () => {
                setBusy(true);
                setError("");
                try { await onConfirm(); close(); } catch (e) { setError(e instanceof Error ? e.message : "Operation failed"); } finally { setBusy(false); }
              }}>{busy ? "Working…" : confirmLabel}</button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}

