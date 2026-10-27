import io
import json

import cv2
import numpy as np
import pytest

from app import MAX_PHOTOS, app
from test_stitcher import to_jpeg


@pytest.fixture
def client(tmp_path):
    app.config["TESTING"] = True
    app.config["RESULTS_DIR"] = tmp_path
    return app.test_client()


def photo(name="img_0.jpg"):
    return (io.BytesIO(to_jpeg(np.full((120, 90, 3), 150, np.uint8), f35=26)), name)


def post(client, photos, meta, query=""):
    data = {"photos": photos}
    if meta is not None:
        data["meta"] = meta if isinstance(meta, str) else json.dumps(meta)
    return client.post(f"/stitch{query}", data=data, content_type="multipart/form-data")


def test_health(client):
    assert client.get("/health").get_json() == {"ok": True}


def test_happy_path_stores_a_downloadable_equirectangular_jpeg(client):
    res = post(client, [photo()], [{"yaw": 0, "pitch": 0, "roll": 1.5}], "?width=1024")
    assert res.status_code == 200
    body = res.get_json()
    assert body["url"] == f"/panoramas/{body['id']}.jpg"
    with client.get(body["url"]) as got:
        assert got.status_code == 200 and got.mimetype == "image/jpeg"
        img = cv2.imdecode(np.frombuffer(got.data, np.uint8), cv2.IMREAD_COLOR)
    assert img.shape == (512, 1024, 3)


@pytest.mark.parametrize("path", ["/panoramas/nope.jpg", "/panoramas/..%2Fapp.py.jpg", "/panoramas/" + "0" * 32 + ".jpg"])
def test_unknown_or_malicious_result_ids_404(client, path):
    assert client.get(path).status_code == 404


@pytest.mark.parametrize("query,refined", [("", True), ("?refine=1", True), ("?refine=0", False)])
def test_pose_refinement_runs_by_default(client, monkeypatch, query, refined):
    calls = []
    monkeypatch.setattr("app.refine", lambda shots: calls.append(1) or shots)
    assert post(client, [photo()], [{"yaw": 0, "pitch": 0}], query).status_code == 200
    assert bool(calls) == refined


def test_old_results_are_pruned(client, monkeypatch):
    monkeypatch.setattr("app.KEEP_RESULTS", 2)
    monkeypatch.setattr("app.stitch", lambda shots, width: np.zeros((4, 8, 3), np.uint8))
    urls = [post(client, [photo()], [{"yaw": 0, "pitch": 0}]).get_json()["url"] for _ in range(4)]
    codes = []
    for u in urls:
        with client.get(u) as res:
            codes.append(res.status_code)
    assert codes.count(200) == 2


@pytest.mark.parametrize("query,expected_width", [("?width=100000", 8192), ("?width=10", 512), ("?width=1001", 1000)])
def test_width_is_clamped(client, query, expected_width, monkeypatch):
    seen = {}
    monkeypatch.setattr("app.stitch", lambda shots, width: seen.setdefault("w", width) and np.zeros((4, 8, 3), np.uint8))
    assert post(client, [photo()], [{"yaw": 0, "pitch": 0}], query).status_code == 200
    assert seen["w"] == expected_width


@pytest.mark.parametrize(
    "meta,why",
    [
        (None, "missing meta"),
        ("not json", "invalid JSON"),
        ({"yaw": 0}, "not a list"),
        ([1], "list of non-objects"),
        ([], "count mismatch"),
        ([{"yaw": 0, "pitch": 0}, {"yaw": 1, "pitch": 0}], "count mismatch"),
        ([{"pitch": 0}], "missing yaw"),
        ([{"yaw": "1", "pitch": 0}], "string yaw"),
        ([{"yaw": True, "pitch": 0}], "bool yaw"),
        ('[{"yaw": NaN, "pitch": 0}]', "NaN"),
        ([{"yaw": 0, "pitch": 91}], "pitch out of range"),
        ([{"yaw": 0, "pitch": 0, "f35": 1}], "f35 out of range"),
    ],
)
def test_bad_meta_is_rejected(client, meta, why):
    res = post(client, [photo()], meta)
    assert res.status_code == 400, why


