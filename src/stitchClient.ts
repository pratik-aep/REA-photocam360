import { File, Paths } from 'expo-file-system';
import type { Shot } from './CaptureScreen';
import { resolveServerPath } from './serverUrl.ts';
import { postForm } from './upload.ts';

const STITCH_TIMEOUT_MS = 180_000;
const HEALTH_TIMEOUT_MS = 5_000;

export async function checkServer(serverUrl: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(`${serverUrl}/health`, { signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export type StitchOptions = { signal?: AbortSignal; onProgress?: (fraction: number) => void };

/** Uploads the shots, then downloads the stitched panorama natively into the cache. Returns its file URI. */
export async function stitch(serverUrl: string, shots: Shot[], { signal, onProgress }: StitchOptions = {}): Promise<string> {
  const form = new FormData();
  shots.forEach((s, i) => {
    form.append('photos', { uri: s.uri, name: `img_${i}.jpg`, type: 'image/jpeg' } as unknown as Blob);
  });
  form.append('meta', JSON.stringify(shots.map(({ yaw, pitch, roll, f35 }) => ({ yaw, pitch, roll, ...(f35 ? { f35 } : {}) }))));

  const res = await postForm(`${serverUrl}/stitch`, form, { timeoutMs: STITCH_TIMEOUT_MS, signal, onProgress });
  if (res.status !== 200) throw new Error(`Stitching failed (${res.status}): ${res.text.slice(0, 200)}`);
  let url: unknown;
  try {
    url = JSON.parse(res.text)?.url;
  } catch {
    url = undefined;
  }
  if (typeof url !== 'string') throw new Error("The stitching server sent a reply this app doesn't understand.");
  if (signal?.aborted) throw new Error('Cancelled');

  const out = new File(Paths.cache, `pano_${Date.now()}.jpg`);
  await File.downloadFileAsync(resolveServerPath(serverUrl, url), out);
  return out.uri;
}
