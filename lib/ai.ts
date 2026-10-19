import fs from "node:fs";
import path from "node:path";
import { getDb } from "./db";
import { getPlayer, playerMatches, playerStats, ratingHistory, fullName, ageOf, getMatch, matchRatingsFor, fmtRating } from "./queries";
import { MODELS, isLive, run, outputText, outputUrl, uploadFile, downloadToMedia, writeMedia, MEDIA_DIR } from "./replicate";

/* ------------------------------------------------------------------ */
/* Coach chat                                                          */
/* ------------------------------------------------------------------ */

export function coachContext(playerId: number): string {
  const p = getPlayer(playerId);
  if (!p) throw new Error("Player not found");
  const s = playerStats(playerId);
  const hist = ratingHistory(playerId);
  const trend = hist.length > 1 ? hist[hist.length - 1].rating - hist[0].rating : 0;
  const recent = playerMatches(playerId, 12)
    .map((m) => {
      const mine = m.p1 === playerId;
      const opp = mine ? m.p2_name : m.p1_name;
      const oppR = mine ? m.p2_rating : m.p1_rating;
      const score = mine ? m.score : m.score.split(" ").map((x) => x.split("-").reverse().join("-")).join(" ");
      return `- ${m.played_on}: ${m.winner === playerId ? "W" : "L"} ${score} vs ${opp} (${fmtRating(oppR)}), ${m.format.replace(/_/g, " ")}${m.event_name ? `, ${m.event_name}` : ""}`;
    })
    .join("\n");
  return [
    `Player: ${fullName(p)}, ${p.gender === "M" ? "male" : "female"}, age ${ageOf(p.birth_year)}, ${p.plays}-handed, ${p.backhand.toLowerCase()} backhand, ${p.city} ${p.state}.`,
    `Baseline rating: ${fmtRating(p.rating)} on a 1–16.5 scale (reliability ${p.reliability}%). 12-month change: ${trend >= 0 ? "+" : ""}${trend.toFixed(2)}.`,
    `Last 12 months: ${s.wins}-${s.losses}, won ${(s.gameShare * 100).toFixed(0)}% of games, ${s.upsetWins} wins over higher-rated players, ${s.closeLosses} close losses, ${s.threeSetWins}/${s.threeSetters} deciding sets won.`,
    `Recent matches (newest first):\n${recent}`,
  ].join("\n");
}

const COACH_SYSTEM = `You are the Baseline coach, a tennis coach inside a rating app.
Use the player's data below to give specific, practical advice. Ground every claim in the data; never invent matches.
Rating scale: 1 (beginner) to 16.5 (top professional). Roughly: 4 = solid high-school JV, 8 = strong high-school varsity / 4.5 adult league, 10–11 = college D3/NAIA, 12–13 = D1, 14+ = professional.
A rating rises when you win a bigger share of games than expected against your opponents' levels, so losing 7-5 6-4 to a much stronger player can raise it.
Keep answers short: a direct answer, then at most 4 bullets. Suggest a drill or match plan when it helps. No medical advice; suggest a professional for pain or injury.`;

export async function coachReply(playerId: number, message: string): Promise<{ reply: string; mock: boolean }> {
  const db = getDb();
  const history = db
    .prepare("SELECT role, content FROM chat_messages WHERE player_id = ? ORDER BY id DESC LIMIT 10")
    .all(playerId)
    .reverse() as { role: string; content: string }[];
  db.prepare("INSERT INTO chat_messages (player_id, role, content) VALUES (?, 'user', ?)").run(playerId, message);

  let reply: string;
  let mock = false;
  if (isLive()) {
    const transcript = history.map((h) => `${h.role === "user" ? "Player" : "Coach"}: ${h.content}`).join("\n");
    const pred = await run(MODELS.text, {
      system_instruction: `${COACH_SYSTEM}\n\n${coachContext(playerId)}`,
      prompt: `${transcript ? `${transcript}\n` : ""}Player: ${message}\nCoach:`,
      max_output_tokens: 900,
    });
    reply = outputText(pred.output).trim();
  } else {
    reply = mockCoach(playerId, message);
    mock = true;
  }
  db.prepare("INSERT INTO chat_messages (player_id, role, content, mock) VALUES (?, 'assistant', ?, ?)").run(playerId, reply, mock ? 1 : 0);
  return { reply, mock };
}

