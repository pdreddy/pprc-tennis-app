import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { analyzeVideo } from "@/lib/ai";

export const maxDuration = 600;

const MAX_BYTES = 100 * 1024 * 1024; // Replicate Files API limit

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("video");
  const playerId = Number(form.get("player_id")) || null;
  const notes = String(form.get("notes") ?? "").slice(0, 500);
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose a video file to upload." }, { status: 400 });
  if (!file.type.startsWith("video/")) return NextResponse.json({ error: "That file isn't a video. Upload an MP4, MOV or WebM." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Videos must be under 100 MB. Trim the clip to a few minutes." }, { status: 400 });
  const dir = path.join(process.cwd(), "data", "uploads");
  fs.mkdirSync(dir, { recursive: true });
  const ext = (file.name.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "");
  const dest = path.join(dir, `${Date.now()}.${ext}`);
  fs.writeFileSync(dest, Buffer.from(await file.arrayBuffer()));
  try {
    const { id } = await analyzeVideo(playerId, dest, file.type, notes);
    return NextResponse.json({ id });
  } catch (e) {
    return NextResponse.json({ error: `The review failed: ${(e as Error).message}` }, { status: 502 });
  }
}
