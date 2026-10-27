# Photo360

Capture 360° photo spheres on Android and iOS. The app guides you through 24 shots with
the phone's motion sensors. A small server stitches them into an equirectangular panorama,
which you then view in the app.

- `App.tsx`, `src/`: Expo / React Native app (TypeScript)
- `server/`: Python stitching server (Flask, OpenCV)
- `tests/`, `server/tests/`: unit and end-to-end tests

## How it works

1. **Capture** (`src/CaptureScreen.tsx`): all 24 targets are drawn as dots fixed in the scene,
   so they slide across the preview as you turn, like real objects. Put the centre circle on
   any dot, in any order, and hold for 0.6 s to take the shot. An arrow at the screen edge
   points to the nearest remaining dot. `src/projection.ts` maps world directions to preview
   pixels with the same pinhole model the server stitches with, and calibrates the lens from
   the first photo's EXIF. Sensor readings are smoothed, and drawing bypasses React so it
   stays at the sensor rate. The plan (`src/capturePlan.ts`) is 8 shots at the horizon,
   7 at +42°, 7 at −42°, plus straight up and straight down. That covers the whole sphere for
   portrait phones with lenses up to 30 mm-equivalent. Each photo is shrunk to 1600 px
   (`src/photoPrep.ts`) in the background while you aim at the next one, so uploads are small.
2. **Pose** (`src/orientation.ts`): the camera's yaw, pitch and roll come from the full
   rotation that Expo `DeviceMotion` reports. Its `beta` angle alone is clamped to ±90°, so it
   can't express looking up. Each shot is sent with the pose measured at the shutter.
3. **Stitch** (`server/`):
   - `refine.py` corrects sensor drift by matching SIFT features between overlapping shots.
     It uses per-pair RANSAC, then a joint least-squares fit anchored softly to the sensor poses.
   - `stitcher.py` projects each shot onto the panorama and feather-blends the seams. It honours
     the EXIF orientation and reads the focal length from the EXIF 35 mm-equivalent tag.
4. **View** (`src/viewerHtml.ts`): an offline WebGL shader viewer. Drag to look around,
   pinch to zoom.

## Run the stitching server

```bash
cd server
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python app.py          # listens on 0.0.0.0:8080
```

- `POST /stitch` takes multipart `photos` and `meta`, where `meta` is a JSON list of
  `{yaw, pitch, roll}` in degrees. It returns `{id, url}`.
  - `?width=` sets the output width (512–8192, default 4096).
  - `?refine=0` skips pose refinement.
- `GET /panoramas/<id>.jpg` downloads the result. The server keeps the newest 50.
- `GET /health` is a health check.

Set `PHOTO360_RESULTS_DIR` to choose where results are stored. The development server above
handles one request at a time. Run it behind a production WSGI server such as gunicorn
before exposing it beyond your LAN.

## Run the app

```bash
npm install
npx expo start                   # open in Expo Go, or:
npx expo run:android             # needs the Android SDK
```

On the home screen, enter your server's address (for example `192.168.1.10:8080`) and tap
**Save & test**. If you enter only an IP or host name, port 8080 is added. The phone and the
server must be on the same network. You can also set the default at build time with
`EXPO_PUBLIC_STITCH_URL`.

The app shows upload progress. If the upload or stitching fails, or you cancel, it keeps
the photos and offers **Retry upload**. Temporary photos and panoramas are deleted from the
app's cache once they're no longer needed.

### Build a release APK locally

```bash
npx expo prebuild -p android
cd android && ./gradlew assembleRelease
# -> android/app/build/outputs/apk/release/app-release.apk
```

This APK is signed with the debug key. Configure your own signing key before publishing.
Cleartext HTTP is enabled (`expo-build-properties`) so the app can reach a LAN server.

## Tests

```bash
npm test                         # app logic (Node 22.3+; Expo native modules are faked)
npm run typecheck
cd server && .venv/bin/python -m pytest -q
```

The app tests cover the orientation and projection math, the capture plan, server-address
handling, the screen-state logic (retry and file cleanup), the upload (progress, timeout,
cancel, network loss) and photo preparation.

The server tests render synthetic phone photos from a known panorama, then check several
things:

- stitching reconstructs it
- the capture plan leaves no holes
- refinement fixes up to 6° of sensor error
- the HTTP API rejects bad input with a plain-text 4xx, never an HTML 500
- the app's on-screen dots match the stitcher's geometry
- the WebGL viewer, rendered in headless Chrome, matches the expected view and recovers
  from a lost WebGL context (skipped if Chrome isn't installed)

## Status

The logic is covered by the tests above. The capture flow has not yet been tested on a
physical device, and iOS has not been built.
