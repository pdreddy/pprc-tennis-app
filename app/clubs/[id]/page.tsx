import Link from "next/link";
import { notFound } from "next/navigation";
import { getClub, searchPlayers, upcomingEvents, fullName, ageOf } from "@/lib/queries";
import { RatingChip, shortDate } from "@/components/ui";

export default async function ClubPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const club = getClub(Number(id));
  if (!club) notFound();
  const members = searchPlayers({ clubId: club.id, limit: 300 });
  const events = upcomingEvents().filter((e) => e.club_id === club.id);
  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-[48px]">{club.name}</h1>
        <p className="text-muted">{club.city}, {club.state}. {club.courts} {club.surface.toLowerCase()} courts, {members.length} rated members.</p>
      </div>
      {events.length > 0 && (
        <section>
          <h2 className="mb-3 text-[30px]">Hosting soon</h2>
          <ul>
            {events.map((e) => (
              <li key={e.id} className="border-b border-line py-2">
                <Link href={`/events/${e.id}`} className="font-semibold hover:underline">{e.name}</Link>{" "}
                <span className="text-muted">{shortDate(e.start_date)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h2 className="mb-3 text-[30px]">Members</h2>
        <table className="sheet">
          <tbody>
            {members.map((p, i) => (
              <tr key={p.id}>
                <td className="num w-10 text-muted">{i + 1}</td>
                <td><Link href={`/players/${p.id}`} className="font-semibold hover:underline">{fullName(p)}</Link></td>
                <td className="text-muted">{p.gender}{ageOf(p.birth_year)}</td>
                <td className="text-right"><RatingChip rating={p.rating} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
