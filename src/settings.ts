import { File, Paths } from 'expo-file-system';
import { normalizeServerUrl } from './serverUrl';

export const DEFAULT_SERVER_URL = normalizeServerUrl(process.env.EXPO_PUBLIC_STITCH_URL ?? '') ?? 'http://192.168.1.10:8080';

const settingsFile = () => new File(Paths.document, 'settings.json');

export async function loadServerUrl(): Promise<string> {
  try {
    const file = settingsFile();
    if (!file.exists) return DEFAULT_SERVER_URL;
    const saved = JSON.parse(await file.text())?.serverUrl;
    return (typeof saved === 'string' && normalizeServerUrl(saved)) || DEFAULT_SERVER_URL;
  } catch {
    return DEFAULT_SERVER_URL;
  }
}

export async function saveServerUrl(url: string) {
  const file = settingsFile();
  if (!file.exists) file.create();
  await file.write(JSON.stringify({ serverUrl: url }));
}
