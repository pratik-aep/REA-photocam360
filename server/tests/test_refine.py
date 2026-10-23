import math

import numpy as np
import pytest

from refine import pose_from_rotation, refine, rotation
from stitcher import Shot, decode, stitch
from test_stitcher import F35, capture_plan, make_panorama, psnr, render_shot, to_jpeg


@pytest.fixture(scope="module")
def room():
    return make_panorama(2048, textured=True)


def noisy_shots(pano, sensor_error_deg, seed=3):
    """Shots rendered at their true pose but labelled with a sensor-like noisy pose."""
    rng = np.random.default_rng(seed)
    shots, truth = [], []
    for t in capture_plan():
        y, p, r = t["yaw"] + rng.uniform(-2, 2), float(np.clip(t["pitch"] + rng.uniform(-2, 2), -90, 90)), rng.uniform(-3, 3)
        img, f = decode(to_jpeg(render_shot(pano, y, p, r), f35=F35))
        noise = rng.normal(0, sensor_error_deg, 3)
        shots.append(Shot(img, f, y + noise[0], float(np.clip(p + noise[1], -90, 90)), r + noise[2]))
        truth.append(Shot(img, f, y, p, r))
    return shots, truth


def max_angle_error_deg(a: Shot, b: Shot) -> float:
    d = rotation(a).T @ rotation(b)
    return math.degrees(math.acos(max(-1.0, min(1.0, (np.trace(d) - 1) / 2))))


def test_pose_round_trip():
    for yaw, pitch, roll in [(0, 0, 0), (123, 40, -7), (300, -85, 12), (10, 90, 3), (200, -90, -4)]:
        s = Shot(np.zeros((4, 3, 3), np.uint8), 1.0, yaw, pitch, roll)
        back = Shot(s.image, 1.0, *pose_from_rotation(rotation(s)))
        assert max_angle_error_deg(s, back) < 1e-4


def relative_errors_deg(est, truth):
    """Error in the rotation between every pair of shots; this is what shows up as seams."""
    out = []
    for i in range(len(est)):
        for j in range(i + 1, len(est)):
            e = (rotation(est[i]).T @ rotation(est[j])).T @ (rotation(truth[i]).T @ rotation(truth[j]))
            out.append(math.degrees(math.acos(max(-1.0, min(1.0, (np.trace(e) - 1) / 2)))))
    return np.array(out)


def remove_global_rotation(est, truth):
    """The world's overall orientation is only known up to the sensors' mean error; factor it out."""
    M = sum(rotation(t) @ rotation(e).T for e, t in zip(est, truth))
    U, _, Vt = np.linalg.svd(M)
    G = U @ np.diag([1, 1, np.linalg.det(U @ Vt)]) @ Vt
    return [Shot(e.image, e.focal, *pose_from_rotation(G @ rotation(e))) for e in est]


@pytest.mark.parametrize("sensor_error", [1.0, 2.5, 4.0, 6.0])
def test_refinement_fixes_sensor_error(room, sensor_error):
    shots, truth = noisy_shots(room, sensor_error)
    refined = refine(shots)

    rel = relative_errors_deg(refined, truth)
    assert rel.mean() < 0.1 and rel.max() < 0.3, f"relative error mean {rel.mean():.3f} max {rel.max():.3f}°"

    exact = psnr(stitch(truth, 2048), room)
    before = psnr(stitch(remove_global_rotation(shots, truth), 2048), room)
    after = psnr(stitch(remove_global_rotation(refined, truth), 2048), room)
    assert after > exact - 1.0, f"PSNR {before:.1f} -> {after:.1f} dB (exact poses {exact:.1f} dB)"

    # Overall orientation stays anchored to the sensors: within their mean error.
    assert max(max_angle_error_deg(r, t) for r, t in zip(refined, truth)) < sensor_error


def test_refinement_does_not_hurt_exact_poses(room):
    shots, _ = noisy_shots(room, 0.0)
    assert psnr(stitch(refine(shots), 2048), room) > psnr(stitch(shots, 2048), room) - 1


def test_featureless_shots_keep_sensor_pose():
    blank = [Shot(np.full((1200, 900, 3), 128, np.uint8), 1500.0, y, 0, 0) for y in (0, 45, 90)]
    for a, b in zip(blank, refine(blank)):
        assert max_angle_error_deg(a, b) < 1e-9
