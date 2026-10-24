import { type CompetitionRules } from "@pprc/shared";
import { Field, Form, Panel, text } from "./ui";

const numeric = [
  ["teamSize", "Players per team"],
  ["singlesRubbers", "Singles rubbers"],
  ["doublesRubbers", "Doubles rubbers"],
  ["groupCount", "Number of groups"],
  ["qualifiersPerGroup", "Qualifiers per group"],
  ["tiebreakPlayers", "Deciding tiebreak players per side"],
  ["maxRubbersPerPlayer", "Maximum rubbers per player in an encounter"],
  ["combinedMinimum", "Minimum combined reference"],
  ["singlesParticipationPercent", "Minimum playoff singles participation (%)"],
  ["setGames", "Games needed to win a set"],
  ["setWinBy", "Set winning margin"],
  ["pointsTarget", "Points needed to win a points-only game"],
  ["pointsWinBy", "Point winning margin"],
  ["decidingTiebreakTarget", "Deciding tiebreak target points"],
] as const;
const optional = [
  ["combinedMaximum", "Maximum combined reference (blank for no maximum)"],
  [
    "lineupDeadlineMinutes",
    "Lineup closes this many minutes before play (blank for no deadline)",
  ],
  [
    "resultDeadlineHours",
    "Score entry closes this many hours after scheduled start (blank for no deadline)",
  ],
  ["pointsCap", "Maximum points in a points game (blank for no cap)"],
  [
    "setTiebreakAt",
    "Set tiebreak starts at this many games each (blank for advantage sets)",
  ],
] as const;
const selections = [
  [
    "stageFormat",
    "Competition stages",
    [
      ["groups-playoffs", "Group stage and playoffs"],
      ["round-robin", "Round robin"],
      ["single-elimination", "Knockout"],
    ],
  ],
  [
    "referenceMetric",
    "Reference used for each player",
    [
      ["higher", "Higher singles/doubles"],
      ["singles", "Singles reference"],
      ["doubles", "Doubles reference"],
    ],
  ],
  [
    "rubberScoring",
    "Rubber scoring",
    [
      ["one-set", "One set or points game"],
      ["best-of-three", "Best of three sets or points games"],
    ],
  ],
  [
    "participationBasis",
    "Singles participation denominator",
    [
      ["encounters", "Completed group encounters"],
      ["singles-opportunities", "Available singles rubbers"],
    ],
  ],
  [
    "encounterConfirmation",
    "Captain confirmation",
    [
      ["explicit", "Both captains confirm after lineups are revealed"],
      ["lineups", "Both submitted lineups confirm the encounter"],
    ],
  ],
] as const;
const checks = [
  [
    "policyConfirmed",
    "I reviewed this event's roster, scoring and eligibility policy",
  ],
  ["decidingTiebreak", "Include a separate deciding tiebreak rubber"],
  ["stopAtClinch", "Stop when a team wins the required majority"],
  ["distinctSingles", "Require distinct singles players"],
  ["distinctDoubles", "Require distinct doubles pairs"],
  [
    "tiebreakAfterOthers",
    "Play the deciding rubber after all preceding rubbers",
  ],
  ["requireReferences", "Require supplied external reference values"],
  ["requireVerified", "Require club-admin-verified references"],
  ["membersOnly", "Require every roster player to be a club member"],
  [
    "requireAllRosterEligible",
    "Require every player to meet playoff singles participation",
  ],
  [
    "forfeitCountsForParticipation",
    "Count assigned forfeited singles toward participation",
  ],
  ["pointsOnly", "Score rubbers as points games instead of tennis sets"],
  [
    "finalSetTiebreak",
    "Allow a match tiebreak in place of the deciding third set",
  ],
  ["noAd", "Use no-ad game scoring"],
] as const;

