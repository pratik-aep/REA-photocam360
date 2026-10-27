/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAPTURE_PLAN, ENTER_DEG, EXIT_DEG, aimedTarget, angleTo, nearest } from '../src/capturePlan.ts';
import { direction } from '../src/orientation.ts';

const byId = (id: string) => CAPTURE_PLAN.find((t) => t.id === id)!;

test('plan has 24 unique targets with valid angles', () => {
  assert.equal(CAPTURE_PLAN.length, 24);
  assert.equal(new Set(CAPTURE_PLAN.map((t) => t.id)).size, CAPTURE_PLAN.length);
  for (const t of CAPTURE_PLAN) {
    assert.ok(t.yaw >= 0 && t.yaw < 360);
    assert.ok(t.pitch >= -90 && t.pitch <= 90);
    assert.ok(Math.abs(Math.hypot(...t.dir) - 1) < 1e-12);
  }
});

test('targets are far enough apart that aiming is unambiguous', () => {
  for (const a of CAPTURE_PLAN)
    for (const b of CAPTURE_PLAN) if (a !== b) assert.ok(angleTo(a, b.dir) > 2 * EXIT_DEG, `${a.id} vs ${b.id}`);
});

test('aim locks within ENTER_DEG and holds until EXIT_DEG', () => {
  const t = byId('middle-2'); // yaw 90
  const between = (ENTER_DEG + EXIT_DEG) / 2;
  assert.equal(aimedTarget(CAPTURE_PLAN, direction(90 + between, 0), null), null);
  assert.equal(aimedTarget(CAPTURE_PLAN, direction(90 + between, 0), t.id), t);
  assert.equal(aimedTarget(CAPTURE_PLAN, direction(90 + ENTER_DEG - 0.5, 0), null), t);
  assert.equal(aimedTarget(CAPTURE_PLAN, direction(90 + EXIT_DEG + 0.5, 0), t.id), null);
});

test('any remaining target can be captured, in any order', () => {
  const remaining = CAPTURE_PLAN.filter((t) => t.id !== 'middle-0');
  assert.equal(aimedTarget(remaining, direction(0, 0), null), null);
  assert.equal(aimedTarget(remaining, direction(0, 42), null), byId('up-0'));
  assert.equal(aimedTarget(remaining, direction(123, 89), null), byId('zenith'));
});

test('aim wraps across north', () => {
  assert.equal(aimedTarget(CAPTURE_PLAN, direction(358, 1), null), byId('middle-0'));
});

test('nearest finds the closest remaining target', () => {
  assert.equal(nearest(CAPTURE_PLAN, direction(100, 5)), byId('middle-2'));
  assert.equal(nearest([], direction(0, 0)), null);
});
