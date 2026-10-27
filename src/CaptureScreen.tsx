import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Linking, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { CAPTURE_PLAN, aimedTarget, nearest } from './capturePlan';
import type { Pose } from './orientation';
import { preparePhoto } from './photoPrep';
import { DEFAULT_F35, edgeArrow, focalForBox, previewBox, project } from './projection';
import { MotionSample, useMotion } from './useMotion';

const HOLD_MS = 600;
const DOT = 30;
const ARROW = 40;
const RETICLE = 72;

export type Shot = { id: string; yaw: number; pitch: number; roll: number; uri: string; f35?: number };

type Exif = Record<string, unknown> | undefined;
const exifNumber = (exif: Exif, ...keys: string[]) => {
  for (const source of [exif, exif?.['{Exif}'] as Exif]) {
    for (const k of keys) {
      const v = Number(source?.[k]);
      if (Number.isFinite(v) && v > 0) return v;
    }
  }
  return undefined;
};

export default function CaptureScreen({ onDone }: { onDone: (shots: Shot[]) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const { width, height } = useWindowDimensions();
  const box = useMemo(() => previewBox(width, height), [width, height]);
  const boxRef = useRef(box);
  boxRef.current = box;

  const [ready, setReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [aimedId, setAimedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(0);

  // Per-frame state lives in refs and Animated values so sensor updates never re-render the screen.
  const f35 = useRef(DEFAULT_F35);
  const done = useRef(new Set<string>());
  const shots = useRef<Shot[]>([]);
  const prepared = useRef<Promise<string>[]>([]);
  const latestPose = useRef<Pose | null>(null);
  const aimedRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const dots = useRef(CAPTURE_PLAN.map(() => ({ xy: new Animated.ValueXY({ x: -DOT, y: -DOT }), opacity: new Animated.Value(0) }))).current;
  const arrow = useRef({ xy: new Animated.ValueXY(), angle: new Animated.Value(0), opacity: new Animated.Value(0) }).current;
  const progress = useRef(new Animated.Value(0)).current;

  const onSample = useCallback(
    ({ pose, axes }: MotionSample) => {
      latestPose.current = pose;
      const b = boxRef.current;
      const focal = focalForBox(b, f35.current);

      CAPTURE_PLAN.forEach((t, i) => {
        const p = done.current.has(t.id) ? null : project(t.dir, axes, focal, b, DOT);
        dots[i].opacity.setValue(p?.onScreen ? 1 : 0);
        if (p?.onScreen) dots[i].xy.setValue({ x: p.x - DOT / 2, y: p.y - DOT / 2 });
      });

      const remaining = CAPTURE_PLAN.filter((t) => !done.current.has(t.id));
      const next = nearest(remaining, axes.f);
      if (next && !project(next.dir, axes, focal, b).onScreen) {
        const a = edgeArrow(next.dir, axes, b, ARROW);
        arrow.xy.setValue({ x: a.x - ARROW / 2, y: a.y - ARROW / 2 });
        arrow.angle.setValue(a.angle);
        arrow.opacity.setValue(1);
      } else {
        arrow.opacity.setValue(0);
      }

      if (busyRef.current) return;
      const aimed = aimedTarget(remaining, axes.f, aimedRef.current)?.id ?? null;
      if (aimed !== aimedRef.current) {
        aimedRef.current = aimed;
        setAimedId(aimed);
      }
    },
    [dots, arrow],
  );
  const { available, referenced } = useMotion(onSample);

  const capture = useCallback(async (id: string) => {
    const pose = latestPose.current;
    if (busyRef.current || done.current.has(id) || !pose) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const photo = await camera.current?.takePictureAsync({ quality: 0.92, skipProcessing: true, exif: true });
      if (!photo) return;
      const exif = photo.exif as Exif;
      const lens = exifNumber(exif, 'FocalLengthIn35mmFilm', 'FocalLenIn35mmFilm');
      const shotF35 = lens && lens >= 10 && lens <= 200 ? lens : undefined;
      if (shotF35) f35.current = shotF35; // calibrates the dot scale to this phone's lens
      done.current.add(id);
      shots.current.push({ id, ...pose, uri: photo.uri, f35: shotF35 });
      prepared.current.push(preparePhoto(photo.uri, exifNumber(exif, 'Orientation')));
      setCount(done.current.size);
    } catch (e) {
      console.warn('takePictureAsync failed', e);
    } finally {
      busyRef.current = false;
      aimedRef.current = null;
      setAimedId(null);
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    progress.setValue(0);
    if (!aimedId || !ready || busy) return;
    const hold = Animated.timing(progress, { toValue: 1, duration: HOLD_MS, easing: Easing.linear, useNativeDriver: true });
    hold.start(({ finished }) => finished && capture(aimedId));
    return () => hold.stop();
  }, [aimedId, ready, busy, capture, progress]);

  useEffect(() => {
    if (count !== CAPTURE_PLAN.length) return;
    let cancelled = false;
    Promise.all(prepared.current).then((uris) => {
      if (!cancelled) onDone(shots.current.map((s, i) => ({ ...s, uri: uris[i] })));
    });
    return () => {
      cancelled = true;
    };
  }, [count, onDone]);

  if (!permission) return <View style={styles.fill} />;
  if (!permission.granted) {
    return (
      <View style={[styles.fill, styles.center]}>
        <Text style={styles.text}>Camera access is needed to capture.</Text>
        <Pressable style={styles.btn} onPress={permission.canAskAgain ? requestPermission : () => Linking.openSettings()}>
          <Text style={styles.btnText}>{permission.canAskAgain ? 'Allow camera' : 'Open settings'}</Text>
        </Pressable>
      </View>
    );
  }
  if (available === false || cameraError) {
    return (
      <View style={[styles.fill, styles.center]}>
        <Text style={styles.text}>{cameraError ?? 'This device has no motion sensor, which 360 capture needs.'}</Text>
      </View>
    );
  }

  const finishing = count === CAPTURE_PLAN.length;
  const hint = !ready
    ? 'Starting camera…'
    : finishing
      ? 'Preparing photos…'
      : !referenced
        ? 'Hold your phone upright, facing straight ahead'
        : busy
          ? 'Capturing…'
          : aimedId
            ? 'Hold still…'
            : 'Move the circle onto a dot';

  return (
    <View style={styles.fill}>
      <View style={[styles.box, { left: box.left, top: box.top, width: box.width, height: box.height }]}>
        <CameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing="back"
          ratio="4:3"
          onCameraReady={() => setReady(true)}
          onMountError={(e) => setCameraError(e.message)}
        />
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {CAPTURE_PLAN.map((t, i) => (
            <Animated.View
              key={t.id}
              style={[styles.dot, t.id === aimedId && styles.dotAimed, { opacity: dots[i].opacity, transform: dots[i].xy.getTranslateTransform() }]}
            />
          ))}
          <Animated.View
            style={[
              styles.arrow,
              {
                opacity: arrow.opacity,
                transform: [
                  ...arrow.xy.getTranslateTransform(),
                  { rotate: arrow.angle.interpolate({ inputRange: [-360, 360], outputRange: ['-360deg', '360deg'] }) },
                ],
              },
            ]}
          >
            <Text style={styles.arrowText}>➜</Text>
          </Animated.View>
          <View style={[styles.reticle, { left: box.width / 2 - RETICLE / 2, top: box.height / 2 - RETICLE / 2 }]}>
            <Animated.View style={[styles.fillRing, { transform: [{ scale: progress }] }]} />
          </View>
        </View>
      </View>
      <View style={styles.topBar} pointerEvents="none">
        <Text style={styles.count}>
          {count}/{CAPTURE_PLAN.length}
        </Text>
      </View>
      <View style={styles.bottomBar} pointerEvents="none">
        <Text style={styles.hint}>{hint}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  box: { position: 'absolute', overflow: 'hidden', backgroundColor: '#111' },
  dot: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: '#ffb020cc',
    borderWidth: 2,
    borderColor: '#fff',
  },
  dotAimed: { backgroundColor: '#2ecc71' },
  arrow: { position: 'absolute', left: 0, top: 0, width: ARROW, height: ARROW, alignItems: 'center', justifyContent: 'center' },
  arrowText: { color: '#ffb020', fontSize: 34, fontWeight: '700' },
  reticle: {
    position: 'absolute',
    width: RETICLE,
    height: RETICLE,
    borderRadius: RETICLE / 2,
    borderWidth: 3,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fillRing: { width: RETICLE - 12, height: RETICLE - 12, borderRadius: (RETICLE - 12) / 2, backgroundColor: '#2ecc7188' },
  topBar: { position: 'absolute', top: 48, left: 0, right: 0, alignItems: 'center' },
  count: { color: '#fff', fontSize: 18, fontWeight: '700', backgroundColor: '#0008', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  bottomBar: { position: 'absolute', bottom: 48, left: 0, right: 0, alignItems: 'center' },
  hint: { color: '#fff', fontSize: 16, backgroundColor: '#0008', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 12 },
  text: { color: '#fff', fontSize: 16, textAlign: 'center' },
  btn: { backgroundColor: '#2f6bff', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 },
  btnText: { color: '#fff', fontWeight: '600' },
});
