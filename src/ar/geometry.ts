export type V2 = { x: number; y: number };

export function sub(a: V2, b: V2): V2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function add(a: V2, b: V2): V2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function mul(a: V2, s: number): V2 {
  return { x: a.x * s, y: a.y * s };
}

export function len(a: V2): number {
  return Math.hypot(a.x, a.y);
}

export function norm(a: V2): V2 {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
}

export function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

// Promedio móvil simple (suaviza temblores)
export function smooth(prev: number | null, next: number, alpha: number) {
  if (prev == null) return next;
  return prev * (1 - alpha) + next * alpha;
}

export function radToDeg(r: number) {
  return (r * 180) / Math.PI;
}

export function degToRad(d: number) {
  return (d * Math.PI) / 180;
}