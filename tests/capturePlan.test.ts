/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAPTURE_PLAN, ENTER_TOL, EXIT_TOL, aimError, onTarget, yawDelta } from '../src/capturePlan.ts';

test('plan has unique ids and valid angles', () => {
  assert.equal(new Set(CAPTURE_PLAN.map((t) => t.id)).size, CAPTURE_PLAN.length);
  for (const t of CAPTURE_PLAN) {
    assert.ok(t.yaw >= 0 && t.yaw < 360);
    assert.ok(t.pitch >= -90 && t.pitch <= 90);
  }
});

test('yawDelta takes the short way round and signs it', () => {
  assert.equal(yawDelta(10, 350), 20);
  assert.equal(yawDelta(350, 10), -20);
  assert.equal(yawDelta(180, 0), 180);
  assert.equal(yawDelta(0, 180), 180);
  assert.equal(yawDelta(90, 90), 0);
  assert.equal(yawDelta(-30, 30), -60);
});

test('aim error wraps across north', () => {
  const t = { id: 'a', row: 'middle', yaw: 0, pitch: 0 };
  assert.equal(aimError(t, 357, 1), 3);
  assert.equal(aimError(t, 3, -2), 3);
});

test('polar targets ignore yaw', () => {
  const zenith = CAPTURE_PLAN.find((t) => t.id === 'zenith')!;
  assert.equal(aimError(zenith, 123, 88), 2);
  assert.ok(onTarget(zenith, 250, 87, false));
});

test('hysteresis: enter at the tight tolerance, stay until the loose one', () => {
  const t = { id: 'a', row: 'middle', yaw: 90, pitch: 0 };
  const between = (ENTER_TOL + EXIT_TOL) / 2;
  assert.equal(onTarget(t, 90 + between, 0, false), false);
  assert.equal(onTarget(t, 90 + between, 0, true), true);
  assert.equal(onTarget(t, 90 + EXIT_TOL + 0.5, 0, true), false);
  assert.equal(onTarget(t, 90 + ENTER_TOL - 0.5, 0, false), true);
});
