export default function About() {
  return (
    <article className="max-w-[66ch] space-y-5 text-[18px]">
      <h1 className="text-[48px]">How Baseline ratings work</h1>
      <p>
        Everyone sits on one scale from 1.00 to 16.50. A rating says what level you&apos;re playing at right now, based on your last 12
        months of results.
      </p>
      <h2 className="pt-4 text-[30px]">Games, not just wins</h2>
      <p>
        Each match gives both players a match rating: the opponent&apos;s rating, moved up or down by the share of games you won. Winning
        73% of the games against someone puts your match rating about one point above theirs. Losing 6-4 7-5 to a much stronger player can
        still be a great match rating.
      </p>
      <h2 className="pt-4 text-[30px]">What counts more</h2>
      <ul className="list-disc space-y-2 pl-6">
        <li>Recent matches. A match from four months ago counts half as much as one from today.</li>
        <li>Longer formats. Best-of-three counts fully; a pro set or single set counts less; a lone tiebreak counts least.</li>
        <li>Opponents with reliable ratings.</li>
        <li>Up to your 30 most recent matches are used.</li>
      </ul>
      <h2 className="pt-4 text-[30px]">Reliability</h2>
      <p>
        Reliability shows how settled your rating is, from 0 to 100%. It grows as you play more recent matches against rated opponents.
        Rankings only show players at 40% or above.
      </p>
      <h2 className="pt-4 text-[30px]">Rough guide</h2>
      <table className="sheet text-[16px]">
        <tbody>
          {[
            ["1–3", "New players and young juniors"],
            ["4–6", "High-school JV, 3.0–4.0 adult league"],
            ["7–9", "Varsity, 4.5–5.0 league"],
            ["10–12", "College (D3, NAIA, mid-major)"],
            ["13–14", "Top Division I"],
            ["15+", "Professional tour"],
          ].map(([r, d]) => (
            <tr key={r}><td className="num w-24 text-[18px] font-semibold">{r}</td><td>{d}</td></tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}
