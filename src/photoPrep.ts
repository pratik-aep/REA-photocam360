import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

// Comfortably above what a 4096-wide panorama needs (~650 px per radian), at ~1/30 of a 12MP upload.
const MAX_SIDE = 1600;

/**
 * Shrinks a captured photo for upload. Runs while the user aims at the next target.
 * The output has no EXIF, so the pixels must already be upright: if decoding didn't apply the
 * EXIF rotation (portrait capture comes out landscape), rotate using the EXIF tag ourselves.
 * Falls back to the original photo on any failure; the server handles full-size EXIF photos too.
 */
export async function preparePhoto(uri: string, exifOrientation?: number): Promise<string> {
  try {
    let image = await ImageManipulator.manipulate(uri, { maxWidth: MAX_SIDE, maxHeight: MAX_SIDE }).renderAsync();
    if (image.width > image.height) {
      const degrees = exifOrientation === 8 ? -90 : 90;
      image = await ImageManipulator.manipulate(image).rotate(degrees).renderAsync();
    }
    const saved = await image.saveAsync({ compress: 0.88, format: SaveFormat.JPEG });
    return saved.uri;
  } catch (e) {
    console.warn('preparePhoto failed, uploading original', e);
    return uri;
  }
}
