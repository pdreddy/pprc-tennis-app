import { NextResponse } from "next/server";
import { coachReply } from "@/lib/ai";
import { getPlayer } from "@/lib/queries";

export async function POST(req: Request) {
  const { playerId, message } = await req.json();
  if (!getPlayer(Number(playerId))) return NextResponse.json({ error: "Choose a player first." }, { status: 400 });
  const text = String(message ?? "").trim().slice(0, 2000);
  if (!text) return NextResponse.json({ error: "Type a question for the coach." }, { status: 400 });
  try {
    return NextResponse.json(await coachReply(Number(playerId), text));
  } catch (e) {
    return NextResponse.json({ error: `The coach couldn't answer: ${(e as Error).message}` }, { status: 502 });
  }
}
