"""The app's on-screen dots (src/projection.ts) must land where the server's geometry says the
same world direction appears in a photo taken at that pose."""
import json
import math
import subprocess

import cv2
import numpy as np
import pytest

from test_stitcher import APP_ROOT, F35, make_panorama, render_shot

W, H = 900, 1200  # 3:4 portrait frame, same aspect as the preview box

JS = """
import('./src/orientation.ts').then(async (o) => {
  const p = await import('./src/projection.ts');
  const cases = JSON.parse(process.argv[1]);
  const box = { width: %d, height: %d };
  const focal = p.focalForBox(box, %f);
  console.log(JSON.stringify(cases.map(({ pose, target }) => {
    const r = p.project(o.direction(target[0], target[1]), o.axesFromPose(pose), focal, box);
    return [r.x, r.y, r.onScreen];
  })));
});
""" % (W, H, F35)

CASES = [
    ({"yaw": 0, "pitch": 0, "roll": 0}, (10, 5)),
    ({"yaw": 40, "pitch": 10, "roll": 0}, (30, 0)),
    ({"yaw": 40, "pitch": 10, "roll": 12}, (30, 0)),
    ({"yaw": 200, "pitch": -30, "roll": -8}, (205, -42)),
    ({"yaw": 300, "pitch": 50, "roll": 5}, (300, 42)),
    ({"yaw": 90, "pitch": 80, "roll": 3}, (0, 90)),
]


def find_marker(img):
    mask = ((img[..., 1] > 240) & (img[..., 0] < 40) & (img[..., 2] < 40)).astype(np.uint8)
    ys, xs = np.nonzero(mask)
    assert len(xs) > 5, "marker not visible"
    return xs.mean() + 0.5, ys.mean() + 0.5


def marker_pano(target_yaw, target_pitch, width=4096):
    pano = np.zeros((width // 2, width, 3), np.uint8)
    if abs(target_pitch) == 90:  # a pole is one point: paint the whole polar cap
        rows = slice(0, 7) if target_pitch > 0 else slice(width // 2 - 7, None)
        pano[rows] = (0, 255, 0)
        return pano
    cx =(target_yaw / 360 + 0.5) * width
    cy = (0.5 - target_pitch / 180) * (width // 2)
    cv2.circle(pano, (int(round(cx)) % width, int(round(cy))), 6, (0, 255, 0), -1)
    return pano


def test_dots_match_server_geometry():
    out = subprocess.run(["node", "-e", JS, json.dumps([{"pose": p, "target": t} for p, t in CASES])],
                         cwd=APP_ROOT, capture_output=True, text=True, check=True)
    predicted = json.loads(out.stdout)
    for (pose, target), (px, py, on_screen) in zip(CASES, predicted):
        assert on_screen, (pose, target)
        photo = render_shot(marker_pano(*target), pose["yaw"], pose["pitch"], pose["roll"], W, H)
        mx, my = find_marker(photo)
        assert math.hypot(mx - px, my - py) < 4, f"{pose} {target}: dot at ({px:.1f},{py:.1f}) but scene shows ({mx:.1f},{my:.1f})"
