import { File } from 'expo-file-system';

/** Best-effort removal of temporary photos and panoramas from the app's cache. */
export function deleteFiles(uris: Iterable<string>) {
  for (const uri of uris) {
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch (e) {
      console.warn('could not delete', uri, e);
    }
  }
}
