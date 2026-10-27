/// <reference types="node" />
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { postForm } from '../src/upload.ts';

/** Minimal stand-in for React Native's XMLHttpRequest; tests drive it by calling its handlers. */
class FakeXHR {
  static last: FakeXHR;
  method = '';
  url = '';
  timeout = 0;
  status = 0;
  responseText = '';
  sent: unknown;
  aborted = false;
  upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void; onload?: () => void } = {};
  onload?: () => void;
  onerror?: () => void;
  ontimeout?: () => void;
  onabort?: () => void;
  constructor() {
    FakeXHR.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  send(body: unknown) {
    this.sent = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
}

beforeEach(() => {
  (globalThis as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXHR;
});

const form = {} as FormData;

test('reports upload progress and resolves with the response', async () => {
  const seen: number[] = [];
  const p = postForm('http://h:8080/stitch', form, { timeoutMs: 1000, onProgress: (f) => seen.push(f) });
  const x = FakeXHR.last;
  assert.equal(x.method, 'POST');
  assert.equal(x.timeout, 1000);
  assert.equal(x.sent, form);
  x.upload.onprogress!({ lengthComputable: true, loaded: 25, total: 100 });
  x.upload.onprogress!({ lengthComputable: false, loaded: 50, total: 0 });
  x.upload.onload!();
  x.status = 200;
  x.responseText = '{"url":"/panoramas/a.jpg"}';
  x.onload!();
  assert.deepEqual(await p, { status: 200, text: '{"url":"/panoramas/a.jpg"}' });
  assert.deepEqual(seen, [0.25, 1]);
});

test('HTTP errors resolve with the status so the caller can show the server message', async () => {
  const p = postForm('http://h/stitch', form, { timeoutMs: 1000 });
  Object.assign(FakeXHR.last, { status: 400, responseText: 'meta must be JSON' });
  FakeXHR.last.onload!();
  assert.deepEqual(await p, { status: 400, text: 'meta must be JSON' });
});

test('network drop mid-upload rejects with a readable message', async () => {
  const p = postForm('http://h/stitch', form, { timeoutMs: 1000 });
  FakeXHR.last.onerror!();
  await assert.rejects(p, /Can't reach http:\/\/h\/stitch/);
});

test('timeout rejects with a readable message', async () => {
  const p = postForm('http://h/stitch', form, { timeoutMs: 180000 });
  FakeXHR.last.ontimeout!();
  await assert.rejects(p, /No response from http:\/\/h\/stitch after 180s/);
});

test('cancel aborts the request', async () => {
  const ctrl = new AbortController();
  const p = postForm('http://h/stitch', form, { timeoutMs: 1000, signal: ctrl.signal });
  ctrl.abort();
  assert.equal(FakeXHR.last.aborted, true);
  await assert.rejects(p, /Cancelled/);
});

test('an already-cancelled signal never starts a request', async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  const before = FakeXHR.last;
  await assert.rejects(postForm('http://h/stitch', form, { timeoutMs: 1000, signal: ctrl.signal }), /Cancelled/);
  assert.equal(FakeXHR.last, before);
});
