import { useState } from "react";
import { Download, Link2, Share2 } from "lucide-react";
import type { ApiHeadToHead, RatingKind } from "./api";
import { wrap } from "./milestones";

/** 1080×1350 rivalry card: names, record and the latest result, from player A's side. */
async function renderRivalry(d: ApiHeadToHead, kind: RatingKind): Promise<Blob> {
  await document.fonts?.ready;
  const canvas = Object.assign(document.createElement("canvas"), { width: 1080, height: 1350 });
  const ctx = canvas.getContext("2d")!;
  const s = d.summary[kind];
  const last = d.matches.find((m) => m.kind === kind && m.a_won !== null);
  ctx.fillStyle = "#0b1f30";
  ctx.fillRect(0, 0, 1080, 1350);
  ctx.strokeStyle = "#ffffff1f";
  ctx.lineWidth = 6;
  ctx.strokeRect(90, 330, 900, 640);
  ctx.beginPath();
  ctx.moveTo(540, 330);
  ctx.lineTo(540, 970);
  ctx.stroke();
  ctx.fillStyle = "#d7f25c";
  ctx.font = '500 34px "DM Mono", monospace';
  ctx.fillText(`PPRC · HEAD TO HEAD · ${kind.toUpperCase()}`, 90, 140);
  ctx.fillStyle = "#ffffff";
  ctx.font = '700 72px "Space Grotesk", sans-serif';
  wrap(ctx, `${d.a.display_name} vs ${d.b.display_name}`, 90, 240, 900, 80);
  ctx.textAlign = "center";
  ctx.fillStyle = "#d7f25c";
  ctx.font = '700 300px "Space Grotesk", sans-serif';
  ctx.fillText(String(s.a_wins), 315, 760);
  ctx.fillText(String(s.b_wins), 765, 760);
  ctx.fillStyle = "#c6d3de";
  ctx.font = '600 40px Manrope, sans-serif';
  ctx.fillText(d.a.display_name.split(" ")[0], 315, 870);
  ctx.fillText(d.b.display_name.split(" ")[0], 765, 870);
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.font = '700 46px "Space Grotesk", sans-serif';
  ctx.fillText(last ? `Last: ${last.a_won ? d.a.display_name : d.b.display_name} won ${last.score_text ?? ""}`.trim() : "First meeting coming soon", 90, 1110, 900);
  ctx.fillStyle = "#93a8ba";
  ctx.font = '500 32px "DM Mono", monospace';
  if (last) ctx.fillText(new Date(last.played_at).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }), 90, 1170);
  ctx.fillText("PROSPER PREMIER RACQUET CLUB", 90, 1270);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
}

export function RivalryShare({ data, kind }: { data: ApiHeadToHead; kind: RatingKind }) {
  const [status, setStatus] = useState("");
  const url = `${window.location.origin}/players/${data.a.user_id}/vs/${data.b.user_id}`;
  const s = data.summary[kind];
  const text = `${data.a.display_name} vs ${data.b.display_name}: ${s.a_wins}-${s.b_wins} in PPRC ${kind}`;
  const shareCard = async () => {
    setStatus("");
    const blob = await renderRivalry(data, kind);
    const file = new File([blob], `pprc-h2h-${kind}.png`, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "PPRC head to head", text });
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
  const shareLink = async () => {
    setStatus("");
    if (navigator.share) {
      try {
        await navigator.share({ title: "PPRC head to head", text, url });
        return;
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
      }
    }
    await navigator.clipboard?.writeText(url);
    setStatus("Link copied · it opens for anyone when both players have public profiles");
  };
  return (
    <div className="pr-h2h-share">
      <button type="button" className="button primary small" onClick={shareCard} data-testid="h2h-share-card">{"share" in navigator ? <Share2 size={15} /> : <Download size={15} />} Share card</button>
      <button type="button" className="button secondary small" onClick={shareLink} data-testid="h2h-share-link"><Link2 size={15} /> Share link</button>
      {status && <small role="status" data-testid="h2h-share-status">{status}</small>}
    </div>
  );
}
