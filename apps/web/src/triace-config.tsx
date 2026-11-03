import { Field, Panel } from "./ui";
import { FieldGrid, SectionTitle, StatGrid } from "./components";

/** Every TRIACE property. Mirrors backend/app/triace_rules.py; the API validates and is the source of truth. */
export type TriaceTier = { id: string; name: string; minRating: number; maxRating: number; order: number; active: boolean };

/** Triace 2.0 rules page: GOAT 17.50-22.00 and Rising 11.50-17.00 combined rating, both ends inclusive. */
export const officialTiers: TriaceTier[] = [
  { id: "goat", name: "GOAT Tier", minRating: 17.5, maxRating: 22, order: 1, active: true },
  { id: "rising", name: "Rising Tier", minRating: 11.5, maxRating: 17, order: 2, active: true },
];

export const triaceDefaults = {
  teamSize: 3,
  singlesMatches: 2,
  doublesMatches: 2,
  superTiebreakMatches: 1,
  superTiebreakPoints: 10,
  singlesPositions: [1, 2, 3] as number[],
  doublesPairs: [[1, 3], [2, 3]] as number[][],
  teamMinRating: 12,
  teamMaxRating: 18.5,
  playerMaxRating: 20,
  minSinglesParticipationPct: 0.4,
  playoffSize: 0, // 0 = automatic: top 4 for more than 7 teams, otherwise top 3
  pointsPerWin: 3,
  pointsPerLoss: 0,
  requireRubbersInRegularSeason: false,
  tiers: [] as TriaceTier[],
  challengeEnabled: false,
  challengeChallengerPositions: [5, 6] as number[],
  challengeTargetPositions: [2, 3, 4] as number[],
  challengeCutoffWeeks: 3,
  requireConsent: false,
  aceNameMaskingEnabled: true,
};
export type TriaceConfig = typeof triaceDefaults;

const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/** Merge stored rules over the defaults. */
export function readTriaceConfig(rules: Record<string, unknown> | undefined): TriaceConfig {
  const r = rules ?? {};
  const list = (value: unknown, fallback: number[]) => (Array.isArray(value) ? value.map(Number) : fallback);
  const pairs = (value: unknown, fallback: number[][]) => (Array.isArray(value) ? value.map((pair) => (Array.isArray(pair) ? pair.map(Number) : [])) : fallback);
  return {
    teamSize: num(r.teamSize, triaceDefaults.teamSize),
    singlesMatches: num(r.singlesMatches, triaceDefaults.singlesMatches),
    doublesMatches: num(r.doublesMatches, triaceDefaults.doublesMatches),
    superTiebreakMatches: num(r.superTiebreakMatches, triaceDefaults.superTiebreakMatches),
    superTiebreakPoints: num(r.superTiebreakPoints, triaceDefaults.superTiebreakPoints),
    singlesPositions: list(r.singlesPositions, triaceDefaults.singlesPositions),
    doublesPairs: pairs(r.doublesPairs, triaceDefaults.doublesPairs),
    teamMinRating: num(r.teamMinRating, triaceDefaults.teamMinRating),
    teamMaxRating: num(r.teamMaxRating, triaceDefaults.teamMaxRating),
    playerMaxRating: num(r.playerMaxRating, triaceDefaults.playerMaxRating),
    minSinglesParticipationPct: num(r.minSinglesParticipationPct, triaceDefaults.minSinglesParticipationPct),
    playoffSize: num(r.playoffSize, triaceDefaults.playoffSize),
    pointsPerWin: num(r.pointsPerWin, triaceDefaults.pointsPerWin),
    pointsPerLoss: num(r.pointsPerLoss, triaceDefaults.pointsPerLoss),
    requireRubbersInRegularSeason: r.requireRubbersInRegularSeason === true,
    tiers: Array.isArray(r.tiers) ? (r.tiers as TriaceTier[]) : triaceDefaults.tiers,
    challengeEnabled: r.challengeEnabled === true,
    challengeChallengerPositions: list(r.challengeChallengerPositions, triaceDefaults.challengeChallengerPositions),
    challengeTargetPositions: list(r.challengeTargetPositions, triaceDefaults.challengeTargetPositions),
    challengeCutoffWeeks: num(r.challengeCutoffWeeks, triaceDefaults.challengeCutoffWeeks),
    requireConsent: r.requireConsent === true,
    aceNameMaskingEnabled: r.aceNameMaskingEnabled !== false,
  };
}

