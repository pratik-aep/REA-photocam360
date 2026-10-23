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
    got = client.get(body["url"])
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
    assert [client.get(u).status_code for u in urls].count(200) == 2


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
