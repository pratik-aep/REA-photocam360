export type UploadOptions = {
  timeoutMs: number;
  signal?: AbortSignal;
  /** Fraction of the request body sent, 0..1. Reaches 1 when the upload is done and the server is working. */
  onProgress?: (fraction: number) => void;
};

export type UploadResponse = { status: number; text: string };

/**
 * POSTs a form with XMLHttpRequest rather than fetch, because React Native's fetch can't report
 * upload progress. Rejects with a user-readable message on timeout, cancel or network failure.
 */
export function postForm(url: string, body: FormData, { timeoutMs, signal, onProgress }: UploadOptions): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Cancelled'));
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    const settle = (fn: () => void) => {
      signal?.removeEventListener('abort', onAbort);
      fn();
    };

    xhr.open('POST', url);
    xhr.timeout = timeoutMs;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress?.(Math.min(1, e.loaded / e.total));
    };
    xhr.upload.onload = () => onProgress?.(1);
    xhr.onload = () => settle(() => resolve({ status: xhr.status, text: xhr.responseText ?? '' }));
    xhr.ontimeout = () => settle(() => reject(new Error(`No response from ${url} after ${timeoutMs / 1000}s`)));
    xhr.onabort = () => settle(() => reject(new Error('Cancelled')));
    xhr.onerror = () =>
      settle(() => reject(new Error(`Can't reach ${url}. Is the server running, and is this phone on the same Wi-Fi?`)));

    signal?.addEventListener('abort', onAbort);
    xhr.send(body);
  });
}
