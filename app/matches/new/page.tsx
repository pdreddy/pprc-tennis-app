import Link from "next/link";
import { allPlayersLite, pastEvents, upcomingEvents } from "@/lib/queries";
import { currentPlayer } from "@/lib/session";
import { MatchForm } from "./form";

export default async function NewMatch() {
  const me = await currentPlayer();
  const events = [...upcomingEvents(20), ...pastEvents(20)].map((e) => ({ id: e.id, name: e.name }));
  return (
    <div>
      <h1 className="text-[48px]">Add a result</h1>
      <p className="mb-8 mt-1 max-w-[60ch] text-muted">
        Ratings for both players update as soon as you save.
        {!me && (
          <>
            {" "}<Link href="/signin?next=/matches/new" className="text-court underline">Sign in</Link> to fill in your own name automatically.
          </>
        )}
      </p>
      <MatchForm players={allPlayersLite()} meId={me?.id} events={events} />
    </div>
  );
}
