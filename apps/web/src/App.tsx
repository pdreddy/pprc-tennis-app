import { lazy, Suspense, useState, type ReactNode } from "react";
import {
  Routes,
  Route,
  Link,
  NavLink,
  useNavigate,
  useLocation,
} from "react-router-dom";
import { signOut } from "firebase/auth";
import {
  CalendarDays,
  Bell,
  Menu,
  X,
  ArrowUpRight,
  MapPin,
  ShieldCheck,
  ChevronRight,
  Search,
  Trophy,
} from "lucide-react";
import { auth, login, signup, googleLogin, emulator } from "./firebase";
import { SessionProvider, useSession, useList } from "./context";
import { EventCard, Field, Form, Empty, Panel, text } from "./ui";
const EventDetail = lazy(() =>
  import("./player").then((m) => ({ default: m.EventDetail })),
);
const Registration = lazy(() =>
  import("./player").then((m) => ({ default: m.Registration })),
);
const MyEvents = lazy(() =>
  import("./player").then((m) => ({ default: m.MyEvents })),
);
const Schedule = lazy(() =>
  import("./player").then((m) => ({ default: m.Schedule })),
);
const Profile = lazy(() =>
  import("./player").then((m) => ({ default: m.Profile })),
);
const Notifications = lazy(() =>
  import("./player").then((m) => ({ default: m.Notifications })),
);
const Results = lazy(() =>
  import("./player").then((m) => ({ default: m.Results })),
);
const Admin = lazy(() => import("./admin").then((m) => ({ default: m.Admin })));
const EventWizard = lazy(() =>
  import("./admin").then((m) => ({ default: m.EventWizard })),
);
function BottomNav() {
  const { user } = useSession();
  const items = [
    { to: "/events", label: "Events", icon: Search },
    { to: "/my-events", label: "My events", icon: Trophy },
    { to: "/schedule", label: "Schedule", icon: CalendarDays },
    { to: "/results", label: "Results", icon: ArrowUpRight },
    user
      ? { to: "/profile", label: "Profile", icon: ShieldCheck }
      : { to: "/signin", label: "Sign in", icon: ShieldCheck },
  ];
  return (
    <nav className="bottom-nav" aria-label="Mobile navigation">
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to}>
          <Icon size={20} />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
function Layout() {
  const { user, member } = useSession();
  const [menu, setMenu] = useState(false);
  const admin = ["clubAdmin", "eventAdmin", "platformAdmin"].includes(
    member?.role,
  );
  return (
    <>
      <div className="club-strip">
        <span>PROSPER PREMIER RACQUET CLUB</span>
        <span>
          <MapPin size={11} /> Prosper, Texas{" "}
          <span className="strip-dot">•</span> A community built on court
        </span>
      </div>
      <header className="site-header">
        <Link className="brand" to="/" aria-label="PPRC Events home">
          <span className="brand-mark">
            P<span>∕</span>
          </span>
          <span>
            PPRC<span className="brand-sub">EVENTS & COMPETITION</span>
          </span>
        </Link>
        <nav
          aria-label="Main navigation"
          className={menu ? "open" : ""}
          onClick={() => setMenu(false)}
        >
          <NavLink to="/events">Explore events</NavLink>
          <NavLink to="/my-events">My events</NavLink>
          <NavLink to="/schedule">Schedule</NavLink>
          <NavLink to="/results">Results</NavLink>
          {admin && <NavLink to="/admin">Admin portal</NavLink>}
        </nav>
        <div className="header-actions">
          {user ? (
            <>
              <Link
                to="/notifications"
                className="icon-button"
                aria-label="Notifications"
              >
                <Bell size={20} />
              </Link>
              <Link to="/profile" className="avatar" aria-label="My profile">
                {user.email?.slice(0, 2).toUpperCase()}
              </Link>
            </>
          ) : (
            <Link to="/signin" className="button primary small">
              Sign in <ChevronRight size={15} />
            </Link>
          )}
          <button
            className="icon-button menu-toggle"
            aria-label="Toggle menu"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            {menu ? <X /> : <Menu />}
          </button>
        </div>
      </header>
      <BottomNav />
      <main>
        <Suspense
          fallback={
            <div className="page" role="status">
              Getting your court ready…
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<Discover home />} />
            <Route path="/events" element={<Discover />} />
            <Route path="/events/:eventId" element={<EventDetail />} />
            <Route
              path="/register/:eventId/:divisionId"
              element={
                <RequireUser>
                  <Registration />
                </RequireUser>
              }
            />
            <Route
              path="/my-events"
              element={
                <RequireUser>
                  <MyEvents />
                </RequireUser>
              }
            />
            <Route
              path="/schedule"
              element={
                <RequireUser>
                  <Schedule />
                </RequireUser>
              }
            />
            <Route path="/results" element={<Results />} />
            <Route
              path="/profile"
              element={
                <RequireUser>
                  <Profile />
                </RequireUser>
              }
            />
            <Route
              path="/notifications"
              element={
                <RequireUser>
                  <Notifications />
                </RequireUser>
              }
            />
            <Route path="/signin" element={<SignIn />} />
            <Route
              path="/admin/events/new"
              element={
                <RequireUser>
                  <EventWizard />
                </RequireUser>
              }
            />
            <Route
              path="/admin/*"
              element={
                <RequireUser>
                  <Admin />
                </RequireUser>
              }
            />
            <Route
              path="*"
              element={
                <Empty title="Page not found">
                  <Link to="/events">Explore events</Link>
                </Empty>
              }
            />
          </Routes>
        </Suspense>
      </main>
      <footer>
        <Link className="brand footer-brand" to="/">
          PPRC <span>Events</span>
        </Link>
        <p>Good competition. Great community.</p>
        <span>Prosper Premier Racquet Club · Texas</span>
        {user && (
          <button className="text-button" onClick={() => signOut(auth)}>
            Sign out
          </button>
        )}
      </footer>
    </>
  );
}
export function RequireUser({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  if (loading)
    return (
      <div role="status" className="page">
        Loading your session…
      </div>
    );
  return user ? (
    <>{children}</>
  ) : (
    <div className="page narrow">
      <Panel title="Your next match starts here">
        <p>Sign in to manage your profile, register and follow your events.</p>
        <Link className="button primary" to="/signin">
          Sign in
        </Link>
      </Panel>
    </div>
  );
}
function SignIn() {
  const navigate = useNavigate();
  const [create, setCreate] = useState(false),
    [err, setErr] = useState("");
  return (
    <div className="page narrow">
      <p className="eyebrow">WELCOME TO THE CLUB</p>
      <h1>{create ? "Join the PPRC community" : "Ready to get on court?"}</h1>
      <p className="lead">Your events, your matches, your next great game.</p>
      <Panel>
        <Form
          label={create ? "Create account" : "Sign in"}
          onSubmit={async (f) => {
            await (create ? signup : login)(
              text(f, "email"),
              text(f, "password"),
            );
            navigate(create ? "/profile" : "/my-events");
          }}
        >
          <Field label="Email">
            <input name="email" type="email" autoComplete="email" required />
          </Field>
          <Field label="Password">
            <input
              name="password"
              type="password"
              minLength={8}
              autoComplete={create ? "new-password" : "current-password"}
              required
            />
          </Field>
        </Form>
        <button
          className="button secondary full"
          onClick={async () => {
            try {
              await googleLogin();
              navigate("/my-events");
            } catch (e) {
              setErr((e as Error).message);
            }
          }}
        >
          Continue with Google
        </button>
        {err && (
          <p role="alert" className="error">
            {err}
          </p>
        )}
        <button className="text-button" onClick={() => setCreate(!create)}>
          {create
            ? "Already have an account? Sign in"
            : "New here? Create an account"}
        </button>
        {emulator && (
          <div className="demo-note">
            <ShieldCheck size={18} />
            <span>
              Local emulator accounts
              <br />
              Player: player1@pprc.test
              <br />
              Admin: admin@pprc.test
              <br />
              Password: PprcDemo2026!
            </span>
          </div>
        )}
      </Panel>
    </div>
  );
}
function Discover({ home = false }: { home?: boolean }) {
  const {
    data = [],
    isLoading,
    error,
  } = useList("events", [
    ["visibility", "==", "public"],
    ["status", "!=", "Draft"],
  ]);
  const [filter, setFilter] = useState<Record<string, string>>({});
  const set = (key: string, value: string) =>
    setFilter((v) => ({ ...v, [key]: value }));
  const filtered = data
    .filter(
      (e) =>
        (!filter.search ||
          `${e.name} ${e.description} ${e.location}`
            .toLowerCase()
            .includes(filter.search.toLowerCase())) &&
        (!filter.status || e.status === filter.status) &&
        (!filter.location ||
          e.location.toLowerCase().includes(filter.location.toLowerCase())) &&
        (!filter.sport || e.sport === filter.sport) &&
        (!filter.type || e.eventType === filter.type) &&
        (!filter.start || e.startDate >= filter.start) &&
        (!filter.end || e.startDate.slice(0, 10) <= filter.end) &&
        (!filter.price || e.fee <= Number(filter.price) * 100) &&
        (!filter.level ||
          (e.divisionFilters ?? [{ minRating: 0, maxRating: 20 }]).some(
            (d: { minRating: number; maxRating: number }) =>
              Number(filter.level) >= d.minRating &&
              Number(filter.level) <= d.maxRating,
          )) &&
        (!filter.availability ||
          (e.status === "Registration Open" &&
            ((e.registeredCount ?? 0) < e.capacity || e.waitlist))) &&
        (!filter.gender ||
          e.genderCategory === filter.gender ||
          e.genderCategory === "Open") &&
        (!filter.age || e.ageGroup === filter.age || e.ageGroup === "All ages"),
    )
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const [advanced, setAdvanced] = useState(false);
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <div className="hero-kicker">
            <span />
            YOUR NEXT GREAT MATCH
          </div>
          <h1>
            More than a match.
            <br />
            <em>A place to belong.</em>
          </h1>
          <p>
            Find your competition. Meet your community.
            <br />
            Make your next moment happen at PPRC.
          </p>
          <a href="#events" className="button light">
            Find your next event <ArrowUpRight size={19} />
          </a>
          <div className="hero-proof">
            <span className="mini-avatars">
              <i>JL</i>
              <i>AM</i>
              <i>RK</i>
            </span>
            <span>
              All levels. One community.
              <br />
              <strong>See you on court.</strong>
            </span>
          </div>
        </div>
        <div className="hero-visual">
          <div className="hero-court">
            <div />
            <span />
            <i />
          </div>
          <div className="hero-caption">
            <span>THE COURT IS CALLING</span>
            <p>
              Bring your game.
              <br />
              We’ll bring the competition.
            </p>
            <span className="caption-line" />
          </div>
          <span className="hero-year">PPRC / EST. PROSPER, TX</span>
        </div>
      </section>
      <div className="benefits">
        <span>
          <Trophy />
          Competition for every level
        </span>
        <span>
          <UsersIcon />A welcoming club community
        </span>
        <span>
          <ShieldCheck />
          Simple, secure registration
        </span>
      </div>
      <section id="events" className="page event-discovery">
        <div className="section-heading">
          <div>
            <p className="eyebrow">GET IN THE GAME</p>
            <h2>{home ? "Find your next event" : "Explore PPRC events"}</h2>
            <p>
              From friendly round robins to tournament weekends. Your court
              awaits.
            </p>
          </div>
          <Link to="/my-events" className="text-link">
            My registrations <ArrowUpRight size={16} />
          </Link>
        </div>
        <div className="filter-bar">
          <label className="search-field">
            <Search size={19} />
            <input
              aria-label="Search events"
              placeholder="Search events, locations…"
              value={filter.search ?? ""}
              onChange={(e) => set("search", e.target.value)}
            />
          </label>
          <label className="filter-select">
            <CalendarDays size={17} />
            <input
              aria-label="Events from"
              type="date"
              value={filter.start ?? ""}
              onChange={(e) => set("start", e.target.value)}
            />
          </label>
          <select
            aria-label="Event status"
            value={filter.status ?? ""}
            onChange={(e) => set("status", e.target.value)}
          >
            <option value="">All events</option>
            {[
              "Registration Open",
              "Completed",
              "In Progress",
              "Registration Closed",
              "Check-In",
              "Cancelled",
            ].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button
            className="button secondary"
            aria-expanded={advanced}
            onClick={() => setAdvanced(!advanced)}
          >
            Filters{" "}
            <span className="filter-count">
              {Object.values(filter).filter(Boolean).length}
            </span>
          </button>
        </div>
        {advanced && (
          <div className="advanced-filters">
            {[
              ["location", "Location", "text"],
              ["end", "Through date", "date"],
              ["price", "Maximum price ($)", "number"],
              ["level", "Reference level", "number"],
            ].map(([key, label, type]) => (
              <Field key={key} label={label}>
                <input
                  type={type}
                  value={filter[key] ?? ""}
                  onChange={(e) => set(key, e.target.value)}
                />
              </Field>
            ))}
            {[
              ["sport", "Sport", ["Tennis", "Pickleball"]],
              ["type", "Event type", ["Tournament", "Round robin", "Social"]],
              ["gender", "Gender category", ["Open", "Male", "Female"]],
              ["age", "Age group", ["Adult", "Junior", "All ages"]],
            ].map(([key, label, options]) => (
              <Field key={String(key)} label={String(label)}>
                <select
                  value={filter[String(key)] ?? ""}
                  onChange={(e) => set(String(key), e.target.value)}
                >
                  <option value="">Any</option>
                  {(options as string[]).map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </Field>
            ))}
            <label className="check">
              <input
                type="checkbox"
                checked={!!filter.availability}
                onChange={(e) =>
                  set("availability", e.target.checked ? "open" : "")
                }
              />
              Registration available
            </label>
            <button className="text-button" onClick={() => setFilter({})}>
              Clear filters
            </button>
          </div>
        )}
        <div className="section-heading compact">
          <p>
            <strong>{filtered.length}</strong> events to get excited about
          </p>
          <span className="muted">By event date</span>
        </div>
        {isLoading ? (
          <div role="status" className="empty">
            Finding your next match…
          </div>
        ) : error ? (
          <div role="alert" className="error">
            {error.message}
          </div>
        ) : filtered.length ? (
          <div className="event-grid">
            {filtered.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        ) : (
          <Empty title="No events match your filters">
            Try another date or clear your filters.
          </Empty>
        )}
        <div className="community-banner">
          <div>
            <p className="eyebrow">YOUR CLUB. YOUR PEOPLE.</p>
            <h2>
              New to competition?
              <br />
              You’re in the right place.
            </h2>
            <p>Start with a social round robin and find your rhythm.</p>
          </div>
          <Link to="/profile" className="button primary">
            Create your player profile <ArrowUpRight size={18} />
          </Link>
        </div>
      </section>
    </>
  );
}
function UsersIcon() {
  return (
    <span aria-hidden="true" className="users-icon">
      ♧
    </span>
  );
}
export default function App() {
  return (
    <SessionProvider>
      <LocationReset />
      <Layout />
    </SessionProvider>
  );
}
function LocationReset() {
  const { pathname } = useLocation();
  const [last, setLast] = useState(pathname);
  if (last !== pathname) {
    setLast(pathname);
    window.scrollTo(0, 0);
  }
  return null;
}
