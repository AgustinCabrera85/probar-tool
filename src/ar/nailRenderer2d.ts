import type { V2 } from "./geometry";
import { len, norm, sub, add, mul, clamp } from "./geometry";

export type NailRenderOpts = {
  length01: number;
  baseWidthPx: number;
  baseLengthPx: number;
  insetPx: number;

  // ✅ opcionales (si no los pasás, se usan 0)
  tipOutsetPx?: number;
  lateralOffsetPx?: number;
};

type FingerTipPair = {
  tip: V2;
  dip: V2;
};

export function drawNails2D(
  ctx: CanvasRenderingContext2D,
  nailImg: HTMLImageElement,
  fingers: FingerTipPair[],
  opts: NailRenderOpts
) {
  if (!nailImg.complete || nailImg.naturalWidth === 0) return;

  const tipOutset = opts.tipOutsetPx ?? 0;
  const lateralOffset = opts.lateralOffsetPx ?? 0;

  for (let i = 0; i < fingers.length; i++) {
    const f = fingers[i];

    const dir = sub(f.tip, f.dip);
    const d = len(dir);
    if (d < 8) continue;

    const u = norm(dir);
    const perp = { x: -u.y, y: u.x };

    const angle = Math.atan2(u.y, u.x) + Math.PI / 2;

    const extra = 1.6;
    const lengthScale = 0.7 + clamp(opts.length01, 0, 1) * extra;

    const fingerWidthFactor = [1.15, 1.0, 1.0, 0.95, 0.9][i] ?? 1.0;

    const w =
      opts.baseWidthPx *
      fingerWidthFactor *
      clamp(0.85 + (d / 120) * 0.25, 0.75, 1.25);

    const h =
      opts.baseLengthPx *
      lengthScale *
      clamp(0.85 + (d / 140) * 0.35, 0.75, 1.35);

    const anchor = add(
      add(f.tip, mul(u, -opts.insetPx + tipOutset)),
      mul(perp, lateralOffset)
    );

    ctx.save();
    ctx.translate(anchor.x, anchor.y);
    ctx.rotate(angle);
    ctx.drawImage(nailImg, -w / 2, -h, w, h);
    ctx.restore();
  }
}