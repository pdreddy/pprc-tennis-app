import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { currentPlayer } from "@/lib/session";
import { signOut } from "./actions";
import { Avatar } from "@/components/ui";
import { fmtRating } from "@/lib/queries";

export const metadata: Metadata = {
  title: "Baseline: tennis ratings",
  description: "Level-based tennis ratings, results, events and coaching.",
};

export const dynamic = "force-dynamic";

const NAV = [
  ["/leaderboard", "Rankings"],
  ["/players", "Players"],
  ["/events", "Events"],
  ["/clubs", "Clubs"],
  ["/coach", "Coach"],
  ["/analyze", "Video review"],
];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await currentPlayer();
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <header className="bg-court-deep text-white">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3">
            <Link href="/" className="display flex items-center gap-2 text-[28px] no-underline">
              <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
                <circle cx="13" cy="13" r="12" fill="var(--color-ball)" />
                <path d="M3 8 Q13 14 3 20 M23 6 Q13 13 23 20" stroke="var(--color-court-deep)" strokeWidth="2" fill="none" />
              </svg>
              Baseline
            </Link>
            <nav className="order-3 flex w-full gap-5 overflow-x-auto text-[15px] font-medium md:order-none md:w-auto">
              {NAV.map(([href, label]) => (
                <Link key={href} href={href} className="whitespace-nowrap text-white/80 hover:text-white">
                  {label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-3">
              <Link href="/matches/new" className="rounded-md bg-ball px-3 py-1.5 text-[15px] font-semibold text-ink hover:brightness-95">
                Add result
              </Link>
              {me ? (
                <div className="flex items-center gap-2">
                  <Link href={`/players/${me.id}`} className="flex items-center gap-2 hover:underline">
                    <Avatar name={`${me.first_name} ${me.last_name}`} url={me.avatar_url} size={30} />
                    <span className="hidden text-sm sm:inline">
                      {me.first_name} <span className="num text-ball">{fmtRating(me.rating)}</span>
                    </span>
                  </Link>
                  <form action={signOut}>
                    <button className="text-sm text-white/70 hover:text-white">Sign out</button>
                  </form>
                </div>
              ) : (
                <Link href="/signin" className="text-sm text-white/85 hover:text-white">
                  Sign in
                </Link>
              )}
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 pb-10 pt-6 text-sm text-muted">
          Baseline ratings run from 1.00 to 16.50 and update every time a result is added.{" "}
          <Link href="/about" className="underline">How ratings work</Link>
        </footer>
      </body>
    </html>
  );
}