export function CompetitionRulesEditor({
  rules: r,
  run,
  fixedPair = false,
}: {
  rules: CompetitionRules;
  run: (action: string, data?: any) => Promise<any>;
  fixedPair?: boolean;
}) {
  const fixed = (key: string) =>
    fixedPair &&
    [
      "teamSize",
      "singlesRubbers",
      "doublesRubbers",
      "decidingTiebreak",
    ].includes(key);
  const pairs = Array.from({ length: 8 }, (_, i) => i + 1).flatMap((i) =>
    Array.from({ length: 8 - i }, (_, j) => `P${i}+P${i + j + 1}`),
  );
  return (
    <Panel title="Configure competition policy">
      <p>
        Choose the roster, stages and rules for this event. An encounter uses an
        odd number of rubbers and the majority wins. Policy changes lock after
        registration.
      </p>
      <Form
        key={JSON.stringify(r)}
        label="Save competition policy"
        onSubmit={(f) =>
          run("configure", {
            rules: {
              ...r,
              ...Object.fromEntries(
                numeric.map(([k]) => [k, f.has(k) ? Number(f.get(k)) : r[k]]),
              ),
              ...Object.fromEntries(
                optional.map(([k]) => [
                  k,
                  text(f, k) === "" ? null : Number(f.get(k)),
                ]),
              ),
              ...Object.fromEntries(selections.map(([k]) => [k, text(f, k)])),
              ...Object.fromEntries(
                checks.map(([k]) => [k, fixed(k) ? r[k] : f.get(k) === "on"]),
              ),
              winsRequired: undefined,
              allowedDoublesPairs:
                f.get("allPairs") === "on"
                  ? undefined
                  : f.getAll("pairs").map(String),
              standingsTieBreaks: f
                .getAll("standingOrder")
                .map(String)
                .filter(Boolean),
            },
            reason: text(f, "reason"),
          })
        }
      >
        <div className="form-grid">
          {numeric.map(([k, l]) => (
            <Field key={k} label={l}>
              <input
                type="number"
                name={k}
                defaultValue={r[k]}
                step={
                  k === "combinedMinimum" || k === "singlesParticipationPercent"
                    ? "0.01"
                    : "1"
                }
                min="0"
                max="160"
                required
                disabled={fixed(k)}
              />
            </Field>
          ))}
          {selections.map(([k, l, choices]) => (
            <Field key={k} label={l}>
              <select name={k} defaultValue={r[k]}>
                {choices.map(([v, name]) => (
                  <option key={v} value={v}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
          ))}
          {optional.map(([k, l]) => (
            <Field key={k} label={l}>
              <input
                type="number"
                name={k}
                min="0"
                step={k === "combinedMaximum" ? "0.01" : "1"}
                defaultValue={r[k] ?? ""}
              />
            </Field>
          ))}
        </div>
        {checks.map(([k, l]) => (
          <label className="check" key={k}>
            <input
              type="checkbox"
              name={k}
              defaultChecked={r[k]}
              disabled={fixed(k)}
            />
            {l}
          </label>
        ))}
        <details>
          <summary>Allowed doubles combinations</summary>
          <label className="check">
            <input type="checkbox" name="allPairs" />
            Allow every valid pair for the chosen roster size
          </label>
          <div className="form-grid">
            {pairs.map((p) => (
              <label className="check" key={p}>
                <input
                  type="checkbox"
                  name="pairs"
                  value={p}
                  defaultChecked={r.allowedDoublesPairs.includes(p)}
                />
                {p}
              </label>
            ))}
          </div>
        </details>
        <div className="form-grid">
          {[0, 1, 2].map((i) => (
            <Field key={i} label={`Standings tiebreak priority ${i + 1}`}>
              <select
                name="standingOrder"
                defaultValue={r.standingsTieBreaks[i] ?? ""}
              >
                <option value="">Not used</option>
                <option value="wins">Encounter wins</option>
                <option value="rubber-difference">Rubber difference</option>
                <option value="head-to-head">
                  Head-to-head among tied teams
                </option>
              </select>
            </Field>
          ))}
        </div>
        <p className="muted">
          Unknown references are allowed only when reference requirements,
          verification and combined bounds are disabled. Singles participation
          qualification applies to group-stage playoffs. In-app score entry
          records set/game totals; no-ad rules govern play on court.
        </p>
        <Field label="Competition policy change reason">
          <input name="reason" minLength={5} maxLength={1000} required />
        </Field>
      </Form>
    </Panel>
  );
}
