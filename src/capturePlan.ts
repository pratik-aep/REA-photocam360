import { type Vec3, direction, dot } from './orientation.ts';

export type Target = { id: string; yaw: number; pitch: number; dir: Vec3 };

const target = (id: string, yaw: number, pitch: number): Target => ({ id, yaw, pitch, dir: direction(yaw, pitch) });

const ring = (row: string, pitch: number, count: number, offset = 0): Target[] =>
  Array.from({ length: count }, (_, i) => target(`${row}-${i}`, (offset + (360 / count) * i) % 360, pitch));

export const CAPTURE_PLAN: Target[] = [
  ...ring('middle', 0, 8),
  // Sized so a portrait phone with up to a 30mm-equivalent lens leaves no gaps (server/tests).
  ...ring('up', 42, 7),
  ...ring('down', -42, 7),
  target('zenith', 0, 90),
  target('nadir', 0, -90),
];

/** Angle in degrees between where the camera points and a target. */
export const angleTo = (t: Target, forward: Vec3) => (Math.acos(Math.max(-1, Math.min(1, dot(t.dir, forward)))) * 180) / Math.PI;

export const ENTER_DEG = 4;
export const EXIT_DEG = 7;

/**
 * Which remaining target (if any) the camera is aimed at. Any order is allowed. Hysteresis keeps
 * the current target while hand tremor stays within EXIT_DEG, so the hold timer doesn't restart.
 */
export function aimedTarget(remaining: Target[], forward: Vec3, currentId: string | null): Target | null {
  const current = currentId ? remaining.find((t) => t.id === currentId) : undefined;
  if (current && angleTo(current, forward) <= EXIT_DEG) return current;
  const best = nearest(remaining, forward);
  return best && angleTo(best, forward) <= ENTER_DEG ? best : null;
}

export function nearest(remaining: Target[], forward: Vec3): Target | null {
  let best: Target | null = null;
  let bestDot = -Infinity;
  for (const t of remaining) {
    const d = dot(t.dir, forward);
    if (d > bestDot) {
      bestDot = d;
      best = t;
    }
  }
  return best;
}
