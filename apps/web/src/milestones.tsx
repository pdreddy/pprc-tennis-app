import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, Download, Mail, PartyPopper, Share2, Trophy } from "lucide-react";
import { sendMyRecap, uploadMyPhoto, type ApiMilestone } from "./api";

/** Resize on the phone before upload: square-cropped 512px JPEG keeps uploads small and fast. */
async function toSquareJpeg(file: File, size = 512): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = Object.assign(document.createElement("canvas"), { width: size, height: size });
  canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not read that image"))), "image/jpeg", 0.86));
}

export function PhotoUpload() {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ busy: boolean; error: string }>({ busy: false, error: "" });
  return (
    <div className="pr-photo-upload">
      <input ref={input} type="file" accept="image/*" hidden data-testid="photo-file-input" onChange={async (e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        setState({ busy: true, error: "" });
        try {
          await uploadMyPhoto(await toSquareJpeg(file));
          await qc.invalidateQueries();
          setState({ busy: false, error: "" });
        } catch (error) {
          const message = (error as Error).message || "";
          setState({ busy: false, error: /decod|read that image/i.test(message) || error instanceof DOMException ? "Choose a JPEG, PNG or WebP photo." : message || "Upload failed" });
        }
      }} />
      <button type="button" className="button secondary small" disabled={state.busy} onClick={() => input.current?.click()} data-testid="upload-photo-btn">
        <Camera size={15} /> {state.busy ? "Uploading…" : "Change photo"}
      </button>
      {state.error && <p role="alert" className="error">{state.error}</p>}
    </div>
  );
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, lineHeight: number) {
  const words = text.split(" ");
  let line = "";
  for (const word of words) {
    if (ctx.measureText(`${line}${word}`).width > width && line) {
      ctx.fillText(line.trim(), x, y);
      y += lineHeight;
      line = "";
    }
    line += `${word} `;
  }
  ctx.fillText(line.trim(), x, y);
}

/** Draws the 1080×1350 shareable card (portrait, fits Instagram and WhatsApp previews). */
async function renderCard(m: ApiMilestone, name: string): Promise<Blob> {
  await document.fonts?.ready;
  const canvas = Object.assign(document.createElement("canvas"), { width: 1080, height: 1350 });
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#0b1f30";
  ctx.fillRect(0, 0, 1080, 1350);
  ctx.strokeStyle = "#ffffff1f";
  ctx.lineWidth = 6;
  ctx.strokeRect(90, 470, 900, 640);
  ctx.beginPath();
  ctx.moveTo(540, 470);
  ctx.lineTo(540, 1110);
  ctx.moveTo(90, 790);
  ctx.lineTo(990, 790);
  ctx.stroke();
  ctx.fillStyle = "#d7f25c";
  ctx.font = '500 34px "DM Mono", monospace';
  ctx.fillText("PPRC · PROSPER PREMIER RACQUET CLUB", 90, 140);
  ctx.fillStyle = "#ffffff";
  ctx.font = '700 92px "Space Grotesk", sans-serif';
  wrap(ctx, m.title, 90, 270, 900, 100);
  ctx.fillStyle = "#d7f25c";
  ctx.font = '700 260px "Space Grotesk", sans-serif';
  ctx.fillText(m.rating.toFixed(2), 120, 760);
  ctx.fillStyle = "#c6d3de";
  ctx.font = '600 44px Manrope, sans-serif';
  ctx.fillText(`PPRC ${m.kind} rating`, 130, 860);
  ctx.fillText(m.type === "rank" ? `#${m.rank} of ${m.field} in the club` : m.detail, 130, 930);
  ctx.fillStyle = "#ffffff";
  ctx.font = '700 56px "Space Grotesk", sans-serif';
  ctx.fillText(name, 90, 1220);
  ctx.fillStyle = "#93a8ba";
  ctx.font = '500 32px "DM Mono", monospace';
  ctx.fillText(new Date(m.date).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }), 90, 1280);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
}

function MilestoneCard({ milestone, name }: { milestone: ApiMilestone; name: string }) {
  const [status, setStatus] = useState("");
  const share = async () => {
    setStatus("");
    const blob = await renderCard(milestone, name);
    const file = new File([blob], `pprc-${milestone.id}.png`, { type: "image/png" });
    const text = `${milestone.title} — ${milestone.detail}`;
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: milestone.title, text });
        return;
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
      }
    }
    const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: file.name });
    link.click();
    URL.revokeObjectURL(link.href);
    setStatus("Card downloaded");
  };
  return (
    <article className="pr-milestone" data-testid={`milestone-${milestone.id}`}>
      <Trophy size={22} />
      <div>
        <strong>{milestone.title}</strong>
        <small>{milestone.detail} · {new Date(milestone.date).toLocaleDateString()}</small>
      </div>
      <button type="button" className="button small" onClick={share} data-testid={`share-milestone-${milestone.id}`}>
        {"share" in navigator ? <Share2 size={15} /> : <Download size={15} />} Share
      </button>
      {status && <span role="status" className="pr-milestone-status">{status}</span>}
    </article>
  );
}

export function Milestones({ milestones, name }: { milestones: ApiMilestone[]; name: string }) {
  if (!milestones.length) return null;
  return (
    <section className="pr-milestones" id="milestones" data-testid="milestones">
      <p className="pp-section-title">Milestones</p>
      {milestones.map((m) => <MilestoneCard key={m.id} milestone={m} name={name} />)}
    </section>
  );
}

/** Celebrates a milestone reached in the last 7 days at the top of My rating. */
export function NewMilestone({ milestones }: { milestones: ApiMilestone[] }) {
  const latest = milestones[0];
  if (!latest || Date.now() - new Date(latest.date).getTime() > 7 * 86400000) return null;
  return (
    <a href="#milestones" className="pr-new-milestone" data-testid="new-milestone-banner">
      <PartyPopper size={22} /> <span><strong>New milestone!</strong> {latest.title}. Share your card below.</span>
    </a>
  );
}

export function RecapNow() {
  const [state, setState] = useState({ busy: false, message: "" });
  return (
    <span className="pr-recap-now">
      <button type="button" className="button secondary small" disabled={state.busy} data-testid="email-my-recap-btn" onClick={async () => {
        setState({ busy: true, message: "" });
        try {
          const r = await sendMyRecap();
          setState({ busy: false, message: `Sent to ${r.sent_to}` });
        } catch (error) {
          setState({ busy: false, message: (error as Error).message });
        }
      }}><Mail size={15} /> {state.busy ? "Sending…" : "Email me my recap"}</button>
      {state.message && <small role="status">{state.message}</small>}
    </span>
  );
}