function mockCoach(playerId: number, message: string): string {
  const p = getPlayer(playerId)!;
  const s = playerStats(playerId);
  const r = p.rating ?? p.seed_rating;
  const m = message.toLowerCase();
  if (m.includes("next level") || m.includes("improve") || m.includes("rating")) {
    return `To move from ${r.toFixed(2)} towards ${(Math.floor(r) + 1).toFixed(0)}, you need to win more games against players at or just above your level, not only beat weaker ones.\n\n- Play up: enter draws where most of the field is ${(r + 0.3).toFixed(1)}–${(r + 1).toFixed(1)}. Close losses there help your rating.\n${s.closeLosses > 0 ? `- You've had ${s.closeLosses} close losses this year. Those are the matches to study; usually a few games at 30-30 decided them.\n` : `- You haven't had many close matches lately. Look for opponents within half a point of you so every game is contested.\n`}- Practise second-serve depth for 15 minutes before every hitting session.\n- Log every match here so your reliability (${p.reliability}%) climbs and the number settles.`;
  }
  if (m.includes("three") || m.includes("third") || m.includes("deciding") || m.includes("tired")) {
    return `You've won ${s.threeSetWins} of ${s.threeSetters} deciding sets in the last year.\n\n- Plan the first two games of the third set before it starts: high-percentage serve plus one pattern you trust.\n- Shorten points when you're tired: aim crosscourt with margin, attack the first short ball.\n- In a 10-point match tiebreak, the first 4 points matter most. Make returns, avoid the lines.`;
  }
  if (m.includes("tournament") || m.includes("event") || m.includes("play next")) {
    return `Look for events where your ${r.toFixed(2)} sits in the middle of the band, so you get competitive matches in every round.\n\n- Check the Events page and filter by your level.\n- Two tournaments a month with a recovery week between them is a sustainable rhythm.\n- Sign up early: draws are seeded by rating at close of entry.`;
  }
  return `Here's what your results say: ${s.wins}-${s.losses} over the last 12 months, winning ${(s.gameShare * 100).toFixed(0)}% of games${s.upsetWins ? `, with ${s.upsetWins} wins over higher-rated players` : ""}.\n\n- Your rating is ${r.toFixed(2)} with ${p.reliability}% reliability.\n- Ask me about raising your rating, deciding sets, or which events to play.\n\n(Sample reply. Add a Replicate token to get answers from a live model.)`;
}

/* ------------------------------------------------------------------ */
/* Match video analysis                                                */
/* ------------------------------------------------------------------ */

export interface VideoAnalysis {
  summary: string;
  shots: { shot: string; grade: number; observations: string }[];
  patterns: string[];
  moments: { time: string; note: string }[];
  drills: { name: string; how: string; why: string }[];
}

const VIDEO_PROMPT = (ctx: string, notes: string) => `You are a tennis coach reviewing match or practice footage of the player described below.
${ctx}
${notes ? `The player says: "${notes}"\n` : ""}
Watch the video and reply with JSON only, no markdown fences, matching this shape:
{"summary": string (2-3 sentences),
 "shots": [{"shot": "Serve"|"Return"|"Forehand"|"Backhand"|"Volley"|"Overhead"|"Movement", "grade": 1-5, "observations": string}],
 "patterns": [string] (point patterns you see, max 4),
 "moments": [{"time": "m:ss", "note": string}] (max 6, timestamps from the video),
 "drills": [{"name": string, "how": string, "why": string}] (max 3)}
Only describe what is visible. If the player is hard to identify, describe the nearest-court player and say so in the summary.`;

