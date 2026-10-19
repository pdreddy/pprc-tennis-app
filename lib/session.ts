import { cookies } from "next/headers";
import { getPlayer } from "./queries";

/**
 * Demo sign-in: the app remembers which player you are in a cookie.
 * Swap this for real auth (Auth.js, Clerk, Supabase) before going live.
 */
export async function currentPlayer() {
  const id = Number((await cookies()).get("player_id")?.value);
  return id ? getPlayer(id) : undefined;
}
