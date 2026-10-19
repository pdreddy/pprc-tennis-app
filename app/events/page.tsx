import Link from "next/link";
import { upcomingEvents, pastEvents, EventRow } from "@/lib/queries";
import { currentPlayer } from "@/lib/session";
import { shortDate } from "@/components/ui";

function EventList({ events, myRating }: { events: EventRow[]; myRating?: number | null }) {
  return (
    <div className="overflow-x-auto">
      <table className="sheet min-w-[600px]">
        <thead>
          <tr>
            <th>Dates</th>
            <th>Event</th>
            <th>Level</th>
            <th className="hidden sm:table-cell">Draw</th>
            <th className="text-right">Entry</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => {
            const fits = myRating != null && myRating >= e.min_rating && myRating <= e.max_rating;
            return (
              <tr key={e.id}>
                <td className="num whitespace-nowrap">{shortDate(e.start_date)}</td>
                <td>
                  <Link href={`/events/${e.id}`} className="font-semibold hover:underline">{e.name}</Link>
                  <span className="block text-sm text-muted">{e.club_name}, {e.city} {e.state}</span>
                </td>
                <td className="whitespace-nowrap">
                  <span className="num text-[17px]">{e.min_rating}–{e.max_rating}</span>
                  {fits && <span className="ml-2 rounded bg-ball px-1.5 py-0.5 text-xs font-semibold">Your level</span>}
                  <span className="block text-sm text-muted">{e.gender}</span>
                </td>
                <td className="hidden sm:table-cell"><span className="num">{e.registered}/{e.draw_size}</span></td>
                <td className="num text-right">${e.entry_fee}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function Events() {
  const me = await currentPlayer();
  return (
    <div className="space-y-12">
      <div>
        <h1 className="text-[48px]">Events</h1>
        <p className="mt-1 max-w-[60ch] text-muted">Level-based draws. Each event lists the rating band it&apos;s built for, so every round is a real match.</p>
      </div>
      <section>
        <h2 className="mb-3 text-[30px]">Open for entry</h2>
        <EventList events={upcomingEvents()} myRating={me?.rating} />
      </section>
      <section>
        <h2 className="mb-3 text-[30px]">Completed</h2>
        <EventList events={pastEvents()} />
      </section>
    </div>
  );
}
