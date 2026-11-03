import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  CalendarCheck,
  CheckCircle2,
  ClipboardList,
  Download,
  GitBranch,
  ListOrdered,
  Share,
  ShieldCheck,
  Smartphone,
  Trophy,
  UserRound,
  Users,
} from "lucide-react";
import { useList, useSession } from "./context";
import { tournamentFormats } from "./api";
import { useInstall } from "./install";
import "./landing.css";

const HERO_IMAGE =
  "https://images.unsplash.com/photo-1542446608-e9525230faed?crop=entropy&cs=srgb&fm=jpg&q=80&w=1800";
const COMMUNITY_IMAGE =
  "https://images.unsplash.com/photo-1587683437362-da7775ffc532?crop=entropy&cs=srgb&fm=jpg&q=80&w=1200";

const steps = [
  { icon: UserRound, title: "Build your player profile", body: "Pick a starting level. Your PPRC Rating then grows from every verified match you play." },
  { icon: ListOrdered, title: "Enter a division at your level", body: "Pick singles, doubles or a TRIACE team. Full divisions keep a fair, first-come waitlist." },
  { icon: CalendarCheck, title: "Play your scheduled matches", body: "Draws, courts and times land in your schedule, with reminders in the app." },
  { icon: CheckCircle2, title: "Confirm scores, climb the table", body: "Report a score, your opponent confirms, and standings and brackets update instantly." },
];

const organizerPoints = [
  "Seven formats from round robin to ladder, singles or doubles",
  "Seeded, snake-drawn groups and knockout brackets in one click",
  "Player score reporting with opponent confirmation and disputes",
  "Walkovers, withdrawals and waitlist promotion handled for you",
  "Every change kept in an audit trail club staff can review",
];

export function Landing() {
  return (
    <div className="lp" data-testid="landing-page">
      <Hero />
      <Steps />
      <Formats />
      <UpcomingEvents />
      <Organizers />
      <InstallBand />
    </div>
  );
}

function Hero() {
  const { user } = useSession();
  const { data: events = [] } = useList("events");
  return (
    <section className="lp-hero" data-testid="landing-hero">
      <img className="lp-hero-img" src={HERO_IMAGE} alt="Aerial view of two players rallying on a blue hard court" />
      <div className="lp-hero-shade" />
      <div className="lp-hero-inner">
        <p className="lp-kicker lp-rise">
          <span /> PROSPER PREMIER RACQUET CLUB
        </p>
        <h1 className="lp-rise lp-d1">
          Match play at <em>your level.</em>
          <br />
          Every week.
        </h1>
        <p className="lp-lead lp-rise lp-d2">
          Leagues, ladders and tournaments for every tennis player at PPRC. Earn your own PPRC Rating, enter the
          right division, and let the app handle draws, schedules and scores.
        </p>
        <div className="lp-actions lp-rise lp-d3">
          <Link to={user ? "/events" : "/signin"} className="lp-btn lp-btn-primary" data-testid="hero-get-started-btn">
            {user ? "Find my next event" : "Join the club app"} <ArrowUpRight size={18} />
          </Link>
          <a href="#install" className="lp-btn lp-btn-ghost" data-testid="hero-install-link">
            <Smartphone size={18} /> Install on your phone
          </a>
        </div>
        <dl className="lp-hero-stats lp-rise lp-d4">
          <div>
            <dt>Open events</dt>
            <dd data-testid="hero-stat-events">{events.length}</dd>
          </div>
          <div>
            <dt>Formats</dt>
            <dd data-testid="hero-stat-formats">{tournamentFormats.length}</dd>
          </div>
          <div>
            <dt>Score sign-off</dt>
            <dd>2-way</dd>
          </div>
        </dl>
      </div>
      <ScoreCard />
    </section>
  );
}

function ScoreCard() {
  return (
    <aside className="lp-scorecard lp-rise lp-d3" aria-label="Example confirmed match result">
      <div className="lp-scorecard-head">
        <span>OPEN SINGLES · SEMIFINAL</span>
        <span className="lp-live">Confirmed</span>
      </div>
      {[
        { name: "J. Lawson", rating: "PPRC 7.40", sets: [6, 4, 10], won: true },
        { name: "A. Mehta", rating: "PPRC 7.10", sets: [3, 6, 7], won: false },
      ].map((row) => (
        <div key={row.name} className={`lp-score-row${row.won ? " is-won" : ""}`}>
          <span className="lp-score-name">
            {row.name}
            <small>{row.rating}</small>
          </span>
          {row.sets.map((s, i) => (
            <span key={i} className="lp-score-set">
              {s}
            </span>
          ))}
        </div>
      ))}
      <p className="lp-scorecard-foot">Winner advances to the final · Court 3 · Sat 9:00</p>
    </aside>
  );
}

