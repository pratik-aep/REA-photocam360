import { type Axes, type Vec3, dot } from './orientation.ts';

/** Sensor frames and the preview are 4:3; in portrait the box is 3 wide by 4 tall. */
export const PREVIEW_ASPECT = 3 / 4;
export const DEFAULT_F35 = 26;
const DIAG_35MM = Math.hypot(36, 24);

export type Box = { left: number; top: number; width: number; height: number };

/** Largest centred 3:4 box that fits the screen. The camera preview fills exactly this box. */
export function previewBox(screenW: number, screenH: number): Box {
  let width = screenW;
  let height = width / PREVIEW_ASPECT;
  if (height > screenH) {
    height = screenH;
    width = height * PREVIEW_ASPECT;
  }
  return { left: (screenW - width) / 2, top: (screenH - height) / 2, width, height };
}

/** Focal length in box units for a lens with this 35mm-equivalent focal length (same model as the server). */
export const focalForBox = (box: { width: number; height: number }, f35: number) =>
  (Math.hypot(box.width, box.height) * f35) / DIAG_35MM;

export type Projected = { x: number; y: number; inFront: boolean; onScreen: boolean };

/** Where a world direction appears in the preview box (pinhole camera, box-relative coordinates). */
export function project(d: Vec3, axes: Axes, focal: number, box: { width: number; height: number }, margin = 0): Projected {
  const z = dot(d, axes.f);
  const inFront = z > 1e-3;
  const x = box.width / 2 + (focal * dot(d, axes.r)) / (inFront ? z : 1e-3);
  const y = box.height / 2 - (focal * dot(d, axes.u)) / (inFront ? z : 1e-3);
  const onScreen = inFront && x >= -margin && x <= box.width + margin && y >= -margin && y <= box.height + margin;
  return { x, y, inFront, onScreen };
}

/**
 * Arrow on the edge of the box pointing toward an off-screen direction (works for targets behind
 * you too). Returns the arrow centre in box coordinates and its angle in degrees (0 = pointing right).
 */
export function edgeArrow(d: Vec3, axes: Axes, box: { width: number; height: number }, inset: number) {
  let dx = dot(d, axes.r);
  let dy = -dot(d, axes.u);
  if (Math.hypot(dx, dy) < 1e-6) dx = 1; // straight behind: any way round works
  const n = Math.hypot(dx, dy);
  dx /= n;
  dy /= n;
  const hw = box.width / 2 - inset, hh = box.height / 2 - inset;
  const t = Math.min(Math.abs(dx) > 1e-9 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-9 ? hh / Math.abs(dy) : Infinity);
  return { x: box.width / 2 + dx * t, y: box.height / 2 + dy * t, angle: (Math.atan2(dy, dx) * 180) / Math.PI };
}
