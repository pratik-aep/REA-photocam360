import io
import json
import math
import subprocess
from pathlib import Path

import cv2
import numpy as np
import pytest
from PIL import Image

from stitcher import Shot, camera_axes, decode, stitch

APP_ROOT = Path(__file__).resolve().parents[2]
PHONE_W, PHONE_H, F35 = 900, 1200, 26.0  # portrait 3:4, scaled-down phone frame


def capture_plan():
    js = "import('./src/capturePlan.ts').then(m => console.log(JSON.stringify(m.CAPTURE_PLAN)))"
    out = subprocess.run(["node", "-e", js], cwd=APP_ROOT, capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def make_panorama(width=2048, textured=False):
    h = width // 2
    if textured:
        # Random shapes give feature matching something to lock onto, like a real room.
        rng = np.random.default_rng(42)
        pano = make_panorama(width)
        for _ in range(2500):
            color = tuple(int(c) for c in rng.integers(0, 256, 3))
            x, y, s = int(rng.integers(0, width)), int(rng.integers(0, h)), int(rng.integers(3, width // 80))
            if rng.random() < 0.5:
                cv2.rectangle(pano, (x, y), (x + s, y + s // 2 + 1), color, -1)
            else:
                cv2.circle(pano, (x, y), s // 2 + 1, color, -1)
        return pano
    yy, xx = np.mgrid[0:h, 0:width].astype(np.float32)
    lon = (xx + 0.5) / width * 2 * np.pi
    lat = (0.5 - (yy + 0.5) / h) * np.pi
    b = 128 + 90 * np.sin(3 * lon) * np.cos(lat)
    g = 128 + 90 * np.cos(2 * lat + lon)
    r = 128 + 90 * np.sin(5 * lat) * np.cos(2 * lon)
    pano = np.dstack([b, g, r]).clip(0, 255).astype(np.uint8)
    for k in range(12):  # sharp features make misalignment visible
        cv2.circle(pano, (int((k + 0.5) * width / 12), h // 2 + int(h * 0.3 * math.sin(k))), width // 60, (255, 255, 255), -1)
    return pano


def render_shot(pano, yaw, pitch, roll, w=PHONE_W, h=PHONE_H, f35=F35):
    """Inverse of stitching: what a phone at this pose would photograph."""
    focal = math.hypot(w, h) * f35 / math.hypot(36, 24)
    f, r, u = camera_axes(yaw, pitch, roll)
    jj, ii = np.meshgrid(np.arange(w, dtype=np.float64), np.arange(h, dtype=np.float64))
    x, y = (jj - (w - 1) / 2) / focal, -(ii - (h - 1) / 2) / focal
    d = x[..., None] * r + y[..., None] * u + f
    d /= np.linalg.norm(d, axis=-1, keepdims=True)
    lon, lat = np.arctan2(d[..., 0], d[..., 2]), np.arcsin(np.clip(d[..., 1], -1, 1))
    ph, pw = pano.shape[:2]
    mx = ((lon / np.pi + 1) / 2 * pw - 0.5).astype(np.float32)
    my = ((0.5 - lat / np.pi) * ph - 0.5).astype(np.float32)
    return cv2.remap(pano, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)


def to_jpeg(bgr, f35=None, orientation=None):
    im = Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
    exif = Image.Exif()
    if f35:
        exif.get_ifd(0x8769)[0xA405] = int(f35)
    if orientation:
        exif[0x0112] = orientation
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=95, exif=exif.tobytes())
    return buf.getvalue()


def psnr(a, b):
    mse = np.mean((a.astype(np.float64) - b.astype(np.float64)) ** 2)
    return 10 * math.log10(255**2 / mse)


@pytest.fixture(scope="module")
def pano():
    return make_panorama()


def shots_for_plan(pano, rng, roll_jitter=3.0, angle_jitter=2.0):
    shots = []
    for t in capture_plan():
        yaw = t["yaw"] + rng.uniform(-angle_jitter, angle_jitter)
        pitch = float(np.clip(t["pitch"] + rng.uniform(-angle_jitter, angle_jitter), -90, 90))
        roll = rng.uniform(-roll_jitter, roll_jitter)
        img, focal = decode(to_jpeg(render_shot(pano, yaw, pitch, roll), f35=F35))
        shots.append(Shot(img, focal, yaw, pitch, roll))
    return shots


def test_capture_plan_covers_whole_sphere(pano):
    # Weight > 0 everywhere means no holes, even for a slightly narrower lens than assumed.
    for f35 in (F35, 28.0, 30.0):
        shots = []
        for t in capture_plan():
            img = np.full((PHONE_H, PHONE_W, 3), 200, np.uint8)
            focal = math.hypot(PHONE_W, PHONE_H) * f35 / math.hypot(36, 24)
            shots.append(Shot(img, focal, t["yaw"], t["pitch"]))
        out = stitch(shots, 1024)
        assert (out > 0).all(), f"holes with f35={f35}: {(out.sum(-1) == 0).mean():.2%}"


def test_round_trip_reconstructs_panorama(pano):
    rng = np.random.default_rng(0)
    out = stitch(shots_for_plan(pano, rng), pano.shape[1])
    score = psnr(out, pano)
    assert score > 30, f"PSNR {score:.1f} dB"


def test_roll_is_compensated(pano):
    shot = render_shot(pano, 30, 10, 15)
    img, focal = decode(to_jpeg(shot, f35=F35))
    good = stitch([Shot(img, focal, 30, 10, 15)], 1024)
    bad = stitch([Shot(img, focal, 30, 10, 0)], 1024)
    small = cv2.resize(pano, (1024, 512), interpolation=cv2.INTER_AREA)
    mask = good.sum(-1) > 0
    assert psnr(good[mask], small[mask]) > psnr(bad[mask], small[mask]) + 6


def test_decode_reads_focal_length_from_exif():
    img = np.zeros((PHONE_H, PHONE_W, 3), np.uint8)
    _, focal13 = decode(to_jpeg(img, f35=13))
    _, focal26 = decode(to_jpeg(img, f35=26))
    _, default = decode(to_jpeg(img))
    assert focal13 == pytest.approx(focal26 / 2)
    assert default == pytest.approx(focal26)
    _, override = decode(to_jpeg(img, f35=26), f35=52)
    assert override == pytest.approx(2 * focal26)


def test_decode_downscales_but_keeps_requested_resolution():
    big = np.zeros((4032, 3024, 3), np.uint8)
    full, focal_full = decode(to_jpeg(big, f35=26))
    small, focal_small = decode(to_jpeg(big, f35=26), px_per_rad=600)
    assert small.shape[0] < full.shape[0] // 2
    assert focal_small >= 600
    assert focal_small / small.shape[1] == pytest.approx(focal_full / full.shape[1], rel=0.01)


def test_decode_applies_exif_rotation():
    # Phones often store the sensor's landscape pixels plus "rotate 90° CW" (orientation 6).
    upright = np.zeros((PHONE_H, PHONE_W, 3), np.uint8)
    upright[:100] = 255  # bright top edge
    stored = cv2.rotate(upright, cv2.ROTATE_90_COUNTERCLOCKWISE)
    img, _ = decode(to_jpeg(stored, orientation=6))
    assert img.shape[:2] == (PHONE_H, PHONE_W)
    assert img[:50].mean() > 200 and img[-50:].mean() < 50


def test_output_is_equirectangular():
    img = np.full((PHONE_H, PHONE_W, 3), 100, np.uint8)
    out = stitch([Shot(img, 900.0, 0, 0)], 1000)
    assert out.shape == (500, 1000, 3)


def test_footprint_wraps_across_the_seam(pano):
    # A shot centred on yaw 180 straddles the left/right edge of the panorama.
    shot = render_shot(pano, 180, 0, 0)
    img, focal = decode(to_jpeg(shot, f35=F35))
    out = stitch([Shot(img, focal, 180, 0)], 1024)
    assert out[256, 0].sum() > 0 and out[256, 1023].sum() > 0
    assert out[256, 512].sum() == 0