const parseList = (value: string) => value.split(",").map((part) => Number(part.trim())).filter((n) => Number.isInteger(n));
const parsePairs = (value: string) => value.split(",").map((part) => part.split("+").map((n) => Number(n.trim()))).filter((pair) => pair.length === 2 && pair.every(Number.isInteger));
/** One tier per line: id | name | min | max | order. A "~" prefix on the id marks an inactive tier. */
export const formatTiers = (tiers: TriaceTier[]) => tiers.map((t) => `${t.active ? "" : "~"}${t.id} | ${t.name} | ${t.minRating} | ${t.maxRating} | ${t.order}`).join("\n");
export function parseTiers(value: string): TriaceTier[] {
  return value.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const [rawId = "", name = "", min = "", max = "", order = ""] = line.split("|").map((part) => part.trim());
    return { id: rawId.replace(/^~/, ""), name, minRating: Number(min), maxRating: Number(max), order: Number(order), active: !rawId.startsWith("~") };
  });
}
export const formatPairs = (pairs: number[][]) => pairs.map((pair) => pair.join("+")).join(", ");

/** Read every TRIACE property from a submitted form (field names match `TriaceRulesFields`). */
export function triaceRulesFromForm(form: FormData): TriaceConfig {
  const n = (key: string) => Number(form.get(key));
  return {
    teamSize: n("teamSize"),
    singlesMatches: n("singlesMatches"),
    doublesMatches: n("doublesMatches"),
    superTiebreakMatches: n("superTiebreakMatches"),
    superTiebreakPoints: n("superTiebreakPoints"),
    singlesPositions: parseList(String(form.get("singlesPositions") ?? "")),
    doublesPairs: parsePairs(String(form.get("doublesPairs") ?? "")),
    teamMinRating: n("teamMinRating"),
    teamMaxRating: n("teamMaxRating"),
    playerMaxRating: n("playerMaxRating"),
    minSinglesParticipationPct: n("singlesPct") / 100,
    playoffSize: n("playoffSize"),
    pointsPerWin: n("pointsPerWin"),
    pointsPerLoss: n("pointsPerLoss"),
    requireRubbersInRegularSeason: form.get("requireRubbers") === "on",
    tiers: parseTiers(String(form.get("tiers") ?? "")),
    challengeEnabled: form.get("challengeEnabled") === "on",
    challengeChallengerPositions: parseList(String(form.get("challengeChallengerPositions") ?? "")),
    challengeTargetPositions: parseList(String(form.get("challengeTargetPositions") ?? "")),
    challengeCutoffWeeks: n("challengeCutoffWeeks"),
    requireConsent: form.get("requireConsent") === "on",
    aceNameMaskingEnabled: form.get("aceNameMaskingEnabled") === "on",
  };
}

/** Human-readable encounter format, e.g. "2 singles, 2 doubles, 1 super tiebreak (first to 3)". */
export function describeEncounter(config: TriaceConfig): string {
  const total = config.singlesMatches + config.doublesMatches + config.superTiebreakMatches;
  const parts = [
    config.singlesMatches && `${config.singlesMatches} singles`,
    config.doublesMatches && `${config.doublesMatches} doubles`,
    config.superTiebreakMatches && `${config.superTiebreakMatches} super tiebreak${config.superTiebreakMatches > 1 ? "s" : ""} to ${config.superTiebreakPoints}`,
  ].filter(Boolean);
  return `${parts.join(", ")}; first to ${Math.floor(total / 2) + 1} wins`;
}

