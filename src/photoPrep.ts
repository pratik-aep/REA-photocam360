import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { deleteFiles } from './files.ts';

// Comfortably above what a 4096-wide panorama needs (~650 px per radian), at ~1/30 of a 12MP upload.
const MAX_SIDE = 1600;

/**
 * Shrinks a captured photo for upload. Runs while the user aims at the next target.
 * The output has no EXIF, so the pixels must already be upright: if decoding didn't apply the
 * EXIF rotation (portrait capture comes out landscape), rotate using the EXIF tag ourselves.
 * The full-size original is deleted once the small copy is saved. On any failure the original
 * is kept and uploaded instead; the server handles full-size EXIF photos too.
 */
export async function preparePhoto(uri: string, exifOrientation?: number): Promise<string> {
  try {
    let image = await ImageManipulator.manipulate(uri, { maxWidth: MAX_SIDE, maxHeight: MAX_SIDE }).renderAsync();
    if (image.width > image.height) {
      const degrees = exifOrientation === 8 ? -90 : 90;
      image = await ImageManipulator.manipulate(image).rotate(degrees).renderAsync();
    }
    const saved = await image.saveAsync({ compress: 0.88, format: SaveFormat.JPEG });
    if (saved.uri !== uri) deleteFiles([uri]);
    return saved.uri;
  } catch (e) {
    console.warn('preparePhoto failed, uploading original', e);
    return uri;
  }
}
