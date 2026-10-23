export type Pose = { yaw: number; pitch: number; roll: number };

const DEG = 180 / Math.PI;

export const wrap360 = (d: number) => ((d % 360) + 360) % 360;

/**
 * Camera pose from Expo DeviceMotion `rotation` (radians, W3C Z-X'-Y'' Euler on both platforms).
 * The individual Euler angles are not the camera's aim: beta is clamped to ±90°, so it cannot
 * express "looking up". We rebuild the device→world matrix (world: X east, Y north, Z up) and
 * read the back camera's direction (device −Z) from it.
 *
 * yaw: clockwise from the reference heading, [0, 360). pitch: +90 straight up. roll: rotation
 * of the image about the view axis, positive when the image's right edge tilts up.
 */
export function poseFromRotation(alpha: number, beta: number, gamma: number): Pose {
  const ca = Math.cos(alpha), sa = Math.sin(alpha);
  const cb = Math.cos(beta), sb = Math.sin(beta);
  const cg = Math.cos(gamma), sg = Math.sin(gamma);

  // Columns of R = Rz(alpha)·Rx(beta)·Ry(gamma): device x (right), and device z (out of screen).
  const right = [ca * cg - sa * sb * sg, sa * cg + ca * sb * sg, -cb * sg];
  const f = [-(ca * sg + sa * sb * cg), -(sa * sg - ca * sb * cg), -(cb * cg)];

  const pitch = Math.asin(Math.max(-1, Math.min(1, f[2])));
  const heading = Math.atan2(f[0], f[1]);

  // Roll-free camera axes for this heading/pitch; roll is the device's right axis measured against them.
  const sh = Math.sin(heading), ch = Math.cos(heading), sp = Math.sin(pitch), cp = Math.cos(pitch);
  const r0 = [ch, -sh, 0];
  const u0 = [-sp * sh, -sp * ch, cp];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const roll = Math.atan2(dot(right, u0), dot(right, r0));

  return { yaw: wrap360(heading * DEG), pitch: pitch * DEG, roll: roll * DEG };
}
