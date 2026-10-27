/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reduce, releasedFiles, type State } from '../src/appState.ts';

const shots = Array.from({ length: 24 }, (_, i) => ({ id: `t${i}`, yaw: i, pitch: 0, roll: 0, uri: `file:///cache/s${i}.jpg` }));

test('a failed upload keeps the photos so it can be retried', () => {
  const processing = reduce({ name: 'capture' }, { type: 'upload', shots });
  const failed = reduce(processing, { type: 'failed', message: "Can't reach the server" });
  assert.equal(failed.name, 'error');
  assert.equal(failed.name === 'error' && failed.shots, shots);
  const retry = reduce(failed, { type: 'upload', shots: (failed as Extract<State, { name: 'error' }>).shots! });
  assert.deepEqual(retry, { name: 'processing', shots, progress: 0 });
  assert.deepEqual(releasedFiles(processing, failed), []);
  assert.deepEqual(releasedFiles(failed, retry), []);
});

test('cancel keeps the photos too', () => {
  const processing = reduce({ name: 'capture' }, { type: 'upload', shots });
  const cancelled = reduce(processing, { type: 'cancel' });
  assert.equal(cancelled.name === 'error' && cancelled.shots, shots);
});

test('a reply that arrives after cancel is ignored', () => {
  const cancelled = reduce(reduce({ name: 'capture' }, { type: 'upload', shots }), { type: 'cancel' });
  assert.equal(reduce(cancelled, { type: 'stitched', uri: 'file:///p.jpg' }), cancelled);
  assert.equal(reduce(cancelled, { type: 'failed', message: 'late' }), cancelled);
  assert.equal(reduce({ name: 'home' }, { type: 'progress', fraction: 0.5 }).name, 'home');
});

test('progress updates only the upload in flight', () => {
  const p = reduce(reduce({ name: 'capture' }, { type: 'upload', shots }), { type: 'progress', fraction: 0.4 });
  assert.equal(p.name === 'processing' && p.progress, 0.4);
});

test('photos are released once stitched or abandoned, and the panorama once you leave the viewer', () => {
  const processing = reduce({ name: 'capture' }, { type: 'upload', shots });
  const viewer = reduce(processing, { type: 'stitched', uri: 'file:///cache/pano.jpg' });
  assert.deepEqual(releasedFiles(processing, viewer), shots.map((s) => s.uri));
  assert.deepEqual(releasedFiles(viewer, reduce(viewer, { type: 'home' })), ['file:///cache/pano.jpg']);
  const failed = reduce(processing, { type: 'failed', message: 'x' });
  assert.deepEqual(releasedFiles(failed, reduce(failed, { type: 'capture' })), shots.map((s) => s.uri));
});
