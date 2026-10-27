export type Pose = { yaw: number; pitch: number; roll: number };
export type Vec3 = [number, number, number];
/** Camera axes in the world (X east, Y north, Z up): forward, right and up of the image. */
export type Axes = { f: Vec3; r: Vec3; u: Vec3 };

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

export const wrap360 = (d: number) => ((d % 360) + 360) % 360;
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a: Vec3): Vec3 => {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};

/** Unit direction for a yaw (clockwise from the reference heading) and pitch (up from horizon), in degrees. */
export function direction(yaw: number, pitch: number): Vec3 {
  const h = yaw * RAD, p = pitch * RAD;
  return [Math.cos(p) * Math.sin(h), Math.cos(p) * Math.cos(h), Math.sin(p)];
}

/** Roll-free right/up axes for a heading and pitch, in radians. */
function levelAxes(h: number, p: number): { r0: Vec3; u0: Vec3 } {
  const sh = Math.sin(h), ch = Math.cos(h), sp = Math.sin(p), cp = Math.cos(p);
  return { r0: [ch, -sh, 0], u0: [-sp * sh, -sp * ch, cp] };
}

export function axesFromPose({ yaw, pitch, roll }: Pose): Axes {
  const { r0, u0 } = levelAxes(yaw * RAD, pitch * RAD);
  const c = Math.cos(roll * RAD), s = Math.sin(roll * RAD);
  const r: Vec3 = [c * r0[0] + s * u0[0], c * r0[1] + s * u0[1], c * r0[2] + s * u0[2]];
  const u: Vec3 = [-s * r0[0] + c * u0[0], -s * r0[1] + c * u0[1], -s * r0[2] + c * u0[2]];
  return { f: direction(yaw, pitch), r, u };
}

/** yaw: clockwise from north, [0, 360). pitch: +90 straight up. roll: positive when the image's right edge tilts up. */
export function poseFromAxes({ f, r }: { f: Vec3; r: Vec3 }): Pose {
  const pitch = Math.asin(Math.max(-1, Math.min(1, f[2])));
  const heading = Math.atan2(f[0], f[1]);
  const { r0, u0 } = levelAxes(heading, pitch);
  const roll = Math.atan2(dot(r, u0), dot(r, r0));
  return { yaw: wrap360(heading * DEG), pitch: pitch * DEG, roll: roll * DEG };
}

/**
 * Camera pose from Expo DeviceMotion `rotation` (radians, W3C Z-X'-Y'' Euler on both platforms).
 * The individual Euler angles are not the camera's aim: beta is clamped to ±90°, so it cannot
 * express "looking up". We rebuild the device→world matrix and read the back camera's
 * direction (device −Z) and the image's right edge (device +X) from it.
 */
export function poseFromRotation(alpha: number, beta: number, gamma: number): Pose {
  const ca = Math.cos(alpha), sa = Math.sin(alpha);
  const cb = Math.cos(beta), sb = Math.sin(beta);
  const cg = Math.cos(gamma), sg = Math.sin(gamma);
  // Columns of R = Rz(alpha)·Rx(beta)·Ry(gamma).
  const r: Vec3 = [ca * cg - sa * sb * sg, sa * cg + ca * sb * sg, -cb * sg];
  const f: Vec3 = [-(ca * sg + sa * sb * cg), -(sa * sg - ca * sb * cg), -(cb * cg)];
  return poseFromAxes({ f, r });
}

/**
 * Exponential smoothing of camera axes (k in (0, 1]; 1 = no smoothing). Interpolating the
 * vectors rather than Euler angles avoids jumps where yaw wraps or becomes ill-defined at the poles.
 */
export function smoothAxes(prev: Axes | null, next: Axes, k: number): Axes {
  if (!prev) return next;
  const lerp = (a: Vec3, b: Vec3): Vec3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const f = normalize(lerp(prev.f, next.f));
  const rr = lerp(prev.r, next.r);
  const d = dot(rr, f);
  const r = normalize([rr[0] - d * f[0], rr[1] - d * f[1], rr[2] - d * f[2]]);
  return { f, r, u: cross(r, f) };
}
