"""Renders the app's WebGL viewer (src/viewerHtml.ts) in headless Chrome and checks it shows
exactly the view the stitcher's geometry predicts. Skipped when Chrome isn't installed."""
import math
import shutil
import subprocess
from pathlib import Path

import cv2
import numpy as np
import pytest

from stitcher import camera_axes
from test_stitcher import APP_ROOT, make_panorama

CHROME = next(
    (p for p in ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", shutil.which("google-chrome"), shutil.which("chromium")] if p and Path(p).exists()),
    None,
)
W, H, FOV = 600, 800, 75

GEN = """
const fs = require('fs');
import('./src/viewerHtml.ts').then(({ viewerHtml }) => {
  const [jpg, out, yaw, pitch] = process.argv.slice(1);
  const html = viewerHtml('data:image/jpeg;base64,' + fs.readFileSync(jpg).toString('base64'));
  const hook = `<script>setTimeout(function(){__view.yaw=${yaw};__view.pitch=${pitch};__redraw()},300)</script></body>`;
  fs.writeFileSync(out, html.replace('</body>', hook));
});
"""


def expected_view(pano, yaw, pitch):
    focal = (H / 2) / math.tan(math.radians(FOV / 2))
    f, r, u = camera_axes(yaw, pitch, 0)
    jj, ii = np.meshgrid(np.arange(W) + 0.5, np.arange(H) + 0.5)
    d = ((jj - W / 2) / focal)[..., None] * r + (-(ii - H / 2) / focal)[..., None] * u + f
    d /= np.linalg.norm(d, axis=-1, keepdims=True)
    lon, lat = np.arctan2(d[..., 0], d[..., 2]), np.arcsin(np.clip(d[..., 1], -1, 1))
    ph, pw = pano.shape[:2]
    mx = ((lon / np.pi + 1) / 2 * pw - 0.5).astype(np.float32)
    my = ((0.5 - lat / np.pi) * ph - 0.5).astype(np.float32)
    return cv2.remap(pano, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)


@pytest.mark.skipif(CHROME is None, reason="Chrome not installed")
@pytest.mark.parametrize("yaw,pitch", [(0, 0), (60, 20), (-150, -35), (170, 80)])
def test_viewer_matches_stitcher_geometry(tmp_path, yaw, pitch):
    jpg = tmp_path / "pano.jpg"
    cv2.imwrite(str(jpg), make_panorama(2048), [cv2.IMWRITE_JPEG_QUALITY, 95])
    pano = cv2.imread(str(jpg))
    html, png = tmp_path / "v.html", tmp_path / "v.png"
    subprocess.run(["node", "-e", GEN, str(jpg), str(html), str(math.radians(yaw)), str(math.radians(pitch))],
                   cwd=APP_ROOT, check=True, capture_output=True)
    subprocess.run([CHROME, "--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
                    "--hide-scrollbars", "--force-device-scale-factor=1", f"--window-size={W},{H}",
                    "--virtual-time-budget=4000", f"--screenshot={png}", f"file://{html}"],
                   check=True, capture_output=True, timeout=60)
    got = cv2.imread(str(png))
    assert got is not None and got.shape == (H, W, 3)
    assert got.std() > 10, "blank render"
    assert np.abs(got.astype(int) - expected_view(pano, yaw, pitch)).mean() < 1.0


LOSE_AND_RESTORE = """<script>
setTimeout(function(){
  var gl=document.getElementById('c').getContext('webgl'), ext=gl.getExtension('WEBGL_lose_context');
  ext.loseContext();
  setTimeout(function(){ ext.restoreContext();
    setTimeout(function(){ __view.yaw=%f; __view.pitch=%f; __redraw(); }, 300);
  }, 300);
}, 300)</script></body>"""

GEN_CUSTOM_HOOK = """
const fs = require('fs');
import('./src/viewerHtml.ts').then(({ viewerHtml }) => {
  const [jpg, out, hook] = process.argv.slice(1);
  const html = viewerHtml('data:image/jpeg;base64,' + fs.readFileSync(jpg).toString('base64'));
  fs.writeFileSync(out, html.replace('</body>', hook));
});
"""


@pytest.mark.skipif(CHROME is None, reason="Chrome not installed")
def test_viewer_recovers_from_webgl_context_loss(tmp_path):
    """Android drops a backgrounded WebView's GL context; the viewer must redraw after restore."""
    yaw, pitch = 60, 20
    jpg = tmp_path / "pano.jpg"
    cv2.imwrite(str(jpg), make_panorama(2048), [cv2.IMWRITE_JPEG_QUALITY, 95])
    pano = cv2.imread(str(jpg))
    html, png = tmp_path / "v.html", tmp_path / "v.png"
    hook = LOSE_AND_RESTORE % (math.radians(yaw), math.radians(pitch))
    subprocess.run(["node", "-e", GEN_CUSTOM_HOOK, str(jpg), str(html), hook], cwd=APP_ROOT, check=True, capture_output=True)
    subprocess.run([CHROME, "--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
                    "--hide-scrollbars", "--force-device-scale-factor=1", f"--window-size={W},{H}",
                    "--virtual-time-budget=6000", f"--screenshot={png}", f"file://{html}"],
                   check=True, capture_output=True, timeout=60)
    got = cv2.imread(str(png))
    assert got.std() > 10, "viewer stayed blank after the WebGL context was restored"
    assert np.abs(got.astype(int) - expected_view(pano, yaw, pitch)).mean() < 1.0


@pytest.mark.skipif(CHROME is None, reason="Chrome not installed")
def test_viewer_explains_missing_webgl(tmp_path):
    jpg = tmp_path / "pano.jpg"
    cv2.imwrite(str(jpg), make_panorama(512))
    html = tmp_path / "v.html"
    subprocess.run(["node", "-e", GEN_CUSTOM_HOOK, str(jpg), str(html), "</body>"], cwd=APP_ROOT, check=True, capture_output=True)
    out = subprocess.run([CHROME, "--headless=new", "--disable-webgl", "--disable-3d-apis", "--virtual-time-budget=3000",
                          "--dump-dom", f"file://{html}"], check=True, capture_output=True, text=True, timeout=60).stdout
    assert "WebGL is not available" in out
