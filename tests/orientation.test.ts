/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { poseFromRotation, wrap360 } from '../src/orientation.ts';

const RAD = Math.PI / 180;
type V = [number, number, number];

// Camera axes in ENU world for a pose: forward, right, up (same convention as server/stitcher.py).
function axes(yaw: number, pitch: number, roll: number): { f: V; r: V; u: V } {
  const h = yaw * RAD, p = pitch * RAD, q = roll * RAD;
  const f: V = [Math.cos(p) * Math.sin(h), Math.cos(p) * Math.cos(h), Math.sin(p)];
  const r0: V = [Math.cos(h), -Math.sin(h), 0];
  const u0: V = [-Math.sin(p) * Math.sin(h), -Math.sin(p) * Math.cos(h), Math.cos(p)];
  const mix = (a: V, b: V, ca: number, cb: number): V => [ca * a[0] + cb * b[0], ca * a[1] + cb * b[1], ca * a[2] + cb * b[2]];
  return { f, r: mix(r0, u0, Math.cos(q), Math.sin(q)), u: mix(r0, u0, -Math.sin(q), Math.cos(q)) };
}

// What Expo's Android DeviceMotionModule emits for a true camera pose:
// SensorManager.getOrientation() on R = [right | up | -forward], then alpha=-azimuth, beta=-pitch.
// `float32` mimics Android, which computes R and getOrientation() in single precision.
function androidRotation(yaw: number, pitch: number, roll: number, float32 = false) {
  const q = float32 ? Math.fround : (x: number) => x;
  const { f, r, u } = axes(yaw, pitch, roll);
  const R = [r[0], u[0], -f[0], r[1], u[1], -f[1], r[2], u[2], -f[2]].map(q);
  const azimuth = q(Math.atan2(R[1], R[4]));
  const pitchA = q(Math.asin(-R[7]));
  const rollA = q(Math.atan2(-R[6], R[8]));
  return { alpha: -azimuth, beta: -pitchA, gamma: rollA };
}

// Exactly upright with zero roll is gimbal lock: getOrientation() discards the heading there.
// A hand-held phone is never exactly there, so poses are offset slightly.
const pose = (yaw: number, pitch: number, roll: number, float32 = false) => {
  const { alpha, beta, gamma } = androidRotation(yaw, pitch, roll, float32);
  return poseFromRotation(alpha, beta, gamma);
};

const close = (a: V, b: V, tol = 1e-6) =>
  assert.ok(a.every((x, i) => Math.abs(x - b[i]) < tol), `${a.map((x) => x.toFixed(4))} != ${b.map((x) => x.toFixed(4))}`);

test('recovers camera direction and image axes for poses all around the sphere', () => {
  for (const yaw of [0, 45, 135, 181, 300, 359])
    for (const pitch of [-90, -60, -45, -10, 0.5, 10, 45, 60, 85, 90])
      for (const roll of [0.3, 4, -7, 25]) {
        const p = pose(yaw, pitch, roll);
        const want = axes(yaw, pitch, roll);
        const got = axes(p.yaw, p.pitch, p.roll);
        close(got.f, want.f);
        close(got.r, want.r);
      }
});

test('looking up is reachable (Expo beta alone is clamped to ±90°)', () => {
  for (const pitch of [30, 45, 70, 90]) {
    const { alpha, beta, gamma } = androidRotation(10, pitch, 1);
    assert.ok(Math.abs(beta) <= Math.PI / 2 + 1e-9);
    assert.ok(Math.abs(poseFromRotation(alpha, beta, gamma).pitch - pitch) < 1e-6);
  }
});

test('upright portrait phone reads as horizon, zero roll', () => {
  const p = poseFromRotation(0, Math.PI / 2, 0);
  assert.ok(Math.abs(p.pitch) < 1e-9);
  assert.ok(Math.abs(p.roll) < 1e-9);
});

test('turning right increases yaw', () => {
  const a = pose(10, 1, 0.5);
  const b = pose(40, 1, 0.5);
  assert.ok(Math.abs(wrap360(b.yaw - a.yaw) - 30) < 1e-6);
});

test('heading stays accurate near upright at Android float32 precision', () => {
  for (const [pitch, roll] of [[0.2, 0.1], [0.05, 0.3], [-0.3, -0.05], [1, 0]]) {
    for (const yaw of [0, 77, 200]) {
      const p = pose(yaw, pitch, roll, true);
      const err = Math.min(wrap360(p.yaw - yaw), 360 - wrap360(p.yaw - yaw));
      assert.ok(err < 0.1, `yaw ${yaw} pitch ${pitch} roll ${roll}: error ${err.toFixed(3)}°`);
      assert.ok(Math.abs(p.pitch - pitch) < 0.05);
    }
  }
});

test('wrap360', () => {
  assert.equal(wrap360(-10), 350);
  assert.equal(wrap360(370), 10);
  assert.equal(wrap360(0), 0);
});