function Steps() {
  return (
    <section className="lp-section" data-testid="landing-steps">
      <div className="lp-section-head">
        <p className="lp-eyebrow">HOW IT WORKS</p>
        <h2>From sign-up to final in four steps</h2>
      </div>
      <ol className="lp-steps">
        {steps.map(({ icon: Icon, title, body }, i) => (
          <li key={title} className="lp-step">
            <span className="lp-step-num">{String(i + 1).padStart(2, "0")}</span>
            <Icon size={22} className="lp-step-icon" />
            <h3>{title}</h3>
            <p>{body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Formats() {
  return (
    <section className="lp-formats" data-testid="landing-formats">
      <div className="lp-section">
        <div className="lp-section-head light">
          <p className="lp-eyebrow">PICK YOUR GAME</p>
          <h2>Seven ways to compete</h2>
          <p>Organizers pick the format; the app runs the draw, the table and the bracket.</p>
        </div>
        <div className="lp-format-grid">
          {tournamentFormats.map((f, i) => (
            <article key={f.key} className="lp-format" data-testid={`format-card-${f.key}`}>
              <span className="lp-format-idx">{String(i + 1).padStart(2, "0")}</span>
              {f.key === "ladder" ? <ListOrdered size={20} /> : f.individual ? <GitBranch size={20} /> : <Users size={20} />}
              <h3>{f.label}</h3>
              <p>{f.description}</p>
            </article>
          ))}
          <Link to="/events" className="lp-format lp-format-cta" data-testid="format-cta-link">
            <Trophy size={20} />
            <h3>Find a format that fits</h3>
            <p>Browse open events and enter the division at your level.</p>
            <ArrowUpRight size={22} className="lp-format-cta-arrow" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function UpcomingEvents() {
  const { data = [], isLoading, error } = useList("events");
  const upcoming = [...data].sort((a, b) => String(a.startDate).localeCompare(String(b.startDate))).slice(0, 3);
  return (
    <section className="lp-section" data-testid="landing-upcoming">
      <div className="lp-section-head row">
        <div>
          <p className="lp-eyebrow">ON THE CALENDAR</p>
          <h2>Upcoming at PPRC</h2>
        </div>
        <Link to="/events" className="lp-link" data-testid="upcoming-see-all-link">
          See all events <ArrowUpRight size={16} />
        </Link>
      </div>
      {isLoading ? (
        <p role="status" className="lp-muted">Loading events…</p>
      ) : error ? (
        <p role="alert" className="lp-muted">Events are unavailable right now. Please try again shortly.</p>
      ) : upcoming.length ? (
        <div className="lp-event-list">
          {upcoming.map((e) => {
            const date = new Date(e.startDate);
            return (
              <Link key={e.id} to={`/events/${e.id}`} className="lp-event" data-testid={`upcoming-event-${e.id}`}>
                <span className="lp-event-date">
                  <strong>{date.toLocaleDateString("en-US", { day: "2-digit" })}</strong>
                  {date.toLocaleDateString("en-US", { month: "short" }).toUpperCase()}
                </span>
                <span className="lp-event-body">
                  <strong>{e.name}</strong>
                  <small>
                    {e.venue} · {e.capacity} places · {e.fee ? `$${e.fee}` : "Free entry"}
                  </small>
                </span>
                <ArrowUpRight size={20} className="lp-event-arrow" />
              </Link>
            );
          })}
        </div>
      ) : (
        <p className="lp-muted">New events are announced soon. Install the app to be the first to know.</p>
      )}
    </section>
  );
}

function Organizers() {
  return (
    <section className="lp-section lp-split" data-testid="landing-organizers">
      <div className="lp-split-media">
        <img src={COMMUNITY_IMAGE} alt="Players sitting courtside with their racquets" loading="lazy" />
        <div className="lp-split-badge">
          <ShieldCheck size={18} /> Club staff approve every seed and correction
        </div>
      </div>
      <div className="lp-split-copy">
        <p className="lp-eyebrow">FOR ORGANIZERS</p>
        <h2>Run a whole season from your phone</h2>
        <ul className="lp-checks">
          {organizerPoints.map((p) => (
            <li key={p}>
              <ClipboardList size={18} /> {p}
            </li>
          ))}
        </ul>
        <Link to="/admin" className="lp-btn lp-btn-dark" data-testid="organizers-admin-link">
          Open the admin portal <Trophy size={17} />
        </Link>
      </div>
    </section>
  );
}

function InstallBand() {
  const { canPrompt, installed, ios, install } = useInstall();
  const [help, setHelp] = useState(false);
  return (
    <section id="install" className="lp-install" data-testid="landing-install">
      <div className="lp-install-copy">
        <p className="lp-eyebrow">TAKE IT COURTSIDE</p>
        <h2>Install PPRC Events on your home screen</h2>
        <p>No app store needed. It opens full screen, loads fast and keeps your draws and schedule one tap away.</p>
      </div>
      <div className="lp-install-action">
        {installed ? (
          <p className="lp-installed" data-testid="install-done">
            <CheckCircle2 size={20} /> Installed. You are all set.
          </p>
        ) : (
          <button
            type="button"
            className="lp-btn lp-btn-primary"
            data-testid="install-app-btn"
            onClick={async () => {
              if (!(await install())) setHelp(true);
            }}
          >
            <Download size={18} /> {canPrompt ? "Install the app" : "How to install"}
          </button>
        )}
        {help && !installed && (
          <p className="lp-install-help" role="status" data-testid="install-help">
            {ios ? (
              <>
                In Safari, tap <Share size={15} /> Share, then <strong>Add to Home Screen</strong>.
              </>
            ) : (
              <>
                Open your browser menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.
              </>
            )}
          </p>
        )}
      </div>
    </section>
  );
}
