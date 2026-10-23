import { useEffect, useRef, useState } from 'react';
import { DeviceMotion } from 'expo-sensors';
import { Pose, poseFromRotation, wrap360 } from './orientation';

const REFERENCE_MAX_PITCH = 30;

/**
 * Live camera pose. Yaw is relative to the heading at the first reading taken near the horizon
 * (heading is ill-defined while the phone points at the floor or ceiling).
 * `latest` always holds the newest pose without waiting for a re-render.
 */
export function useOrientation() {
  const [pose, setPose] = useState<Pose>({ yaw: 0, pitch: 0, roll: 0 });
  const [available, setAvailable] = useState<boolean | null>(null);
  const latest = useRef(pose);

  useEffect(() => {
    let yaw0: number | null = null;
    let sub: { remove(): void } | null = null;
    let cancelled = false;

    DeviceMotion.isAvailableAsync().then((ok) => {
      if (cancelled) return;
      setAvailable(ok);
      if (!ok) return;
      DeviceMotion.setUpdateInterval(50);
      sub = DeviceMotion.addListener(({ rotation }) => {
        if (!rotation) return;
        const raw = poseFromRotation(rotation.alpha, rotation.beta, rotation.gamma);
        if (yaw0 === null && Math.abs(raw.pitch) < REFERENCE_MAX_PITCH) yaw0 = raw.yaw;
        const next = { ...raw, yaw: wrap360(raw.yaw - (yaw0 ?? raw.yaw)) };
        latest.current = next;
        setPose(next);
      });
    });

    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);

  return { pose, latest, available };
}
