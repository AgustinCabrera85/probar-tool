import type { V2 } from "./geometry";
import { len, norm, sub, add, mul, clamp } from "./geometry";

export type FingerName = "thumb" | "index" | "middle" | "ring" | "pinky";

export type Finger = {
  name: FingerName;
  tip: V2;
  dip: V2; // ✅ última articulación cerca de la uña
};

export type NailRenderOpts = {
  length01: number;

  baseLengthPx: number;
  baseWidthPx: number;

  palmWidthPx: number;
  autoWidthWeight?: number;

  // pequeño ajuste final (px) para meter un poco la base hacia el dedo
  insetPx: number;
};

const ratioByFinger: Record<FingerName, number> = {
  thumb: 0.22,
  index: 0.18,
  middle: 0.19,
  ring: 0.18,
  pinky: 0.16,
};

// width tweak leve por dedo (si querés podés dejar todos 1)
const widthMul: Record<FingerName, number> = {
  thumb: 1.08,
  index: 1.0,
  middle: 1.02,
  ring: 0.98,
  pinky: 0.95,
};

function lerp(a: V2, b: V2, t: number): V2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function drawNails2D(
  ctx: CanvasRenderingContext2D,
  nailImg: HTMLImageElement,
  fingers: Finger[],
  opts: NailRenderOpts
) {
  if (!nailImg.complete || nailImg.naturalWidth === 0) return;

  const autoW = clamp(opts.autoWidthWeight ?? 0.75, 0, 1);

  for (const f of fingers) {
    // Eje del dedo (DIP → TIP), es el que manda para orientar la uña
    const dir = sub(f.tip, f.dip);
    const d = len(dir);
    if (d < 8) continue;

    const u = norm(dir);

    // PNG vertical: +Y hacia la punta
    const angle = Math.atan2(u.y, u.x) + Math.PI / 2;

    // ✅ Base EXACTA: mitad entre TIP y DIP
    const baseMid = lerp(f.tip, f.dip, 0.5);

    // Anchor final: desde ese punto, metemos un poquito hacia DIP
    const anchor = add(baseMid, mul(u, -opts.insetPx));

    // Largo visual
    const extra = 1.6;
    const lengthScale = 0.7 + clamp(opts.length01, 0, 1) * extra;

    // Ancho auto por palma
    const targetWidth = opts.palmWidthPx * (ratioByFinger[f.name] ?? 0.18);
    const wMix = opts.baseWidthPx * (1 - autoW) + targetWidth * autoW;

    // Ajuste leve por perspectiva (d) y por dedo
    const sizeFactorW = clamp(0.85 + (d / 120) * 0.25, 0.75, 1.25);
    const sizeFactorH = clamp(0.85 + (d / 140) * 0.35, 0.75, 1.35);

    const w = wMix * (widthMul[f.name] ?? 1) * sizeFactorW;
    const h = opts.baseLengthPx * lengthScale * sizeFactorH;

    ctx.save();
    ctx.translate(anchor.x, anchor.y);
    ctx.rotate(angle);

    // base del PNG en anchor
    ctx.drawImage(nailImg, -w / 2, -h, w, h);

    ctx.restore();
  }
}