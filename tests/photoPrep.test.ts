/// <reference types="node" />
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// Fakes for Expo's native modules. `next` describes what the next decode returns.
const calls = { rotate: [] as number[], deleted: [] as string[], loadOptions: [] as unknown[] };
let next: { width: number; height: number } | Error = { width: 1200, height: 1600 };

const image = (w: number, h: number) => ({ width: w, height: h, saveAsync: async () => ({ uri: 'file:///cache/small.jpg' }) });
mock.module('expo-image-manipulator', {
  exports: {
    SaveFormat: { JPEG: 'jpeg' },
    ImageManipulator: {
      manipulate: (source: unknown, options?: unknown) => {
        if (typeof source === 'string') calls.loadOptions.push(options);
        return {
          rotate(deg: number) {
            calls.rotate.push(deg);
            return { renderAsync: async () => image(1200, 1600) };
          },
          renderAsync: async () => {
            if (next instanceof Error) throw next;
            return image(next.width, next.height);
          },
        };
      },
    },
  },
});
mock.module('expo-file-system', {
  exports: {
    File: class {
      uri: string;
      constructor(uri: string) {
        this.uri = uri;
      }
      get exists() {
        return true;
      }
      delete() {
        calls.deleted.push(this.uri);
      }
    },
  },
});

const { preparePhoto } = await import('../src/photoPrep.ts');
const reset = (n: typeof next) => {
  next = n;
  calls.rotate = [];
  calls.deleted = [];
  calls.loadOptions = [];
};

test('shrinks while decoding and deletes the full-size original', async () => {
  reset({ width: 1200, height: 1600 });
  assert.equal(await preparePhoto('file:///cache/orig.jpg', 6), 'file:///cache/small.jpg');
  assert.deepEqual(calls.loadOptions, [{ maxWidth: 1600, maxHeight: 1600 }]);
  assert.deepEqual(calls.rotate, []);
  assert.deepEqual(calls.deleted, ['file:///cache/orig.jpg']);
});

test('rotates upright when the decoder ignored the EXIF rotation', async () => {
  reset({ width: 1600, height: 1200 });
  await preparePhoto('file:///cache/a.jpg', 6);
  reset({ width: 1600, height: 1200 });
  await preparePhoto('file:///cache/b.jpg', 6);
  assert.deepEqual(calls.rotate, [90]);
  reset({ width: 1600, height: 1200 });
  await preparePhoto('file:///cache/c.jpg', 8);
  assert.deepEqual(calls.rotate, [-90]);
});

test('on failure the original is kept and uploaded instead', async () => {
  reset(new Error('decode failed'));
  const warn = mock.method(console, 'warn', () => {});
  assert.equal(await preparePhoto('file:///cache/orig.jpg', 6), 'file:///cache/orig.jpg');
  assert.deepEqual(calls.deleted, []);
  warn.mock.restore();
});
