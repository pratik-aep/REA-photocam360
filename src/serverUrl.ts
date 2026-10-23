/** Normalizes user input like "192.168.1.5:8080/" to "http://192.168.1.5:8080"; null if unusable. */
export function normalizeServerUrl(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `http://${s}`;
  const m = /^(https?):\/\/([a-z0-9.-]+|\[[0-9a-f:]+\])(:\d{1,5})?(\/[^\s?#]*)?$/i.exec(s);
  if (!m) return null;
  const port = m[3] ? Number(m[3].slice(1)) : null;
  if (port !== null && (port < 1 || port > 65535)) return null;
  return `${m[1].toLowerCase()}://${m[2]}${m[3] ?? ''}${(m[4] ?? '').replace(/\/+$/, '')}`;
}

/** Resolves a server-relative path (e.g. "/panoramas/x.jpg") against the server base URL. */
export const resolveServerPath = (base: string, path: string) =>
  /^https?:\/\//i.test(path) ? path : `${base}/${path.replace(/^\/+/, '')}`;