/** All TRIACE settings as one form section. Use inside a `Form`; read with `triaceRulesFromForm`. */
export function TriaceRulesFields({ config = triaceDefaults, lockTeamSize = false }: { config?: TriaceConfig; lockTeamSize?: boolean }) {
  return (
    <>
      <SectionTitle>Teams</SectionTitle>
      <FieldGrid>
        <Field label="Players per team" hint={lockTeamSize ? "Locked: teams have registered" : "2 to 6"}><input name="teamSize" type="number" min="2" max="6" defaultValue={config.teamSize} disabled={lockTeamSize} required /></Field>
        {lockTeamSize && <input type="hidden" name="teamSize" value={config.teamSize} />}
        <Field label="Minimum combined PPRC rating"><input name="teamMinRating" type="number" min="0" max="120" step="0.1" defaultValue={config.teamMinRating} required /></Field>
        <Field label="Maximum combined PPRC rating"><input name="teamMaxRating" type="number" min="0" max="120" step="0.1" defaultValue={config.teamMaxRating} required /></Field>
        <Field label="Maximum PPRC rating per player"><input name="playerMaxRating" type="number" min="1" max="20" step="0.1" defaultValue={config.playerMaxRating} required /></Field>
      </FieldGrid>
      <SectionTitle>Encounter format</SectionTitle>
      <FieldGrid>
        <Field label="Singles matches"><input name="singlesMatches" type="number" min="0" max="6" defaultValue={config.singlesMatches} required /></Field>
        <Field label="Doubles matches"><input name="doublesMatches" type="number" min="0" max="6" defaultValue={config.doublesMatches} required /></Field>
        <Field label="Super tiebreak matches"><input name="superTiebreakMatches" type="number" min="0" max="6" defaultValue={config.superTiebreakMatches} required /></Field>
        <Field label="Super tiebreak points"><input name="superTiebreakPoints" type="number" min="5" max="21" defaultValue={config.superTiebreakPoints} required /></Field>
        <Field label="Lineup positions allowed in singles" hint="Comma-separated, e.g. 1,2,3 (any player)"><input name="singlesPositions" defaultValue={config.singlesPositions.join(",")} pattern="[0-9, ]*" /></Field>
        <Field label="Allowed doubles pairs" hint="Position pairs, e.g. 1+3, 2+3"><input name="doublesPairs" defaultValue={formatPairs(config.doublesPairs)} pattern="[0-9+, ]*" /></Field>
      </FieldGrid>
      <p className="hint">The total number of matches per encounter must be odd so an encounter cannot tie. Currently: {describeEncounter(config)}.</p>
      <label className="check"><input name="requireRubbers" type="checkbox" defaultChecked={config.requireRubbersInRegularSeason} /> Require match-by-match scores for regular-season encounters (always required in playoffs)</label>
      <SectionTitle>Eligibility, standings and playoffs</SectionTitle>
      <FieldGrid>
        <Field label="Singles participation required (%)"><input name="singlesPct" type="number" min="1" max="100" step="1" defaultValue={Math.round(config.minSinglesParticipationPct * 100)} required /></Field>
        <Field label="Points per win"><input name="pointsPerWin" type="number" min="0" max="10" defaultValue={config.pointsPerWin} required /></Field>
        <Field label="Points per loss"><input name="pointsPerLoss" type="number" min="0" max="10" defaultValue={config.pointsPerLoss} required /></Field>
        <Field label="Playoff teams"><select name="playoffSize" defaultValue={String(config.playoffSize)}><option value="0">Automatic (top 4 above 7 teams, otherwise top 3)</option><option value="2">2 (final only)</option><option value="3">3 (eliminator, then final)</option><option value="4">4 (semifinals and final)</option></select></Field>
      </FieldGrid>
      <SectionTitle>Tiers</SectionTitle>
      <Field label="Tier bands (combined rating)" hint="One per line: id | name | min | max | order (1 = highest). Prefix an id with ~ to deactivate. Leave empty to use only the combined-rating window above. Official: GOAT 17.5-22, Rising 11.5-17.">
        <textarea name="tiers" rows={3} defaultValue={formatTiers(config.tiers)} placeholder={formatTiers(officialTiers)} />
      </Field>
      <SectionTitle>Registration and privacy</SectionTitle>
      <label className="check"><input name="requireConsent" type="checkbox" defaultChecked={config.requireConsent} /> Registration requires player consent and acceptance of the rules</label>
      <label className="check"><input name="aceNameMaskingEnabled" type="checkbox" defaultChecked={config.aceNameMaskingEnabled} /> Hide player names on public tier lists (captain shows a first name only; names appear only when this is off and the team consented)</label>
      <SectionTitle>Challenge rule (provisional)</SectionTitle>
      <label className="check"><input name="challengeEnabled" type="checkbox" defaultChecked={config.challengeEnabled} /> Let lower-table teams challenge once; a win swaps table positions</label>
      <FieldGrid>
        <Field label="Positions that can challenge"><input name="challengeChallengerPositions" defaultValue={config.challengeChallengerPositions.join(",")} pattern="[0-9, ]*" /></Field>
        <Field label="Positions that can be challenged"><input name="challengeTargetPositions" defaultValue={config.challengeTargetPositions.join(",")} pattern="[0-9, ]*" /></Field>
        <Field label="No challenges in the last (weeks)"><input name="challengeCutoffWeeks" type="number" min="0" max="52" defaultValue={config.challengeCutoffWeeks} required /></Field>
      </FieldGrid>
    </>
  );
}

/** Read-only summary of the effective configuration. */
export function TriaceConfigSummary({ config }: { config: TriaceConfig }) {
  return (
    <Panel title="Competition settings">
      <StatGrid items={[
        { label: "Players per team", value: config.teamSize },
        { label: "Combined rating", value: `${config.teamMinRating}–${config.teamMaxRating}` },
        { label: "Singles eligibility", value: `${Math.round(config.minSinglesParticipationPct * 100)}%` },
        { label: "Points (W/L)", value: `${config.pointsPerWin}/${config.pointsPerLoss}` },
        { label: "Playoff teams", value: config.playoffSize === 0 ? "Automatic" : config.playoffSize },
        ...(config.tiers.length ? [{ label: "Tiers", value: config.tiers.filter((t) => t.active).map((t) => t.name).join(" / ") }] : []),
      ]} />
      <p><strong>Encounter:</strong> {describeEncounter(config)}</p>
      <p><strong>Singles by:</strong> {config.singlesPositions.map((p) => `P${p}`).join(", ") || "—"} · <strong>Doubles pairs:</strong> {config.doublesPairs.map((pair) => pair.map((p) => `P${p}`).join("+")).join(", ") || "—"}</p>
    </Panel>
  );
}
