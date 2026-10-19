import Link from "next/link";
import { clubs, fmtRating } from "@/lib/queries";

export default function Clubs() {
  const list = clubs();
  return (
    <div>
      <h1 className="mb-6 text-[48px]">Clubs</h1>
      <table className="sheet">
        <thead>
          <tr>
            <th>Club</th>
            <th className="hidden sm:table-cell">Courts</th>
            <th className="text-right">Members</th>
            <th className="text-right">Average</th>
            <th className="text-right">Top</th>
          </tr>
        </thead>
        <tbody>
          {list.map((c) => (
            <tr key={c.id}>
              <td>
                <Link href={`/clubs/${c.id}`} className="font-semibold hover:underline">{c.name}</Link>
                <span className="block text-sm text-muted">{c.city}, {c.state}</span>
              </td>
              <td className="hidden sm:table-cell">{c.courts} {c.surface.toLowerCase()}</td>
              <td className="num text-right">{c.members}</td>
              <td className="num text-right">{fmtRating(c.avg_rating)}</td>
              <td className="num text-right">{fmtRating(c.top_rating)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
