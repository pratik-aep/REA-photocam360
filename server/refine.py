"""Correct the phone's reported camera poses using features matched between overlapping shots.

Sensor yaw typically drifts by a few degrees, which shows up as ghosting at the seams. Each shot's
rotation gets a small correction that makes matched features point the same way in the world,
solved as robust least squares and anchored softly to the sensor poses (which keeps the horizon
level and leaves featureless shots where the sensor put them).
"""
from __future__ import annotations

import math
from dataclasses import replace
from itertools import combinations

import cv2
import numpy as np

from stitcher import Shot, camera_axes

FEATURE_MAX_SIDE = 1200
MIN_PAIR_MATCHES = 12
RANSAC_ITERS = 300
INLIER_DEG = 0.3  # a few pixels at phone resolution
MAX_SENSOR_DISAGREEMENT_DEG = 30.0  # reject a pair whose image rotation contradicts the sensors this much
ITERATIONS = 5
# Pull toward the sensor pose, in matches' worth. Only needs to pin the overall rotation and hold
# unmatched shots; anything larger biases matched shots back toward the sensor's error.
PRIOR_WEIGHT = 0.05


def rotation(s: Shot) -> np.ndarray:
    """Camera-to-world matrix: columns are the camera's right, up and forward axes."""
    f, r, u = camera_axes(s.yaw, s.pitch, s.roll)
    return np.column_stack([r, u, f])


def pose_from_rotation(R: np.ndarray) -> tuple[float, float, float]:
    r, f = R[:, 0], R[:, 2]
    pitch = math.asin(max(-1.0, min(1.0, f[1])))
    yaw = math.atan2(f[0], f[2])
    sp, cp, sy, cy = math.sin(pitch), math.cos(pitch), math.sin(yaw), math.cos(yaw)
    r0 = np.array([cy, 0.0, -sy])
    u0 = np.array([-sp * sy, cp, -sp * cy])
    roll = math.atan2(r @ u0, r @ r0)
    return math.degrees(yaw) % 360, math.degrees(pitch), math.degrees(roll)


