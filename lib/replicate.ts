/**
 * Minimal Replicate HTTP client, following replicate/skills (run-models, find-models):
 * - official models run as owner/name, community models need owner/name:version
 * - create the prediction with `Prefer: wait`, then poll until it settles
 * - file inputs go up via the Files API and are passed as HTTPS URLs
 * - output URLs expire after an hour, so callers download what they keep
 */
import fs from "node:fs";
import path from "node:path";

const API = "https://api.replicate.com/v1";

export const MODELS = {
  text: process.env.REPLICATE_TEXT_MODEL || "google/gemini-3.5-flash",
  video: process.env.REPLICATE_VIDEO_MODEL || "google/gemini-3.5-flash",
  image: process.env.REPLICATE_IMAGE_MODEL || "prunaai/p-image",
};

export const isLive = () => !!process.env.REPLICATE_API_TOKEN;

export interface Prediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output: unknown;
  error?: string | null;
  urls?: { get: string; stream?: string };
  metrics?: { predict_time?: number };
}

function headers(extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function check(res: Response) {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Replicate ${res.status}: ${body.slice(0, 400)}`);
  }
  return res.json();
}

export async function run(model: string, input: Record<string, unknown>, opts: { lifetime?: string; timeoutMs?: number } = {}) {
  if (!isLive()) throw new Error("REPLICATE_API_TOKEN is not set");
  const [ref, version] = model.split(":");
  const url = version ? `${API}/predictions` : `${API}/models/${ref}/predictions`;
  const body: Record<string, unknown> = { input };
  if (version) body.version = version;
  if (opts.lifetime) body.lifetime = opts.lifetime;

  let pred: Prediction = await check(
    await fetch(url, { method: "POST", headers: headers({ Prefer: "wait=60" }), body: JSON.stringify(body) }),
  );

  const deadline = Date.now() + (opts.timeoutMs ?? 5 * 60_000);
  while (pred.status === "starting" || pred.status === "processing") {
    if (Date.now() > deadline) throw new Error(`Prediction ${pred.id} timed out`);
    await new Promise((r) => setTimeout(r, 1500));
    pred = await check(await fetch(`${API}/predictions/${pred.id}`, { headers: headers() }));
  }
  if (pred.status !== "succeeded") throw new Error(pred.error || `Prediction ${pred.status}`);
  return pred;
}

/** Text models return an array of string chunks; join them. */
export function outputText(output: unknown): string {
  if (Array.isArray(output)) return output.join("");
  if (typeof output === "string") return output;
  return JSON.stringify(output);
}

export function outputUrl(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output) && typeof output[0] === "string") return output[0];
  throw new Error("Model returned no file URL");
}

/** Upload a local file through the Files API and get an HTTPS URL a model can read. */
export async function uploadFile(filePath: string, contentType: string): Promise<string> {
  const form = new FormData();
  const buf = fs.readFileSync(filePath);
  form.append("content", new Blob([buf], { type: contentType }), path.basename(filePath));
  const res = await fetch(`${API}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}` },
    body: form,
  });
  const json = await check(res);
  return json.urls.get as string;
}

/** Fetch a model's input schema (find-models: always check schemas before running). */
export async function inputSchema(model: string) {
  const [ref] = model.split(":");
  const json = await check(await fetch(`${API}/models/${ref}`, { headers: headers() }));
  return json?.latest_version?.openapi_schema?.components?.schemas?.Input?.properties ?? {};
}

export const MEDIA_DIR = path.join(process.cwd(), "data", "media");

/** Output URLs expire after an hour, so keep a local copy. */
export async function downloadToMedia(url: string, prefix: string): Promise<string> {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't download model output (${res.status})`);
  const ext = (new URL(url).pathname.split(".").pop() || "jpg").slice(0, 5);
  const name = `${prefix}-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(MEDIA_DIR, name), Buffer.from(await res.arrayBuffer()));
  return `/media/${name}`;
}

export function writeMedia(name: string, content: string | Buffer): string {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  fs.writeFileSync(path.join(MEDIA_DIR, name), content);
  return `/media/${name}`;
}
