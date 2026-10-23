import json
import math
import os
import re
import tempfile
import uuid
from pathlib import Path

import cv2
from flask import Flask, Response, abort, request, send_from_directory
from PIL import UnidentifiedImageError

from refine import refine
from stitcher import Shot, decode, stitch

MAX_PHOTOS = 64
MIN_WIDTH, MAX_WIDTH = 512, 8192
KEEP_RESULTS = 50
RESULT_ID = re.compile(r"^[0-9a-f]{32}$")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 256 * 1024 * 1024
app.config["RESULTS_DIR"] = Path(os.environ.get("PHOTO360_RESULTS_DIR") or tempfile.mkdtemp(prefix="photo360-"))


class BadRequest(Exception):
    pass


@app.errorhandler(BadRequest)
def bad_request(e):
    return Response(str(e), status=400, mimetype="text/plain")


def _number(item, key, default=None):
    value = item.get(key, default)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise BadRequest(f"meta.{key} must be a finite number")
    return float(value)


def parse_request():
    files = request.files.getlist("photos")
    try:
        meta = json.loads(request.form.get("meta", ""))
    except json.JSONDecodeError:
        raise BadRequest("meta must be JSON")
    if not isinstance(meta, list) or not all(isinstance(m, dict) for m in meta):
        raise BadRequest("meta must be a list of objects")
    if not files or len(files) != len(meta):
        raise BadRequest("photos and meta must have the same, non-zero length")
    if len(files) > MAX_PHOTOS:
        raise BadRequest(f"at most {MAX_PHOTOS} photos")

    try:
        width = int(request.args.get("width", 4096))
    except ValueError:
        raise BadRequest("width must be an integer")
    width = max(MIN_WIDTH, min(MAX_WIDTH, width)) // 2 * 2

    shots = []
    for f, m in zip(files, meta):
        pitch = _number(m, "pitch")
        if not -90 <= pitch <= 90:
            raise BadRequest("meta.pitch must be within [-90, 90]")
        f35 = _number(m, "f35") if "f35" in m else None
        if f35 is not None and not 5 <= f35 <= 300:
            raise BadRequest("meta.f35 must be within [5, 300]")
        try:
            image, focal = decode(f.read(), f35, width / (2 * math.pi))
        except (UnidentifiedImageError, OSError):
            raise BadRequest(f"photo {f.filename!r} is not a readable image")
        shots.append(Shot(image, focal, _number(m, "yaw"), pitch, _number(m, "roll", 0.0)))
    return shots, width


@app.get("/health")
def health():
    return {"ok": True}


def _prune(results: Path):
    old = sorted(results.glob("*.jpg"), key=lambda p: p.stat().st_mtime, reverse=True)[KEEP_RESULTS:]
    for p in old:
        p.unlink(missing_ok=True)


@app.post("/stitch")
def stitch_route():
    shots, width = parse_request()
    if request.args.get("refine", "1") != "0":
        shots = refine(shots)
    ok, buf = cv2.imencode(".jpg", stitch(shots, width), [cv2.IMWRITE_JPEG_QUALITY, 90])
    results = Path(app.config["RESULTS_DIR"])
    results.mkdir(parents=True, exist_ok=True)
    result_id = uuid.uuid4().hex
    (results / f"{result_id}.jpg").write_bytes(buf.tobytes())
    _prune(results)
    return {"id": result_id, "url": f"/panoramas/{result_id}.jpg"}


@app.get("/panoramas/<result_id>.jpg")
def panorama(result_id):
    if not RESULT_ID.match(result_id):
        abort(404)
    return send_from_directory(app.config["RESULTS_DIR"], f"{result_id}.jpg", mimetype="image/jpeg")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, threaded=False)
