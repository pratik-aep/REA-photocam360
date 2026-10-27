"""Equirectangular stitching from photos with known camera poses.

World frame: x east, y up, z north. A pose is (yaw clockwise from the reference heading,
pitch up from the horizon, roll of the image about the view axis), all in degrees.
"""
from __future__ import annotations

import io
import math
from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image, ImageOps

DEFAULT_F35 = 26.0  # typical phone main camera, 35mm-equivalent focal length
MIN_F35, MAX_F35 = 5.0, 300.0
DIAG_35MM = math.hypot(36.0, 24.0)


@dataclass
class Shot:
    image: np.ndarray  # BGR uint8, upright
    focal: float  # pixels
    yaw: float
    pitch: float
    roll: float = 0.0


def decode(data: bytes, f35: float | None = None, px_per_rad: float | None = None) -> tuple[np.ndarray, float]:
    """Decode a JPEG, apply its EXIF rotation, and derive the focal length in pixels.

    With `px_per_rad`, JPEG DCT scaling decodes at the smallest size that still meets that
    angular resolution, which is several times faster than decoding the full frame.
    """
    with Image.open(io.BytesIO(data)) as im:
        exif_f35 = im.getexif().get_ifd(0x8769).get(0xA405)
        if not isinstance(exif_f35, (int, float)) or not MIN_F35 <= exif_f35 <= MAX_F35:
            exif_f35 = None  # 0 means "unknown"; some phones write nonsense values
        f35 = f35 or (float(exif_f35) if exif_f35 else DEFAULT_F35)
        if px_per_rad:
            scale = px_per_rad / (math.hypot(*im.size) * f35 / DIAG_35MM)
            if scale < 1:
                im.draft("RGB", (math.ceil(im.width * scale), math.ceil(im.height * scale)))
        im = ImageOps.exif_transpose(im).convert("RGB")
        rgb = np.asarray(im)
    h, w = rgb.shape[:2]
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), math.hypot(w, h) * f35 / DIAG_35MM


def camera_axes(yaw: float, pitch: float, roll: float):
    h, p, q = math.radians(yaw), math.radians(pitch), math.radians(roll)
    f = np.array([math.cos(p) * math.sin(h), math.sin(p), math.cos(p) * math.cos(h)])
    r0 = np.array([math.cos(h), 0.0, -math.sin(h)])
    u0 = np.array([-math.sin(p) * math.sin(h), math.cos(p), -math.sin(p) * math.cos(h)])
    r = math.cos(q) * r0 + math.sin(q) * u0
    u = -math.sin(q) * r0 + math.cos(q) * u0
    return f, r, u


def _fit(image: np.ndarray, focal: float, px_per_rad: float):
    # Shrink to the output's angular resolution first; remap alone would alias a 12MP shot.
    scale = px_per_rad / focal
    if scale >= 1:
        return image, focal
    h, w = image.shape[:2]
    small = cv2.resize(image, (max(1, round(w * scale)), max(1, round(h * scale))), interpolation=cv2.INTER_AREA)
    return small, focal * small.shape[1] / w


def _footprint(shot_w, shot_h, focal, yaw, pitch, width, height):
    """Rows and (wrapped) columns of the panorama the shot can touch."""
    theta = math.atan(math.hypot(shot_w, shot_h) / 2 / focal)
    p, y = math.radians(pitch), math.radians(yaw)
    lat_hi, lat_lo = min(p + theta, math.pi / 2), max(p - theta, -math.pi / 2)
    r0 = max(0, int(math.floor((0.5 - lat_hi / math.pi) * height)))
    r1 = min(height, int(math.ceil((0.5 - lat_lo / math.pi) * height)))
    rows = np.arange(r0, r1)
    if abs(p) + theta >= math.pi / 2:
        return rows, np.arange(width)
    dlon = math.asin(min(1.0, math.sin(theta) / math.cos(p)))
    c0 = int(math.floor((y - dlon + math.pi) / (2 * math.pi) * width))
    c1 = int(math.ceil((y + dlon + math.pi) / (2 * math.pi) * width))
    return rows, np.arange(c0, c1 + 1) % width


def stitch(shots: list[Shot], width: int = 4096) -> np.ndarray:
    height = width // 2
    lon = ((np.arange(width, dtype=np.float32) + 0.5) / width * 2 - 1) * np.float32(math.pi)
    lat = (0.5 - (np.arange(height, dtype=np.float32) + 0.5) / height) * np.float32(math.pi)
    sin_lon, cos_lon, sin_lat, cos_lat = np.sin(lon), np.cos(lon), np.sin(lat), np.cos(lat)

    acc = np.zeros((height, width, 3), np.float32)
    wsum = np.zeros((height, width), np.float32)
    for s in shots:
        img, focal = _fit(s.image, s.focal, width / (2 * math.pi))
        h, w = img.shape[:2]
        rows, cols = _footprint(w, h, focal, s.yaw, s.pitch, width, height)
        if not len(rows):
            continue
        f, r, u = (a.astype(np.float32) for a in camera_axes(s.yaw, s.pitch, s.roll))
        cl, sl = cos_lat[rows, None], sin_lat[rows, None]
        sx, cx = sin_lon[None, cols], cos_lon[None, cols]
        # Dot products of each panorama direction (cl·sx, sl, cl·cx) with the camera axes.
        dot = lambda a: cl * (sx * a[0] + cx * a[2]) + sl * a[1]
        x, y, z = dot(r), dot(u), dot(f)

        with np.errstate(divide="ignore", invalid="ignore"):
            px = (w - 1) / 2 + focal * x / z
            py = (h - 1) / 2 - focal * y / z
        valid = (z > 1e-6) & (px >= 0) & (px <= w - 1) & (py >= 0) & (py <= h - 1)
        px = np.where(valid, px, -1).astype(np.float32)
        py = np.where(valid, py, -1).astype(np.float32)

        warped = cv2.remap(img, px, py, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
        # Feather: weight falls to zero at the shot's edges so seams blend.
        weight = np.minimum(1 - np.abs(2 * px / (w - 1) - 1), 1 - np.abs(2 * py / (h - 1) - 1))
        weight = np.where(valid, weight, 0).astype(np.float32)

        ix = np.ix_(rows, cols)
        acc[ix] += warped * weight[..., None]
        wsum[ix] += weight

    out = acc / np.maximum(wsum, 1e-6)[..., None]
    return np.clip(out + 0.5, 0, 255).astype(np.uint8)
