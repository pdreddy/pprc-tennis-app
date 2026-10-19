import fs from "node:fs";
import path from "node:path";
import { MEDIA_DIR } from "@/lib/replicate";

const TYPES: Record<string, string> = { svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

export async function GET(_: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const safe = path.basename(file);
  const full = path.join(MEDIA_DIR, safe);
  if (!fs.existsSync(full)) return new Response("Not found", { status: 404 });
  const type = TYPES[safe.split(".").pop()!.toLowerCase()] ?? "application/octet-stream";
  return new Response(fs.readFileSync(full), {
    headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable", "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src https:" },
  });
}
