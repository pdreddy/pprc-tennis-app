import { NextResponse } from "next/server";
import { generateResultCard } from "@/lib/ai";

export async function POST(req: Request) {
  const { matchId } = await req.json();
  try {
    return NextResponse.json(await generateResultCard(Number(matchId)));
  } catch (e) {
    return NextResponse.json({ error: `Couldn't make the card: ${(e as Error).message}` }, { status: 502 });
  }
}
