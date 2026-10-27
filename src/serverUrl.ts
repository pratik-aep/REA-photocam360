/** Port the stitching server listens on by default (server/app.py). */
export const DEFAULT_SERVER_PORT = 8080;

/**
 * Normalizes user input like "192.168.1.5:8080/" to "http://192.168.1.5:8080"; null if unusable.
 * A bare host ("192.168.1.5") gets the stitching server's default port; with an explicit scheme
 * the user has chosen the port, so none is added.
 */
export function normalizeServerUrl(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  const typedScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s);
  if (!typedScheme) s = `http://${s}`;
  const m = /^(https?):\/\/([a-z0-9.-]+|\[[0-9a-f:]+\])(:\d{1,5})?(\/[^\s?#]*)?$/i.exec(s);
  if (!m) return null;
  const port = m[3] ? Number(m[3].slice(1)) : null;
  if (port !== null && (port < 1 || port > 65535)) return null;
  const portPart = m[3] ?? (typedScheme ? '' : `:${DEFAULT_SERVER_PORT}`);
  return `${m[1].toLowerCase()}://${m[2]}${portPart}${(m[4] ?? '').replace(/\/+$/, '')}`;
}

/** The address to stitch with: what's in the box if it's valid, otherwise the last saved one. */
export const serverForCapture = (draft: string, saved: string) => normalizeServerUrl(draft) ?? saved;

/** Resolves a server-relative path (e.g. "/panoramas/x.jpg") against the server base URL. */
export const resolveServerPath = (base: string, path: string) =>
  /^https?:\/\//i.test(path) ? path : `${base}/${path.replace(/^\/+/, '')}`;
