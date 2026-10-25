import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigationType } from "react-router-dom";
import { Search, X, ArrowUpRight, Bell } from "lucide-react";
import { useList, useSession } from "./context";
import { Dialog, Field } from "./ui";

export function RouteFocus() {
  const { pathname } = useLocation(),
    navigation = useNavigationType();
  useEffect(() => {
    document
      .querySelector<HTMLElement>("#main-content")
      ?.focus({ preventScroll: true });
    if (navigation !== "POP") window.scrollTo({ top: 0 });
  }, [pathname, navigation]);
  return null;
}
export function NotificationLink() {
  const { user } = useSession();
  const notes = useList(
    "notifications",
    [["playerId", "==", user?.uid ?? "guest"]],
    !!user,
  );
  const unread = notes.data?.filter((n) => !n.read).length;
  return (
    <Link
      to="/notifications"
      className="icon-button notice-trigger"
      aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
    >
      <Bell size={20} />
      {!!unread && <span className="notice-dot" aria-hidden="true" />}
    </Link>
  );
}
export function WorkspaceSearch() {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) searchInput.current?.focus();
  }, [open]);
  const trigger = useRef<HTMLButtonElement>(null),
    { user, member } = useSession();
  const events = useList(
    "events",
    [
      ["visibility", "==", "public"],
      ["status", "!=", "Draft"],
    ],
    open,
  );
  const close = () => {
    setOpen(false);
    setQuery("");
    trigger.current?.focus();
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const destinations = [
    { name: "Explore tournaments", href: "/events", type: "Discover" },
    { name: "Club and community", href: "/clubs/pprc", type: "Community" },
    { name: "Player directory", href: "/players", type: "Community" },
    { name: "Rankings", href: "/rankings", type: "Compete" },
    ...(user
      ? [
          { name: "My player home", href: "/", type: "Personal" },
          { name: "Matches and calendar", href: "/schedule", type: "Personal" },
          { name: "My registrations", href: "/my-events", type: "Personal" },
          { name: "My teams", href: "/teams", type: "Personal" },
          {
            name: "Performance dashboard",
            href: "/dashboard",
            type: "Personal",
          },
          {
            name: "My profile and availability",
            href: "/profile",
            type: "Personal",
          },
          {
            name: "Notification inbox",
            href: "/notifications",
            type: "Personal",
          },
        ]
      : [{ name: "Sign in", href: "/signin", type: "Account" }]),
    ...(["clubAdmin", "eventAdmin", "platformAdmin"].includes(member?.role)
      ? [
          {
            name: "Organizer operations",
            href: "/admin/operations",
            type: "Organizer",
          },
          {
            name: "Courts and venues",
            href: "/admin/courts",
            type: "Organizer",
          },
        ]
      : []),
  ];
  const results = [
    ...destinations,
    ...(events.data ?? []).map((e) => ({
      name: String(e.name),
      href: `/events/${e.id}`,
      type: "Tournament",
    })),
  ]
    .filter((r) => r.name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 15);
  return (
    <>
      <button
        ref={trigger}
        className="workspace-search-trigger"
        aria-label="Open quick search"
        aria-keyshortcuts="Control+k Meta+k"
        onClick={() => setOpen(true)}
      >
        <Search size={18} />
        <span>Quick search</span>
        <kbd>⌘ K</kbd>
      </button>
      {open && (
        <Dialog title="Your next move" onClose={close}>
          <div className="command-heading">
            <p>Find a tournament or jump to your workspace.</p>
            <button
              className="icon-button"
              aria-label="Close quick search"
              onClick={close}
            >
              <X size={20} />
            </button>
          </div>
          <Field label="Search workspace">
            <input
              type="search"
              ref={searchInput}
              autoFocus
              placeholder="Tournaments, teams, rankings…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </Field>
          <nav className="command-results" aria-label="Quick search results">
            {results.map((r) => (
              <Link key={r.href} to={r.href} onClick={close}>
                <span>
                  <small>{r.type}</small>
                  <strong>{r.name}</strong>
                </span>
                <ArrowUpRight size={17} />
              </Link>
            ))}
          </nav>
          {!results.length && (
            <p role="status">No matches. Try another name.</p>
          )}
          {events.isFetching && (
            <p role="status">Loading public tournaments…</p>
          )}
          {events.error && (
            <p role="alert" className="error">
              Tournament search is unavailable. Navigation links remain
              available.
            </p>
          )}
        </Dialog>
      )}
    </>
  );
}
export function ConnectionStatus() {
  const [online, setOnline] = useState(navigator.onLine),
    [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    const refresh = () => setOnline(navigator.onLine);
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    return () => {
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
    };
  }, []);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let cancelled = false;
    const cleanups: (() => void)[] = [];
    void navigator.serviceWorker.ready
      .then((reg) => {
        if (cancelled) return;
        if (reg.waiting) setWaiting(reg.waiting);
        const found = () => {
          const worker = reg.installing;
          if (!worker) return;
          const changed = () => {
            if (
              worker.state === "installed" &&
              navigator.serviceWorker.controller
            )
              setWaiting(reg.waiting);
          };
          worker.addEventListener("statechange", changed);
          cleanups.push(() =>
            worker.removeEventListener("statechange", changed),
          );
        };
        reg.addEventListener("updatefound", found);
        cleanups.push(() => reg.removeEventListener("updatefound", found));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      cleanups.forEach((c) => c());
    };
  }, []);
  return (
    <>
      {!online && (
        <div role="status" className="connection-banner">
          You’re offline. Reconnect to load private records, register or submit
          scores.
        </div>
      )}
      {waiting && (
        <div role="status" className="connection-banner">
          An app update is ready. Save your changes first.{" "}
          <button
            className="button secondary small"
            onClick={() => {
              navigator.serviceWorker.addEventListener(
                "controllerchange",
                () => window.location.reload(),
                { once: true },
              );
              waiting.postMessage({ type: "SKIP_WAITING" });
            }}
          >
            Apply update
          </button>
        </div>
      )}
    </>
  );
}