def _features(sift, s: Shot):
    h, w = s.image.shape[:2]
    scale = min(1.0, FEATURE_MAX_SIDE / max(h, w))
    gray = cv2.cvtColor(s.image, cv2.COLOR_BGR2GRAY)
    if scale < 1:
        gray = cv2.resize(gray, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    kps, desc = sift.detectAndCompute(gray, None)
    if desc is None or len(kps) < MIN_PAIR_MATCHES:
        return None, None
    pts = np.array([k.pt for k in kps], np.float64) / scale
    rays = np.column_stack([(pts[:, 0] - (w - 1) / 2) / s.focal, -(pts[:, 1] - (h - 1) / 2) / s.focal, np.ones(len(pts))])
    return rays / np.linalg.norm(rays, axis=1, keepdims=True), desc


def _half_diag(s: Shot) -> float:
    h, w = s.image.shape[:2]
    return math.atan(math.hypot(w, h) / 2 / s.focal)


def _skew(v: np.ndarray) -> np.ndarray:
    """Stacked cross-product matrices [v]x for an (n, 3) array."""
    z = np.zeros(len(v))
    return np.stack([np.stack([z, -v[:, 2], v[:, 1]], -1), np.stack([v[:, 2], z, -v[:, 0]], -1), np.stack([-v[:, 1], v[:, 0], z], -1)], 1)


def _kabsch(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Rotation(s) Q minimising |Q a - b|; a, b are (..., k, 3)."""
    U, _, Vt = np.linalg.svd(np.swapaxes(a, -1, -2) @ b)
    d = np.sign(np.linalg.det(np.swapaxes(Vt, -1, -2) @ np.swapaxes(U, -1, -2)))
    D = np.zeros(d.shape + (3, 3))
    D[..., 0, 0] = D[..., 1, 1] = 1
    D[..., 2, 2] = d
    return np.swapaxes(Vt, -1, -2) @ D @ np.swapaxes(U, -1, -2)


def _angle_deg(Q: np.ndarray) -> float:
    return math.degrees(math.acos(max(-1.0, min(1.0, (np.trace(Q) - 1) / 2))))


def _ransac_rotation(a: np.ndarray, b: np.ndarray, rng) -> np.ndarray | None:
    """Inlier mask for the camera-to-camera rotation most matches agree on (b ≈ Q a)."""
    cos_t = math.cos(math.radians(INLIER_DEG))
    idx = rng.integers(0, len(a), (RANSAC_ITERS, 2))
    idx = idx[idx[:, 0] != idx[:, 1]]
    Q = _kabsch(a[idx], b[idx])  # (iters, 3, 3) from minimal 2-match samples
    scores = np.einsum("tij,nj,ni->tn", Q, a, b) > cos_t
    best = scores.sum(1).argmax()
    inliers = scores[best]
    if inliers.sum() < MIN_PAIR_MATCHES:
        return None
    Q = _kabsch(a[inliers], b[inliers])  # refit on all inliers, then re-score once
    inliers = np.einsum("ij,nj,ni->n", Q, a, b) > cos_t
    return inliers if inliers.sum() >= MIN_PAIR_MATCHES else None


def refine(shots: list[Shot]) -> list[Shot]:
    n = len(shots)
    if n < 2:
        return shots
    sift = cv2.SIFT_create(nfeatures=1500)
    feats = [_features(sift, s) for s in shots]
    R = [rotation(s) for s in shots]
    matcher = cv2.BFMatcher(cv2.NORM_L2)
    rng = np.random.default_rng(0)

    pairs = []
    for i, j in combinations(range(n), 2):
        if feats[i][0] is None or feats[j][0] is None:
            continue
        angle = math.acos(max(-1.0, min(1.0, R[i][:, 2] @ R[j][:, 2])))
        if angle > _half_diag(shots[i]) + _half_diag(shots[j]):
            continue
        knn = matcher.knnMatch(feats[i][1], feats[j][1], k=2)
        good = [m[0] for m in knn if len(m) == 2 and m[0].distance < 0.75 * m[1].distance]
        if len(good) < MIN_PAIR_MATCHES:
            continue
        a, b = feats[i][0][[m.queryIdx for m in good]], feats[j][0][[m.trainIdx for m in good]]
        inliers = _ransac_rotation(a, b, rng)
        if inliers is None:
            continue
        # The images decide the rotation; the sensors only veto a pair that is wildly off (e.g. repeated texture).
        if _angle_deg(_kabsch(a[inliers], b[inliers]).T @ (R[j].T @ R[i])) > MAX_SENSOR_DISAGREEMENT_DEG:
            continue
        pairs.append((i, j, a[inliers], b[inliers]))
    if not pairs:
        return shots

    drift = np.zeros((n, 3))  # accumulated correction per shot, anchored by the prior
    for _ in range(ITERATIONS):
        rows, rhs = [], []
        for i, j, a, b in pairs:
            A, B = a @ R[i].T, b @ R[j].T
            # (I + [w_i]x) A - (I + [w_j]x) B ≈ 0  →  -[A]x w_i + [B]x w_j = B - A
            J = np.zeros((len(A), 3, 3 * n))
            J[:, :, 3 * i:3 * i + 3] = -_skew(A)
            J[:, :, 3 * j:3 * j + 3] = _skew(B)
            rows.append(J.reshape(-1, 3 * n))
            rhs.append((B - A).reshape(-1))
        k = math.sqrt(PRIOR_WEIGHT)
        rows.append(k * np.eye(3 * n))
        rhs.append(-k * drift.reshape(-1))
        w = np.linalg.lstsq(np.vstack(rows), np.concatenate(rhs), rcond=None)[0].reshape(n, 3)
        for s in range(n):
            R[s] = cv2.Rodrigues(w[s])[0] @ R[s]
        drift += w

    out = []
    for s, Rs in zip(shots, R):
        yaw, pitch, roll = pose_from_rotation(Rs)
        out.append(replace(s, yaw=yaw, pitch=pitch, roll=roll))
    return out