export async function analyzeVideo(playerId: number | null, filePath: string, contentType: string, notes: string) {
  const ctx = playerId ? coachContext(playerId) : "No profile selected.";
  let result: VideoAnalysis;
  let mock = false;
  if (isLive()) {
    const videoUrl = await uploadFile(filePath, contentType);
    const pred = await run(
      MODELS.video,
      { prompt: VIDEO_PROMPT(ctx, notes), videos: [videoUrl], max_output_tokens: 2500, thinking_level: "low" },
      { timeoutMs: 10 * 60_000, lifetime: "10m" },
    );
    result = parseAnalysis(outputText(pred.output));
  } else {
    result = mockAnalysis(playerId);
    mock = true;
  }
  const id = Number(
    getDb()
      .prepare("INSERT INTO analyses (player_id, video_path, notes, result_json, mock) VALUES (?,?,?,?,?)")
      .run(playerId, path.relative(process.cwd(), filePath), notes || null, JSON.stringify(result), mock ? 1 : 0).lastInsertRowid,
  );
  return { id, result, mock };
}

export function parseAnalysis(text: string): VideoAnalysis {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("The model didn't return an analysis. Try a shorter clip.");
  const j = JSON.parse(text.slice(start, end + 1));
  return {
    summary: String(j.summary ?? ""),
    shots: Array.isArray(j.shots) ? j.shots.map((s: Record<string, unknown>) => ({ shot: String(s.shot), grade: Math.max(1, Math.min(5, Number(s.grade) || 3)), observations: String(s.observations ?? "") })) : [],
    patterns: Array.isArray(j.patterns) ? j.patterns.map(String).slice(0, 4) : [],
    moments: Array.isArray(j.moments) ? j.moments.slice(0, 6).map((m: Record<string, unknown>) => ({ time: String(m.time), note: String(m.note) })) : [],
    drills: Array.isArray(j.drills) ? j.drills.slice(0, 3).map((d: Record<string, unknown>) => ({ name: String(d.name), how: String(d.how), why: String(d.why) })) : [],
  };
}

