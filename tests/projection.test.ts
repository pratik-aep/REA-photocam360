/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { axesFromPose, direction } from '../src/orientation.ts';
import { DEFAULT_F35, edgeArrow, focalForBox, previewBox, project } from '../src/projection.ts';

const box = { width: 400, height: 400 / 0.75 };
const focal = focalForBox(box, DEFAULT_F35);
const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const tan = (deg: number) => Math.tan((deg * Math.PI) / 180);

test('preview box is the largest centred 3:4 rectangle', () => {
  const tall = previewBox(400, 900);
  near(tall.width, 400);
  near(tall.height, 400 / 0.75);
  near(tall.top, (900 - 400 / 0.75) / 2);
  near(tall.left, 0);
  const wide = previewBox(600, 700);
  near(wide.height, 700);
  near(wide.width, 525);
  near(wide.left, 37.5);
});

test('focal length matches a 26mm-equivalent field of view', () => {
  // Long side of a 4:3 frame is 0.8 of the diagonal: 0.8 * 43.27mm ≈ 34.6mm.
  const vfov = 2 * Math.atan(box.height / 2 / focal);
  near(vfov, 2 * Math.atan((0.8 * Math.hypot(36, 24)) / 2 / 26));
});

test('target straight ahead is centred', () => {
  const p = project(direction(30, 10), axesFromPose({ yaw: 30, pitch: 10, roll: 0 }), focal, box);
  near(p.x, box.width / 2);
  near(p.y, box.height / 2);
  assert.ok(p.inFront && p.onScreen);
});

test('dots move with the scene at the true angular scale', () => {
  const ax = axesFromPose({ yaw: 0, pitch: 0, roll: 0 });
  near(project(direction(10, 0), ax, focal, box).x, box.width / 2 + focal * tan(10));
  near(project(direction(0, 10), ax, focal, box).y, box.height / 2 - focal * tan(10));
  // Turning right by 4° brings a target 10° right to 6° right of centre.
  near(project(direction(10, 0), axesFromPose({ yaw: 4, pitch: 0, roll: 0 }), focal, box).x, box.width / 2 + focal * tan(6));
});

test('roll rotates dots about the centre', () => {
  const p = project(direction(10, 0), axesFromPose({ yaw: 0, pitch: 0, roll: 20 }), focal, box);
  const dx = p.x - box.width / 2, dy = p.y - box.height / 2;
  // Right edge of the phone tilted up: a point on the horizon to the right appears lower, rotated by 20°.
  near(Math.atan2(dy, dx), (20 * Math.PI) / 180, 1e-3);
});

test('looking up at the zenith works regardless of heading', () => {
  for (const yaw of [0, 90, 233]) {
    const p = project(direction(0, 90), axesFromPose({ yaw, pitch: 85, roll: 0 }), focal, box);
    assert.ok(p.onScreen);
    near(p.x, box.width / 2, 1e-6);
    assert.ok(p.y < box.height / 2);
  }
});

test('targets behind are not drawn, and the arrow points the short way round', () => {
  const ax = axesFromPose({ yaw: 0, pitch: 0, roll: 0 });
  assert.equal(project(direction(170, 0), ax, focal, box).inFront, false);
  const right = edgeArrow(direction(120, 0), ax, box, 24);
  near(right.angle, 0, 1e-6);
  near(right.x, box.width - 24);
  const left = edgeArrow(direction(250, 0), ax, box, 24);
  near(Math.abs(left.angle), 180, 1e-6);
  const up = edgeArrow(direction(0, 80), axesFromPose({ yaw: 0, pitch: -40, roll: 0 }), box, 24);
  near(up.angle, -90, 1e-6);
  near(up.y, 24);
});

test('off-screen targets in front are flagged', () => {
  const p = project(direction(60, 0), axesFromPose({ yaw: 0, pitch: 0, roll: 0 }), focal, box);
  assert.ok(p.inFront && !p.onScreen);
});
