import type { V2 } from "./geometry";
import { len, norm, sub, add, mul, clamp } from "./geometry";

export type NailRenderOpts = {
  // slider: 0..1
  length01: number;
  // control visual
  baseWidthPx: number;   // ancho base de uña en px
  baseLengthPx: number;  // largo base de uña en px
  // pequeño offset para “meter” uña sobre el dedo
  insetPx: number;
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

  for (const f of fingers) {
    const dir = sub(f.tip, f.dip);
    const d = len(dir);
    if (d < 2) continue;

    const u = norm(dir);

    // Angulo: queremos que el PNG “mire” hacia fuera del dedo.
    // Asumimos que el PNG está orientado vertical (arriba = punta).
    // Rotamos para alinear +Y del PNG con la dirección del dedo.
    // En canvas, 0 rad apunta a +X, por eso usamos atan2.
    const angle = Math.atan2(u.y, u.x) + Math.PI / 2;

    // Largo visual: base + extra según slider
    const extra = 1.6; // cuánto estira como máx (ajustable)
    const lengthScale = 0.7 + opts.length01 * extra;

    const w = opts.baseWidthPx * clamp(0.85 + (d / 120) * 0.25, 0.75, 1.25);
    const h = opts.baseLengthPx * lengthScale * clamp(0.85 + (d / 140) * 0.35, 0.75, 1.35);

    // Punto de anclaje: un poquito “adentro” del tip hacia el dip
    const anchor = add(f.tip, mul(u, -opts.insetPx));

    ctx.save();
    ctx.translate(anchor.x, anchor.y);
    ctx.rotate(angle);

    // dibujamos centrado en X y con base tocando el anclaje
    ctx.drawImage(nailImg, -w / 2, -h, w, h);

    ctx.restore();
  }
}