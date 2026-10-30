import { Field, Panel } from "./ui";
import { FieldGrid, SectionTitle, StatGrid } from "./components";

/** Every TRIACE property. Mirrors backend/app/triace_rules.py; the API validates and is the source of truth. */
export const triaceDefaults = {
  teamSize: 3,
  singlesMatches: 2,
  doublesMatches: 2,
  superTiebreakMatches: 1,
  superTiebreakPoints: 10,
  singlesPositions: [1, 2] as number[],
  doublesPairs: [[1, 3], [2, 3]] as number[][],
  teamMinRating: 12,
  teamMaxRating: 18.5,
  playerMaxRating: 20,
  minSinglesParticipationPct: 0.4,
  playoffSize: 4,
  pointsPerWin: 3,
  pointsPerLoss: 0,
  requireRubbersInRegularSeason: false,
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
  };
}

const parseList = (value: string) => value.split(",").map((part) => Number(part.trim())).filter((n) => Number.isInteger(n));
const parsePairs = (value: string) => value.split(",").map((part) => part.split("+").map((n) => Number(n.trim()))).filter((pair) => pair.length === 2 && pair.every(Number.isInteger));
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
        <Field label="Minimum combined UTR"><input name="teamMinRating" type="number" min="0" max="120" step="0.1" defaultValue={config.teamMinRating} required /></Field>
        <Field label="Maximum combined UTR"><input name="teamMaxRating" type="number" min="0" max="120" step="0.1" defaultValue={config.teamMaxRating} required /></Field>
        <Field label="Maximum UTR per player"><input name="playerMaxRating" type="number" min="1" max="20" step="0.1" defaultValue={config.playerMaxRating} required /></Field>
      </FieldGrid>
      <SectionTitle>Encounter format</SectionTitle>
      <FieldGrid>
        <Field label="Singles matches"><input name="singlesMatches" type="number" min="0" max="6" defaultValue={config.singlesMatches} required /></Field>
        <Field label="Doubles matches"><input name="doublesMatches" type="number" min="0" max="6" defaultValue={config.doublesMatches} required /></Field>
        <Field label="Super tiebreak matches"><input name="superTiebreakMatches" type="number" min="0" max="6" defaultValue={config.superTiebreakMatches} required /></Field>
        <Field label="Super tiebreak points"><input name="superTiebreakPoints" type="number" min="5" max="21" defaultValue={config.superTiebreakPoints} required /></Field>
        <Field label="Lineup positions allowed in singles" hint="Comma-separated, e.g. 1,2"><input name="singlesPositions" defaultValue={config.singlesPositions.join(",")} pattern="[0-9, ]*" /></Field>
        <Field label="Allowed doubles pairs" hint="Position pairs, e.g. 1+3, 2+3"><input name="doublesPairs" defaultValue={formatPairs(config.doublesPairs)} pattern="[0-9+, ]*" /></Field>
      </FieldGrid>
      <p className="hint">The total number of matches per encounter must be odd so an encounter cannot tie. Currently: {describeEncounter(config)}.</p>
      <label className="check"><input name="requireRubbers" type="checkbox" defaultChecked={config.requireRubbersInRegularSeason} /> Require match-by-match scores for regular-season encounters (always required in playoffs)</label>
      <SectionTitle>Eligibility, standings and playoffs</SectionTitle>
      <FieldGrid>
        <Field label="Singles participation required (%)"><input name="singlesPct" type="number" min="1" max="100" step="1" defaultValue={Math.round(config.minSinglesParticipationPct * 100)} required /></Field>
        <Field label="Points per win"><input name="pointsPerWin" type="number" min="0" max="10" defaultValue={config.pointsPerWin} required /></Field>
        <Field label="Points per loss"><input name="pointsPerLoss" type="number" min="0" max="10" defaultValue={config.pointsPerLoss} required /></Field>
        <Field label="Playoff teams"><select name="playoffSize" defaultValue={String(config.playoffSize)}><option value="2">2 (final only)</option><option value="4">4 (semifinals and final)</option></select></Field>
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
        { label: "Combined UTR", value: `${config.teamMinRating}–${config.teamMaxRating}` },
        { label: "Singles eligibility", value: `${Math.round(config.minSinglesParticipationPct * 100)}%` },
        { label: "Points (W/L)", value: `${config.pointsPerWin}/${config.pointsPerLoss}` },
        { label: "Playoff teams", value: config.playoffSize },
      ]} />
      <p><strong>Encounter:</strong> {describeEncounter(config)}</p>
      <p><strong>Singles by:</strong> {config.singlesPositions.map((p) => `P${p}`).join(", ") || "—"} · <strong>Doubles pairs:</strong> {config.doublesPairs.map((pair) => pair.map((p) => `P${p}`).join("+")).join(", ") || "—"}</p>
    </Panel>
  );
}