def test_non_image_is_rejected(client):
    res = post(client, [(io.BytesIO(b"definitely not a jpeg"), "x.jpg")], [{"yaw": 0, "pitch": 0}])
    assert res.status_code == 400


def test_bad_width_is_rejected(client):
    assert post(client, [photo()], [{"yaw": 0, "pitch": 0}], "?width=abc").status_code == 400


def test_too_many_photos_is_rejected(client):
    n = MAX_PHOTOS + 1
    res = post(client, [photo(f"{i}.jpg") for i in range(n)], [{"yaw": 0, "pitch": 0}] * n)
    assert res.status_code == 400


def test_oversized_upload_is_rejected(client):
    app.config["MAX_CONTENT_LENGTH"] = 1024
    try:
        res = post(client, [photo()], [{"yaw": 0, "pitch": 0}])
        assert res.status_code == 413
    finally:
        app.config["MAX_CONTENT_LENGTH"] = 256 * 1024 * 1024


# --- regressions found by fuzzing the API ---

@pytest.mark.parametrize("meta", [{"yaw": 1e308, "pitch": 0}, {"yaw": -1e300, "pitch": 0}, {"yaw": 0, "pitch": 0, "roll": 1e308}])
def test_huge_but_finite_angles_do_not_crash(client, meta):
    res = post(client, [photo()], [meta], "?width=512&refine=0")
    assert res.status_code == 200, res.data[:200]


def test_angles_are_wrapped_not_misread(client, monkeypatch):
    seen = []
    monkeypatch.setattr("app.stitch", lambda shots, width: seen.extend(shots) or np.zeros((4, 8, 3), np.uint8))
    post(client, [photo()], [{"yaw": 730, "pitch": 0, "roll": 190}], "?refine=0")
    assert seen[0].yaw == pytest.approx(10) and seen[0].roll == pytest.approx(-170)


def test_decompression_bomb_is_rejected_not_500(client, monkeypatch):
    import PIL.Image
    monkeypatch.setattr(PIL.Image, "MAX_IMAGE_PIXELS", 1000)  # makes the 90x120 test photo count as a bomb
    res = post(client, [photo()], [{"yaw": 0, "pitch": 0}])
    assert res.status_code == 400 and b"too large" in res.data


def test_refinement_failure_falls_back_to_sensor_poses(client, monkeypatch):
    def boom(shots):
        raise np.linalg.LinAlgError("SVD did not converge")
    monkeypatch.setattr("app.refine", boom)
    assert post(client, [photo()], [{"yaw": 0, "pitch": 0}], "?width=512").status_code == 200


def test_unexpected_errors_return_a_readable_message(client, monkeypatch):
    def boom(shots, width):
        raise RuntimeError("kaboom")
    monkeypatch.setattr("app.stitch", boom)
    app.config["PROPAGATE_EXCEPTIONS"] = False
    try:
        res = post(client, [photo()], [{"yaw": 0, "pitch": 0}], "?refine=0")
    finally:
        app.config["PROPAGATE_EXCEPTIONS"] = None
    assert res.status_code == 500 and res.mimetype == "text/plain"
    assert b"<html" not in res.data.lower() and b"stitching failed" in res.data.lower()


def test_oversized_upload_message_is_plain_text(client):
    app.config["MAX_CONTENT_LENGTH"] = 1024
    try:
        res = post(client, [photo()], [{"yaw": 0, "pitch": 0}])
    finally:
        app.config["MAX_CONTENT_LENGTH"] = 256 * 1024 * 1024
    assert res.status_code == 413 and res.mimetype == "text/plain"
