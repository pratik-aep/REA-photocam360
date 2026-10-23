export type Target = { id: string; row: string; yaw: number; pitch: number };

const ring = (row: string, pitch: number, count: number): Target[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `${row}-${i}`,
    row,
    yaw: (360 / count) * i,
    pitch,
  }));

export const CAPTURE_PLAN: Target[] = [
  ...ring('middle', 0, 8),
  // Sized so a portrait phone with up to a 30mm-equivalent lens leaves no gaps (server/tests).
  ...ring('ceiling', 42, 7),
  ...ring('bottom', -42, 7),
  { id: 'zenith', row: 'ceiling', yaw: 0, pitch: 90 },
  { id: 'nadir', row: 'floor', yaw: 0, pitch: -90 },
];

/** Signed shortest rotation from `from` to `to`, in (-180, 180]. Positive means turn right. */
export const yawDelta = (to: number, from: number) => {
  const d = (((to - from) % 360) + 540) % 360 - 180;
  return d === -180 ? 180 : d;
};

export const isPolar = (t: Target) => Math.abs(t.pitch) === 90;

/** Angular distance used for aiming; polar targets ignore yaw, which is meaningless there. */
export const aimError = (t: Target, yaw: number, pitch: number) =>
  isPolar(t) ? Math.abs(pitch - t.pitch) : Math.max(Math.abs(pitch - t.pitch), Math.abs(yawDelta(t.yaw, yaw)));

export const ENTER_TOL = 5;
export const EXIT_TOL = 8;

/** Hysteresis so hand tremor near the edge doesn't keep restarting the hold timer. */
export const onTarget = (t: Target, yaw: number, pitch: number, wasOnTarget: boolean) =>
  aimError(t, yaw, pitch) <= (wasOnTarget ? EXIT_TOL : ENTER_TOL);
