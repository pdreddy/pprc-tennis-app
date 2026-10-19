import { useState } from "react";
import type { Entity } from "@pprc/shared";
import { Form, Field, text, number } from "./ui";
export function ScoreForm({
  match,
  onSubmit,
  label = "Submit & finalize score",
}: {
  match: Entity;
  onSubmit: (data: any) => Promise<unknown>;
  label?: string;
}) {
  const [outcome, setOutcome] = useState("played");
  return (
    <Form
      label={label}
      onSubmit={(f) => {
        const sets = [0, 1, 2]
          .filter((i) => text(f, `a${i}`) !== "" && text(f, `b${i}`) !== "")
          .map((i) => ({
            a: number(f, `a${i}`),
            b: number(f, `b${i}`),
            ...(f.get(`mt${i}`) ? { matchTiebreak: true } : {}),
            ...(text(f, `ta${i}`) !== ""
              ? {
                  tiebreakA: number(f, `ta${i}`),
                  tiebreakB: number(f, `tb${i}`),
                }
              : {}),
          }));
        return onSubmit({
          score: {
            winner: text(f, "winner"),
            sets,
            outcome,
            notes: text(f, "notes"),
          },
          finalize: true,
        });
      }}
    >
      <div className="form-grid">
        <Field label="Winner">
          <select name="winner">
            <option value={match.p1}>Player 1</option>
            <option value={match.p2}>Player 2</option>
          </select>
        </Field>
        <Field label="Outcome">
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            {["played", "retirement", "walkover", "default"].map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </Field>
      </div>
      {!["walkover", "default"].includes(outcome) &&
        [0, 1, 2].map((i) => (
          <div key={i} className="score-inputs">
            <span>Set {i + 1}</span>
            <Field label="P1 games">
              <input name={`a${i}`} type="number" min="0" max="99" />
            </Field>
            <Field label="P2 games">
              <input name={`b${i}`} type="number" min="0" max="99" />
            </Field>
            <Field label="P1 tiebreak">
              <input name={`ta${i}`} type="number" min="0" max="99" />
            </Field>
            <Field label="P2 tiebreak">
              <input name={`tb${i}`} type="number" min="0" max="99" />
            </Field>
            {i === 2 && (
              <label className="check">
                <input type="checkbox" name={`mt${i}`} />
                10-point match tiebreak
              </label>
            )}
          </div>
        ))}
      <Field label="Notes / retirement or default reason">
        <textarea
          name="notes"
          required={outcome !== "played"}
          maxLength={1000}
        />
      </Field>
    </Form>
  );
}
