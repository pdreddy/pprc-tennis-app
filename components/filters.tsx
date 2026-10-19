import { AGE_GROUPS } from "@/lib/queries";

export function PlayerFilters({
  action,
  values,
  states,
  showQuery = true,
}: {
  action: string;
  values: Record<string, string | undefined>;
  states: string[];
  showQuery?: boolean;
}) {
  return (
    <form action={action} className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-[2fr_1fr_1fr_1fr_auto] md:items-end">
      {showQuery && (
        <div className="col-span-2 md:col-span-1">
          <label className="label" htmlFor="q">Name, club or city</label>
          <input id="q" name="q" defaultValue={values.q} className="field" />
        </div>
      )}
      <div>
        <label className="label" htmlFor="gender">Division</label>
        <select id="gender" name="gender" defaultValue={values.gender ?? ""} className="field">
          <option value="">All</option>
          <option value="M">Men / boys</option>
          <option value="F">Women / girls</option>
        </select>
      </div>
      <div>
        <label className="label" htmlFor="age">Age</label>
        <select id="age" name="age" defaultValue={values.age ?? ""} className="field">
          <option value="">All ages</option>
          {Object.keys(AGE_GROUPS).map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="state">State</label>
        <select id="state" name="state" defaultValue={values.state ?? ""} className="field">
          <option value="">All</option>
          {states.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <button className="btn col-span-2 justify-center md:col-span-1">Apply</button>
    </form>
  );
}
