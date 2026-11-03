import { useEffect, useRef, useState } from "react";
import type { TriaceConfig } from "./triace-config";
import "./triace-rules.css";

const storageKey = (eventId: string) => `triace.rulesAccepted.${eventId}`;

export function rulesAlreadyAccepted(eventId: string): boolean {
  try { return localStorage.getItem(storageKey(eventId)) === "1"; } catch { return false; }
}
export function rememberRulesAccepted(eventId: string) {
  try { localStorage.setItem(storageKey(eventId), "1"); } catch { /* private mode: the acceptance still gates this visit */ }
}

const days = (config: TriaceConfig) => [5, 8, 10].map((n) => `${n} match days → ${Math.floor(n * config.minSinglesParticipationPct + 1e-9)}`).join(" · ");

/** The nine rule cards, generated from the division's effective configuration so they never disagree with the API. */
export function ruleCards(config: TriaceConfig): { title: string; body: string[] }[] {
  const positions = (list: number[]) => list.map((p) => `P${p}`).join(", ");
  const tiers = config.tiers.filter((t) => t.active).sort((a, b) => a.order - b.order);
  return [
    { title: "Triace 2.0 — official rules", body: [`${config.teamSize} players per team.`, `${config.singlesMatches + config.doublesMatches + config.superTiebreakMatches} matches each week.`, "Swipe through all nine cards, then accept the rules to register."] },
    { title: "Team composition", body: [`${config.teamSize} players, lineup positions ${positions(Array.from({ length: config.teamSize }, (_, i) => i + 1))}.`, "A player's rating is the higher of their singles and doubles rating."] },
    { title: "Team rating and tiers", body: tiers.length
      ? [`Combined rating = the sum of all ${config.teamSize} players. Both ends of each range count.`, ...tiers.map((t) => `${t.name}: ${t.minRating.toFixed(2)} – ${t.maxRating.toFixed(2)}`), "A team is placed in the highest tier its rating allows. You can state a tier preference, or choose “interested in a higher tier”. A team outside every tier cannot register."]
      : [`Combined rating must be between ${config.teamMinRating} and ${config.teamMaxRating}.`] },
    { title: "Match format", body: [`Singles: ${config.singlesMatches} matches, played by ${positions(config.singlesPositions)}.`, `Doubles: ${config.doublesMatches} matches, only these pairings: ${config.doublesPairs.map((pair) => pair.map((p) => `P${p}`).join("+")).join(", ")}.`, `Super tiebreak: ${config.superTiebreakMatches} to ${config.superTiebreakPoints} points.`] },
    { title: "Playoff eligibility", body: [`Every player must play singles on at least ${Math.round(config.minSinglesParticipationPct * 100)}% of the team's scheduled match days, rounded down.`, days(config), "Rotate your singles players. Teams that miss the minimum cannot qualify for the playoffs."] },
    { title: "Playoff qualification", body: config.playoffSize === 0 ? ["More than 7 teams: the top 4 qualify.", "7 or fewer teams: the top 3 qualify."] : [`The top ${config.playoffSize} teams qualify.`] },
    { title: "The challenge rule (provisional)", body: config.challengeEnabled
      ? [`Only teams in ${positions(config.challengeChallengerPositions)} can challenge, and only ${positions(config.challengeTargetPositions)}.`, "You must have completed all scheduled weeks on time, and challenge before the last " + config.challengeCutoffWeeks + " weeks. Each team can challenge once.", "Win: the two teams swap table positions. Lose: both keep their positions."]
      : ["The challenge rule is not in use in this division."] },
    { title: "Playoff format", body: config.playoffSize === 3 || config.playoffSize === 0
      ? ["Top 4: semifinals 1st v 4th and 2nd v 3rd, then the final.", "Top 3: 2nd v 3rd in an eliminator, then the winner plays 1st in the final."]
      : config.playoffSize === 2 ? ["The top 2 teams play the final."] : ["Semifinals 1st v 4th and 2nd v 3rd, then the final."] },
    { title: "Every playoff encounter", body: [`${config.singlesMatches} singles, ${config.doublesMatches} doubles and ${config.superTiebreakMatches} super tiebreak to ${config.superTiebreakPoints}.`, `The first team to win ${Math.floor((config.singlesMatches + config.doublesMatches + config.superTiebreakMatches) / 2) + 1} matches advances.`] },
  ];
}

/** Swipeable deck. The accept button unlocks only after every card has been viewed. */
export function TriaceRulesDeck({ config, eventId, onAccepted }: { config: TriaceConfig; eventId: string; onAccepted: () => void }) {
  const cards = ruleCards(config);
  const [index, setIndex] = useState(0);
  const [seen, setSeen] = useState<Set<number>>(new Set([0]));
  const [agreed, setAgreed] = useState(false);
  const touchX = useRef<number | null>(null);
  const go = (next: number) => {
    const clamped = Math.max(0, Math.min(cards.length - 1, next));
    setIndex(clamped);
    setSeen((previous) => new Set(previous).add(clamped));
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "ArrowRight") go(index + 1); if (event.key === "ArrowLeft") go(index - 1); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const finished = seen.size === cards.length;
  const card = cards[index];
  return (
    <section className="triace-deck" aria-label="Tournament rules">
      <div className="triace-card" role="group" aria-roledescription="slide" aria-label={`${index + 1} of ${cards.length}`}
        onTouchStart={(event) => { touchX.current = event.touches[0].clientX; }}
        onTouchEnd={(event) => { if (touchX.current !== null) { const dx = event.changedTouches[0].clientX - touchX.current; if (Math.abs(dx) > 40) go(index + (dx < 0 ? 1 : -1)); touchX.current = null; } }}>
        <p className="eyebrow">{String(index + 1).padStart(2, "0")} / {String(cards.length).padStart(2, "0")}</p>
        <h2>{card.title}</h2>
        {card.body.map((line) => <p key={line}>{line}</p>)}
      </div>
      <div className="triace-deck-nav">
        <button type="button" className="button secondary" onClick={() => go(index - 1)} disabled={index === 0}>Previous</button>
        <span className="triace-dots" aria-hidden="true">{cards.map((_, i) => <i key={i} className={i === index ? "on" : seen.has(i) ? "seen" : ""} />)}</span>
        <button type="button" className="button secondary" onClick={() => go(index + 1)} disabled={index === cards.length - 1}>Next</button>
      </div>
      <label className="check"><input type="checkbox" checked={agreed} disabled={!finished} onChange={(event) => setAgreed(event.target.checked)} /> I have read all {cards.length} cards and accept the tournament rules{finished ? "" : " (view every card first)"}</label>
      <button type="button" className="button primary" disabled={!finished || !agreed} onClick={() => { rememberRulesAccepted(eventId); onAccepted(); }}>Accept and continue to registration</button>
    </section>
  );
}
