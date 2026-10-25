import { createPortal } from "react-dom";
import {
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import { Link } from "react-router-dom";
import {
  MapPin,
  ArrowUpRight,
  CalendarDays,
  Users,
  ChevronRight,
} from "lucide-react";
import { getDownloadURL, ref } from "firebase/storage";
import { storage } from "./firebase";
import { registrationOpenNow, type Entity, type Event } from "@pprc/shared";
export const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: n % 100 ? 2 : 0,
  }).format(n / 100);
export function date(value: string, zone = "America/Chicago", time = false) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    month: "short",
    day: "numeric",
    ...(time
      ? { hour: "numeric", minute: "2-digit", timeZoneName: "short" }
      : {}),
  }).format(new Date(value));
}
export function Badge({ children }: { children: ReactNode }) {
  return (
    <span
      className={`badge ${String(children).replaceAll(" ", "-").toLowerCase()}`}
    >
      {children}
    </span>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const generated = useId();
  const control = isValidElement(children)
    ? (children as ReactElement<any>)
    : null;
  const id = control?.props.id ?? generated;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {control
        ? cloneElement(control, {
            id,
            ...(hint ? { "aria-describedby": `${id}-hint` } : {}),
          })
        : children}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <CalendarDays size={32} />
      <h3>{title}</h3>
      <p>{children ?? "Check back soon for the next opportunity to play."}</p>
    </div>
  );
}
export function Panel({
  title,
  children,
  action,
}: {
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="panel">
      {title && (
        <div className="section-heading">
          <h2>{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function Form({
  onSubmit,
  children,
  label = "Save changes",
  className = "",
}: {
  onSubmit: (data: FormData) => Promise<unknown>;
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState(false);
  return (
    <form
      className={`form ${className}`}
      onSubmit={async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setPending(true);
        setDone(false);
        setError("");
        try {
          await onSubmit(data);
          setDone(true);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Unable to save");
        } finally {
          setPending(false);
        }
      }}
    >
      {children}
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      {done && (
        <p role="status" className="success">
          Saved successfully.
        </p>
      )}
      <button className="button primary" disabled={pending}>
        {pending ? "Working…" : label}
        <ChevronRight size={16} />
      </button>
    </form>
  );
}
export function Action({
  children,
  onClick,
  variant = "secondary",
  disabled = false,
}: {
  children: ReactNode;
  onClick: () => Promise<unknown>;
  variant?: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <span className="action">
      <button
        disabled={busy || disabled}
        className={`button ${variant}`}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await onClick();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Operation failed");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Working…" : children}
      </button>
      {error && (
        <span role="alert" className="error">
          {error}
        </span>
      )}
    </span>
  );
}
export function CourtArt({ variant = 0 }: { variant?: number }) {
  return (
    <div className={`court-art art-${variant % 3}`} aria-hidden="true">
      <div className="court-lines">
        <i />
        <i />
        <i />
      </div>
      <span className="tennis-ball" />
      <span className="court-shadow" />
    </div>
  );
}
export const reference = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "—";
export function EventCard({ event }: { event: Entity }) {
  const d = new Date(event.startDate);
  return (
    <article className="event-card">
      <Link to={`/events/${event.id}`} className="event-image">
        <CoverArt path={event.coverPath} variant={event.name.length} />
        <span className="date-tile">
          <strong>
            {d
              .toLocaleString("en-US", {
                month: "short",
                timeZone: event.timezone,
              })
              .toUpperCase()}
          </strong>
          <b>
            {d.toLocaleString("en-US", {
              day: "numeric",
              timeZone: event.timezone,
            })}
          </b>
        </span>
        <span className="image-label">
          {event.sport} · {event.eventType ?? "Club competition"}
        </span>
      </Link>
      <div className="event-card-body">
        <div className="row">
          <Badge>{event.status}</Badge>
          <span className="muted">{event.formatLabel ?? "Singles"}</span>
        </div>
        <h3>
          <Link to={`/events/${event.id}`}>{event.name}</Link>
        </h3>
        <p>
          <MapPin size={14} />
          {event.location}
        </p>
        <p>
          <Users size={14} />
          {event.divisionSummary ?? "All levels welcome"} ·{" "}
          {Math.max(0, event.capacity - (event.registeredCount ?? 0))} places
          available
        </p>
        {registrationOpenNow(event as Partial<Event>, Date.now()) &&
          event.registrationClose && (
            <p className="muted">
              Registration closes{" "}
              {new Date(event.registrationClose).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                timeZone: event.timezone,
                timeZoneName: "short",
              })}
            </p>
          )}
        <div className="event-card-bottom">
          <span>
            <strong>{money(event.fee)}</strong>
            <small>
              {event.competition && event.competition !== "individual"
                ? " / team"
                : " / player"}
            </small>
          </span>
          <Link
            aria-label={`View ${event.name}`}
            to={`/events/${event.id}`}
            className="round-link"
          >
            <ArrowUpRight size={20} />
          </Link>
        </div>
      </div>
    </article>
  );
}
export const text = (f: FormData, key: string) => String(f.get(key) ?? "");
export const number = (f: FormData, key: string) => Number(f.get(key));

export function CoverArt({
  path,
  variant = 0,
}: {
  path?: string;
  variant?: number;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    setUrl("");
    if (path)
      getDownloadURL(ref(storage, path))
        .then((url) => {
          if (active) setUrl(url);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [path]);
  return url ? (
    <img className="cover-photo" src={url} alt="" />
  ) : (
    <CourtArt variant={variant} />
  );
}

export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      onClose={onClose}
    >
      <h2 id={titleId}>{title}</h2>
      {children}
    </dialog>,
    document.body,
  );
}
