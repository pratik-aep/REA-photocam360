import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { CAPTURE_PLAN, isPolar, onTarget, yawDelta } from './capturePlan';
import { useOrientation } from './useOrientation';

const HOLD_MS = 700;
const PX_PER_DEG = 6;
const EDGE = 40;

export type Shot = { id: string; yaw: number; pitch: number; roll: number; uri: string };

function guidance(dYaw: number, dPitch: number, hit: boolean) {
  if (hit) return 'Hold still…';
  if (Math.abs(dYaw) > 25) return dYaw > 0 ? 'Turn right ›' : '‹ Turn left';
  if (Math.abs(dPitch) > 15) return dPitch > 0 ? 'Tilt up ˄' : 'Tilt down ˅';
  return 'Move the ring over the dot';
}

export default function CaptureScreen({ onDone }: { onDone: (shots: Shot[]) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const { pose, latest, available } = useOrientation();
  const { width, height } = useWindowDimensions();
  const [ready, setReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [busy, setBusy] = useState(false);
  const aim = useRef({ targetId: '', on: false });

  const target = CAPTURE_PLAN[shots.length];
  if (target && aim.current.targetId !== target.id) aim.current = { targetId: target.id, on: false };
  const hit = !!target && onTarget(target, pose.yaw, pose.pitch, aim.current.on);
  aim.current.on = hit;

  useEffect(() => {
    if (!target || busy || !ready || !hit) return;
    const timer = setTimeout(async () => {
      setBusy(true);
      const at = latest.current;
      try {
        const photo = await camera.current?.takePictureAsync({ quality: 0.9, skipProcessing: true });
        if (photo) setShots((s) => [...s, { id: target.id, yaw: at.yaw, pitch: at.pitch, roll: at.roll, uri: photo.uri }]);
      } catch (e) {
        console.warn('takePictureAsync failed', e);
      } finally {
        setBusy(false);
      }
    }, HOLD_MS);
    return () => clearTimeout(timer);
  }, [hit, target, busy, ready, latest]);

  useEffect(() => {
    if (shots.length === CAPTURE_PLAN.length) onDone(shots);
  }, [shots, onDone]);

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

  const dYaw = target && !isPolar(target) ? yawDelta(target.yaw, pose.yaw) : 0;
  const dPitch = target ? target.pitch - pose.pitch : 0;
  const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));
  const dx = clamp(dYaw * PX_PER_DEG, width / 2 - EDGE);
  const dy = clamp(-dPitch * PX_PER_DEG, height / 2 - EDGE);

  return (
    <View style={styles.fill}>
      <CameraView
        ref={camera}
        style={styles.fill}
        facing="back"
        onCameraReady={() => setReady(true)}
        onMountError={(e) => setCameraError(e.message)}
      />
      <View style={styles.overlay} pointerEvents="none">
        <View style={[styles.dot, hit && styles.dotHit, { transform: [{ translateX: dx }, { translateY: dy }] }]} />
        <View style={styles.ring} />
        <Text style={styles.hud}>
          {shots.length}/{CAPTURE_PLAN.length}
          {target ? ` · ${target.row}` : ''}
        </Text>
        <Text style={styles.hint}>{ready ? guidance(dYaw, dPitch, hit) : 'Starting camera…'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 64, height: 64, borderRadius: 32, borderWidth: 3, borderColor: '#fff' },
  dot: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#ffb020' },
  dotHit: { backgroundColor: '#2ecc71' },
  hud: { position: 'absolute', top: 64, color: '#fff', fontSize: 18, fontWeight: '600' },
  hint: { position: 'absolute', bottom: 80, color: '#fff', fontSize: 16 },
  text: { color: '#fff', fontSize: 16, textAlign: 'center' },
  btn: { backgroundColor: '#2f6bff', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 },
  btnText: { color: '#fff', fontWeight: '600' },
});
