import { File, Paths } from 'expo-file-system';
import type { Shot } from './CaptureScreen';
import { resolveServerPath } from './serverUrl';

const STITCH_TIMEOUT_MS = 180_000;
const HEALTH_TIMEOUT_MS = 5_000;

async function fetchWithTimeout(url: string, init: RequestInit, ms: number, signal?: AbortSignal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (signal?.aborted) throw new Error('Cancelled');
    if (ctrl.signal.aborted) throw new Error(`No response from ${url} after ${ms / 1000}s`);
    throw new Error(`Can't reach ${url}. Is the server running and on the same Wi-Fi?`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function checkServer(serverUrl: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${serverUrl}/health`, {}, HEALTH_TIMEOUT_MS);
    return res.ok;
  } catch {
    return false;
  }
}

/** Uploads the shots, then downloads the stitched panorama natively into the cache. Returns its file URI. */
export async function stitch(serverUrl: string, shots: Shot[], signal?: AbortSignal): Promise<string> {
  const form = new FormData();
  shots.forEach((s, i) => {
    form.append('photos', { uri: s.uri, name: `img_${i}.jpg`, type: 'image/jpeg' } as unknown as Blob);
  });
  form.append('meta', JSON.stringify(shots.map(({ yaw, pitch, roll, f35 }) => ({ yaw, pitch, roll, ...(f35 ? { f35 } : {}) }))));

  const res = await fetchWithTimeout(`${serverUrl}/stitch`, { method: 'POST', body: form }, STITCH_TIMEOUT_MS, signal);
  if (!res.ok) throw new Error(`Stitching failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const { url } = (await res.json()) as { url: string };

  const out = new File(Paths.cache, `pano_${Date.now()}.jpg`);
  await File.downloadFileAsync(resolveServerPath(serverUrl, url), out);
  return out.uri;
}
