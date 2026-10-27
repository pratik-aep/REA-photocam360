/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeServerUrl, resolveServerPath } from '../src/serverUrl.ts';

test('normalizes common inputs', () => {
  assert.equal(normalizeServerUrl('192.168.1.5:8080'), 'http://192.168.1.5:8080');
  assert.equal(normalizeServerUrl('  http://192.168.1.5:8080/ '), 'http://192.168.1.5:8080');
  assert.equal(normalizeServerUrl('HTTPS://stitch.example.com/api//'), 'https://stitch.example.com/api');
  assert.equal(normalizeServerUrl('my-mac.local:8080'), 'http://my-mac.local:8080');
  assert.equal(normalizeServerUrl('[::1]:8080'), 'http://[::1]:8080');
});

test('rejects unusable inputs', () => {
  for (const bad of ['', '   ', 'ftp://host', 'http://', 'http://host:99999', 'http://host:0', 'http://ho st', 'http://host/?q=1', 'javascript:alert(1)'])
    assert.equal(normalizeServerUrl(bad), null, bad);
});

test('resolves server-relative paths', () => {
  assert.equal(resolveServerPath('http://h:8080', '/panoramas/a.jpg'), 'http://h:8080/panoramas/a.jpg');
  assert.equal(resolveServerPath('http://h:8080/api', 'panoramas/a.jpg'), 'http://h:8080/api/panoramas/a.jpg');
  assert.equal(resolveServerPath('http://h:8080', 'https://cdn/x.jpg'), 'https://cdn/x.jpg');
});

test('a bare host with no scheme or port gets the stitching server default port', () => {
  assert.equal(normalizeServerUrl('192.168.1.5'), 'http://192.168.1.5:8080');
  assert.equal(normalizeServerUrl('my-mac.local'), 'http://my-mac.local:8080');
  // An explicit scheme means the user chose the port (e.g. a reverse proxy on 80/443).
  assert.equal(normalizeServerUrl('http://192.168.1.5'), 'http://192.168.1.5');
  assert.equal(normalizeServerUrl('https://stitch.example.com'), 'https://stitch.example.com');
});

test('the address typed in the box is used even if Save wasn\'t tapped', async () => {
  const { serverForCapture } = await import('../src/serverUrl.ts');
  assert.equal(serverForCapture('10.0.0.7:8080', 'http://192.168.1.10:8080'), 'http://10.0.0.7:8080');
  assert.equal(serverForCapture('not a url', 'http://192.168.1.10:8080'), 'http://192.168.1.10:8080');
});
