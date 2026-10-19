import { NextResponse } from "next/server";
import { generateAvatar } from "@/lib/ai";
import { currentPlayer } from "@/lib/session";

export async function POST(req: Request) {
  const { playerId, style } = await req.json();
  const me = await currentPlayer();
  if (!me || me.id !== Number(playerId)) return NextResponse.json({ error: "You can only change your own picture." }, { status: 403 });
  try {
    return NextResponse.json(await generateAvatar(me.id, String(style)));
  } catch (e) {
    return NextResponse.json({ error: `Couldn't make the avatar: ${(e as Error).message}` }, { status: 502 });
  }
}
