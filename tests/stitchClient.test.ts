/// <reference types="node" />
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const downloads: string[] = [];
mock.module('expo-file-system', {
  exports: {
    Paths: { cache: 'file:///cache' },
    File: class {
      uri: string;
      constructor(dir: string, name: string) {
        this.uri = `${dir}/${name}`;
      }
      static async downloadFileAsync(url: string) {
        downloads.push(url);
      }
    },
  },
});

class FakeFormData {
  parts: [string, unknown][] = [];
  append(k: string, v: unknown) {
    this.parts.push([k, v]);
  }
}
type Reply = { status: number; text: string } | 'network-error';
let reply: Reply;
class FakeXHR {
  status = 0;
  responseText = '';
  timeout = 0;
  upload: { onprogress?: (e: object) => void; onload?: () => void } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  open() {}
  abort() {
    this.onabort?.();
  }
  send() {
    queueMicrotask(() => {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
      this.upload.onload?.();
      if (reply === 'network-error') return this.onerror?.();
      this.status = reply.status;
      this.responseText = reply.text;
      this.onload?.();
    });
  }
}

const { stitch } = await import('../src/stitchClient.ts');
const shots = [
  { id: 'a', yaw: 10, pitch: 0, roll: 1, uri: 'file:///cache/a.jpg', f35: 24 },
  { id: 'b', yaw: 55, pitch: 42, roll: -2, uri: 'file:///cache/b.jpg' },
];

beforeEach(() => {
  Object.assign(globalThis, { XMLHttpRequest: FakeXHR, FormData: FakeFormData });
  downloads.length = 0;
});

test('uploads photos with their poses, reports progress, and downloads the result', async () => {
  reply = { status: 200, text: '{"id":"x","url":"/panoramas/x.jpg"}' };
  const progress: number[] = [];
  const uri = await stitch('http://10.0.0.2:8080', shots, { onProgress: (f) => progress.push(f) });
  assert.match(uri, /^file:\/\/\/cache\/pano_\d+\.jpg$/);
  assert.deepEqual(downloads, ['http://10.0.0.2:8080/panoramas/x.jpg']);
  assert.deepEqual(progress, [0.5, 1]);
});

test('sends f35 only for shots that have it', async () => {
  reply = { status: 200, text: '{"url":"/panoramas/y.jpg"}' };
  let sent: FakeFormData | undefined;
  const send = FakeXHR.prototype.send;
  FakeXHR.prototype.send = function (this: FakeXHR, body?: unknown) {
    sent = body as FakeFormData;
    return send.call(this);
  };
  await stitch('http://h:8080', shots);
  FakeXHR.prototype.send = send;
  const meta = JSON.parse(sent!.parts.find(([k]) => k === 'meta')![1] as string);
  assert.deepEqual(meta, [
    { yaw: 10, pitch: 0, roll: 1, f35: 24 },
    { yaw: 55, pitch: 42, roll: -2 },
  ]);
  assert.equal(sent!.parts.filter(([k]) => k === 'photos').length, 2);
});

test('server errors surface the server message', async () => {
  reply = { status: 400, text: 'meta.pitch must be within [-90, 90]' };
  await assert.rejects(stitch('http://h:8080', shots), /Stitching failed \(400\): meta\.pitch/);
});

test('an unexpected reply gives a readable error instead of crashing', async () => {
  for (const text of ['<html>proxy error</html>', '{}', '{"url": 5}']) {
    reply = { status: 200, text };
    await assert.rejects(stitch('http://h:8080', shots), /reply this app doesn't understand/);
  }
  assert.deepEqual(downloads, []);
});

test('network failure rejects with a readable message', async () => {
  reply = 'network-error';
  await assert.rejects(stitch('http://h:8080', shots), /Can't reach http:\/\/h:8080\/stitch/);
});