function mockAnalysis(playerId: number | null): VideoAnalysis {
  const p = playerId ? getPlayer(playerId) : undefined;
  const bh = p?.backhand === "One-handed" ? "one-handed backhand" : "two-handed backhand";
  return {
    summary: `Sample analysis. Solid rally tolerance from the baseline, with most errors coming when you're pulled wide to the ${bh}. Serve rhythm is consistent but the second serve lands short, inviting attacks.`,
    shots: [
      { shot: "Serve", grade: 3, observations: "Toss drifts slightly behind the head on second serves; contact point drops and the ball lands around the service line." },
      { shot: "Forehand", grade: 4, observations: "Good unit turn and racket-head speed. Recovery after inside-out forehands is late." },
      { shot: "Backhand", grade: 3, observations: `On the ${bh}, the feet stop early on wide balls, so you hit off the back foot and float it.` },
      { shot: "Return", grade: 3, observations: "Split step is often late against first serves, leading to blocked returns." },
      { shot: "Movement", grade: 4, observations: "Quick first step; the crossover back to the middle after wide shots could be sharper." },
    ],
    patterns: [
      "Wins most points when the first forehand goes heavy crosscourt.",
      "Loses points after short second serves to the backhand.",
      "Rarely comes forward to finish points after a short reply.",
    ],
    moments: [
      { time: "0:14", note: "Good split step and early preparation on the forehand." },
      { time: "0:41", note: "Second serve lands short; opponent attacks the backhand." },
      { time: "1:05", note: "Pulled wide, open-stance backhand floats long." },
      { time: "1:32", note: "Short ball not followed to the net." },
    ],
    drills: [
      { name: "Second-serve targets", how: "20 second serves aiming at a towel one racket-length inside the service line.", why: "Depth on the second serve removes the opponent's easiest attack." },
      { name: "Wide-ball recovery", how: "Coach feeds alternate wide backhands and middle balls; recover past the centre mark each time.", why: "Builds the last two steps that set up a balanced backhand." },
      { name: "Approach and finish", how: "Rally until a short ball, approach down the line, finish with a volley. Play to 7.", why: "Turns short replies into points instead of resets." },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Generated graphics: result cards and avatars                        */
/* ------------------------------------------------------------------ */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const CARD_SCENE = `A wide, low-angle photograph of an empty outdoor hard tennis court at golden hour. The court surface is deep blue with an outer border of muted green, crisp white lines running towards the net, long soft shadows from the net posts. A single optic-yellow tennis ball rests near the baseline in the foreground, in sharp focus, with the far side of the court gently blurred. Shot on a 35mm lens, warm low sun from the left, clear sky. No people, no text, no logos, no signage.`;

function inlineImage(webPath: string): string | null {
  const file = path.join(MEDIA_DIR, path.basename(webPath));
  if (!fs.existsSync(file)) return null;
  const ext = path.extname(file).slice(1).replace("jpg", "jpeg");
  return `data:image/${ext};base64,${fs.readFileSync(file).toString("base64")}`;
}

export function cardSvg(opts: { winner: string; loser: string; score: string; event: string; date: string; winnerRating: string; matchRating: string; background?: string | null }) {
  const bg = opts.background
    ? `<image href="${opts.background}" x="0" y="0" width="900" height="1200" preserveAspectRatio="xMidYMid slice"/>
       <rect width="900" height="1200" fill="url(#shade)"/>`
    : `<rect width="900" height="1200" fill="#2b5c8a"/>
       <g opacity=".55" stroke="#f4f7fa" fill="none">
         <rect x="70" y="130" width="760" height="420" stroke-width="6"/>
         <rect x="160" y="130" width="580" height="420" stroke-width="5"/>
         <line x1="450" y1="130" x2="450" y2="550" stroke-width="5"/>
       </g>
       <rect width="900" height="1200" fill="url(#shade)"/>
       <circle cx="760" cy="200" r="38" fill="#dcef4c"/>`;
  const sets = opts.score.split(" ");
  const setCols = sets
    .map((s, i) => {
      const [a, b] = s.split("-");
      const x = 60 + i * 170;
      return `<text x="${x}" y="860" class="set">${esc(a.replace(/\(.*/, ""))}</text><text x="${x}" y="970" class="set lo">${esc(b.replace(/\(.*/, ""))}</text>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 1200" width="900" height="1200">
<defs>
  <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#0f2236" stop-opacity=".15"/>
    <stop offset=".45" stop-color="#0f2236" stop-opacity=".35"/>
    <stop offset="1" stop-color="#0f2236" stop-opacity=".92"/>
  </linearGradient>
  <style>
    text{font-family:'Barlow Condensed','Arial Narrow',Arial,sans-serif;fill:#f4f7fa}
    .brand{font-size:38px;font-weight:700;letter-spacing:1px}
    .meta{font-size:30px;font-weight:500;opacity:.85}
    .name{font-size:76px;font-weight:700}
    .set{font-size:110px;font-weight:700}
    .lo{opacity:.55}
    .tag{font-size:32px;font-weight:600}
    .rate{font-size:32px;font-weight:600;fill:#dcef4c}
  </style>
</defs>
${bg}
<text x="60" y="90" class="brand">Baseline</text>
<text x="840" y="90" class="meta" text-anchor="end">${esc(opts.date)}</text>
<text x="60" y="640" class="meta">${esc(opts.event)}</text>
<text x="60" y="730" class="name">${esc(opts.winner)}</text>
${setCols}
<text x="60" y="1050" class="tag">def. ${esc(opts.loser)}</text>
<text x="60" y="1130" class="rate">Rating ${esc(opts.winnerRating)}</text>
<text x="840" y="1130" class="rate" text-anchor="end">Match rating ${esc(opts.matchRating)}</text>
</svg>`;
}

export async function generateResultCard(matchId: number) {
  const m = getMatch(matchId);
  if (!m) throw new Error("Match not found");
  const winnerIsP1 = m.winner === m.p1;
  const score = winnerIsP1 ? m.score : m.score.split(" ").map((s) => s.split("-").reverse().join("-")).join(" ");
  const mr = matchRatingsFor(matchId).get(m.winner);

  let background: string | null = null;
  let mock = true;
  if (isLive()) {
    const pred = await run(MODELS.image, { prompt: CARD_SCENE, aspect_ratio: "3:4" });
    const local = await downloadToMedia(outputUrl(pred.output), `card-bg-${matchId}`);
    background = inlineImage(local);
    mock = false;
  }
  const svg = cardSvg({
    winner: winnerIsP1 ? m.p1_name : m.p2_name,
    loser: winnerIsP1 ? m.p2_name : m.p1_name,
    score,
    event: m.event_name ?? (m.source === "league" ? "League match" : "Reported match"),
    date: new Date(m.played_on + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    winnerRating: fmtRating(winnerIsP1 ? m.p1_rating : m.p2_rating),
    matchRating: fmtRating(mr),
    background,
  });
  const url = writeMedia(`card-${matchId}-${Date.now()}.svg`, svg);
  getDb().prepare("INSERT INTO media (player_id, kind, url, prompt, mock) VALUES (?, 'card', ?, ?, ?)").run(m.winner, url, mock ? null : CARD_SCENE, mock ? 1 : 0);
  return { url, mock };
}

const AVATAR_STYLES: Record<string, string> = {
  emblem: "a flat vector sports emblem: a circular badge with a tennis racket crossed over a ball, bold geometric shapes, two-tone court blue and optic yellow",
  retro: "a retro 1970s tennis club patch, embroidered texture, racket and ball motif, cream, navy and yellow thread",
  minimal: "a minimalist line drawing of a tennis ball with one curved seam, single continuous stroke, centred on a soft blue background",
};

export async function generateAvatar(playerId: number, style: string) {
  const p = getPlayer(playerId);
  if (!p) throw new Error("Player not found");
  const look = AVATAR_STYLES[style] ?? AVATAR_STYLES.emblem;
  const prompt = `A square profile avatar for a tennis app: ${look}. Centred composition with generous padding, clean background. No text, no letters, no faces, no brand logos.`;
  let url: string;
  let mock = false;
  if (isLive()) {
    const pred = await run(MODELS.image, { prompt, aspect_ratio: "1:1" });
    url = await downloadToMedia(outputUrl(pred.output), `avatar-${playerId}`);
  } else {
    mock = true;
    const initials = `${p.first_name[0]}${p.last_name[0]}`;
    const hue = (playerId * 47) % 360;
    url = writeMedia(
      `avatar-${playerId}-${Date.now()}.svg`,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="hsl(${hue} 45% 32%)"/><circle cx="100" cy="100" r="74" fill="none" stroke="#dcef4c" stroke-width="6"/><path d="M40 70 Q100 110 160 70" fill="none" stroke="#dcef4c" stroke-width="4" opacity=".6"/><text x="100" y="122" text-anchor="middle" font-family="Barlow Condensed, Arial Narrow, sans-serif" font-weight="700" font-size="64" fill="#f4f7fa">${esc(initials)}</text></svg>`,
    );
  }
  const db = getDb();
  db.prepare("UPDATE players SET avatar_url = ? WHERE id = ?").run(url, playerId);
  db.prepare("INSERT INTO media (player_id, kind, url, prompt, mock) VALUES (?, 'avatar', ?, ?, ?)").run(playerId, url, prompt, mock ? 1 : 0);
  return { url, mock };
}
