import { useEffect, useRef, useState } from 'react';
import { DeviceMotion } from 'expo-sensors';
import { Axes, Pose, axesFromPose, poseFromRotation, smoothAxes, wrap360 } from './orientation';

const REFERENCE_MAX_PITCH = 30;
const UPDATE_MS = 16;
const SMOOTHING = 0.45; // per sample at ~60 Hz: removes jitter with ~2 frames of lag

export type MotionSample = {
  /** Unsmoothed pose, yaw relative to the reference heading. Recorded with each photo. */
  pose: Pose;
  /** Smoothed camera axes for drawing and aiming. */
  axes: Axes;
};

/**
 * Streams the camera pose to `onSample` on every sensor reading, without React re-renders.
 * Nothing is emitted until the phone has been held near the horizon once: heading is
 * ill-defined while it points at the floor or ceiling, so that first level heading becomes yaw 0.
 */
export function useMotion(onSample: (s: MotionSample) => void) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [referenced, setReferenced] = useState(false);
  const callback = useRef(onSample);
  callback.current = onSample;

  useEffect(() => {
    let yaw0: number | null = null;
    let smoothed: Axes | null = null;
    let sub: { remove(): void } | null = null;
    let cancelled = false;

    DeviceMotion.isAvailableAsync().then((ok) => {
      if (cancelled) return;
      setAvailable(ok);
      if (!ok) return;
      DeviceMotion.setUpdateInterval(UPDATE_MS);
      sub = DeviceMotion.addListener(({ rotation }) => {
        if (!rotation) return;
        const raw = poseFromRotation(rotation.alpha, rotation.beta, rotation.gamma);
        if (yaw0 === null) {
          if (Math.abs(raw.pitch) > REFERENCE_MAX_PITCH) return;
          yaw0 = raw.yaw;
          setReferenced(true);
        }
        const pose = { ...raw, yaw: wrap360(raw.yaw - yaw0) };
        smoothed = smoothAxes(smoothed, axesFromPose(pose), SMOOTHING);
        callback.current({ pose, axes: smoothed });
      });
    });

    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);

  return { available, referenced };
}
