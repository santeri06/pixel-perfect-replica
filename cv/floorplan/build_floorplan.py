"""Floor plan of the switchgear room from the E57 point cloud, with every relay at its measured position.

Usage (PowerShell, from cv/floorplan, venv active):
    python build_floorplan.py --e57 ..\\data\\raw\\cloud_0.e57 --cache
    python build_floorplan.py --npz-dir $HOME\\Downloads\\E57\\export --cache   # output of export_e57.py

Stages (each is a gate; data is only published when all gates pass):
    A0  pair every E57 scan with a scan point of panoramas.json by translation (< 0.10 m, unique)
    A2  read scan by scan, float32, voxel-downsample immediately (fine cloud for rays, coarse for the plan)
    A3  reproject the cloud into 3 panoramas and cross-correlate edges with equirect.jpg (< 0.5 deg, not mirrored)
    A4  floor height, bounds, floor/obstacle layers -> floorplan.png
    A5  first hit of every detection ray in the cloud; triangulation (scripts/build-registry.mjs) as fallback + cross-check
    A6  merge detections into devices (eps 0.15 m, cannot-link within one image, same-image overlap < 3 deg)
    A7  src/data/floorplan.json   A8  check.png, check_reprojection_scan-XX.png, report.json

Outputs when every gate passes: public/floorplan/floorplan.png, src/data/floorplan.json.
Otherwise they go to cv/floorplan/cache/rejected/ (git-ignored) and the exit code is non-zero.
"""
from __future__ import annotations

import argparse
import gc
import hashlib
import json
import math
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage
from scipy.spatial import cKDTree

import geom

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
DETECTIONS = REPO / "src" / "data" / "detections.json"
PANORAMAS = REPO / "src" / "data" / "panoramas.json"
PANO_DIR = REPO / "public" / "panoramas"
OUT_JSON = REPO / "src" / "data" / "floorplan.json"
OUT_PNG = REPO / "public" / "floorplan" / "floorplan.png"
CACHE = HERE / "cache"
REJECTED = CACHE / "rejected"

AUTO_TAG_CONFIDENCE = 0.75  # same as src/data/detections.ts
FLOOR_RGBA = (148, 163, 184, 89)  # rgba(148,163,184,0.35)
OBSTACLE_RGBA = (0x3A, 0x41, 0x50, 255)


# ---------------------------------------------------------------- small helpers
def log(msg: str) -> None:
    print(msg, flush=True)


def peak_memory_mb() -> float | None:
    try:
        import psutil  # optional

        info = psutil.Process().memory_info()
        return round(getattr(info, "peak_wset", info.rss) / 1e6, 1)
    except Exception:  # noqa: BLE001
        pass
    try:
        import resource

        r = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return round(r / 1e3 if sys.platform != "darwin" else r / 1e6, 1)
    except Exception:  # noqa: BLE001
        return None


def voxel_keys(xyz: np.ndarray, voxel: float) -> np.ndarray:
    k = np.floor(xyz / voxel).astype(np.int64) + (1 << 20)
    return (k[:, 0] << 42) | (k[:, 1] << 21) | k[:, 2]


def voxel_unique(xyz: np.ndarray, voxel: float, *extra: np.ndarray | None):
    """One point per voxel (first occurrence); extra arrays are filtered the same way."""
    _, idx = np.unique(voxel_keys(xyz, voxel), return_index=True)
    idx.sort()
    return (xyz[idx], *[(e[idx] if e is not None else None) for e in extra])


def r3(v) -> float:
    return round(float(v), 3)


def sha1_12(path: Path) -> str:
    # normalise line endings so a Windows (CRLF) checkout gives the same hash as the repo (LF)
    return hashlib.sha1(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()[:12]


# ---------------------------------------------------------------- inputs
def load_inputs():
    pano = json.loads(PANORAMAS.read_text(encoding="utf-8"))
    scan_pos = {p["scanPointId"]: np.array(p["position"], dtype=np.float64) for p in pano}
    dets = json.loads(DETECTIONS.read_text(encoding="utf-8"))
    for d in dets:
        d["auto"] = d["confidence"] >= AUTO_TAG_CONFIDENCE
    return pano, scan_pos, dets


class Source:
    """Scan headers + point reader for an .e57 file or an export_e57.py folder (scan_XX.npz + manifest.json)."""

    def __init__(self, e57: Path | None, npz_dir: Path | None, reader: str):
        self.e57_path, self.npz_dir, self.reader = e57, npz_dir, reader
        self.notes: list[str] = []
        if e57:
            import pye57

            self.e57 = pye57.E57(str(e57))
            self.count = self.e57.scan_count
            self.name = e57.name
        else:
            self.manifest = json.loads((npz_dir / "manifest.json").read_text(encoding="utf-8"))
            self.count = len(self.manifest["scans"])
            self.name = self.manifest.get("source", npz_dir.name)
            self.notes.append(f"input = export_e57.py folder, already voxelized at {self.manifest.get('voxel')} m")

    def header(self, i: int) -> dict:
        if not self.e57_path:
            s = self.manifest["scans"][i]
            return {"index": i, "name": s.get("name"), "points": s.get("pointsRaw"), "fields": s.get("fields", []),
                    "hasRGB": s.get("hasRGB", False), "hasIntensity": s.get("hasIntensity", False),
                    "translation": s["translation"], "rotation_wxyz": s["rotation_wxyz"], "hasPose": True}
        h = self.e57.get_header(i)
        fields = list(h.point_fields)
        has_pose = bool(h.has_pose())
        return {
            "index": i,
            "name": h["name"].value() if h.node.isDefined("name") else None,
            "points": int(h.point_count),
            "fields": fields,
            "hasRGB": "colorRed" in fields,
            "hasIntensity": "intensity" in fields,
            "translation": [float(v) for v in h.translation] if has_pose else [0.0, 0.0, 0.0],
            "rotation_wxyz": [float(v) for v in h.rotation] if has_pose else [1.0, 0.0, 0.0, 0.0],
            "hasPose": has_pose,
            "coordinates": "cartesian" if "cartesianX" in fields else "spherical",
        }

    def chunks(self, i: int, want_rgb: bool, chunk: int = 2_000_000):
        """Yields (xyz float32 world frame, rgb uint8 | None) blocks of scan i."""
        if not self.e57_path:
            z = np.load(self.npz_dir / self.manifest["scans"][i]["file"])
            yield z["xyz"].astype(np.float32), (z["rgb"] if want_rgb and "rgb" in z else None)
            return
        if self.reader == "read_scan":
            try:
                d = self.e57.read_scan(i, ignore_missing_fields=True, colors=want_rgb, transform=True)
                xyz = np.stack([d["cartesianX"], d["cartesianY"], d["cartesianZ"]], axis=1).astype(np.float32)
                rgb = _rgb(d) if want_rgb else None
                del d
                yield xyz, rgb
                return
            except MemoryError:
                self.notes.append(f"scan {i}: read_scan ran out of memory -> chunked reader")
                gc.collect()
        yield from self._chunked(i, want_rgb, chunk)

    def _chunked(self, i: int, want_rgb: bool, chunk: int):
        """Reads the compressed vector in blocks and applies the pose like pye57.E57.to_global (R·p + t)."""
        import pye57.libe57 as libe57

        h = self.e57.get_header(i)
        fields = list(h.point_fields)
        cart = "cartesianX" in fields
        names = ["cartesianX", "cartesianY", "cartesianZ"] if cart else ["sphericalRange", "sphericalAzimuth", "sphericalElevation"]
        inv = "cartesianInvalidState" if cart else "sphericalInvalidState"
        if inv in fields:
            names.append(inv)
        if want_rgb:
            names += ["colorRed", "colorGreen", "colorBlue"]
        arrays, buffers = {}, libe57.VectorSourceDestBuffer()
        for f in names:
            a, b = self.e57.make_buffer(f, chunk)
            arrays[f] = a
            buffers.append(b)
        R = geom.quat_to_matrix(h.rotation) if h.has_pose() else np.eye(3)
        t = np.asarray(h.translation, dtype=np.float64) if h.has_pose() else np.zeros(3)
        reader = h.points.reader(buffers)
        try:
            while True:
                n = reader.read()
                if n == 0:
                    break
                if cart:
                    p = np.stack([arrays["cartesianX"][:n], arrays["cartesianY"][:n], arrays["cartesianZ"][:n]], axis=1)
                else:
                    r, az, el = (arrays[k][:n] for k in names[:3])
                    p = np.stack([r * np.cos(el) * np.cos(az), r * np.cos(el) * np.sin(az), r * np.sin(el)], axis=1)
                ok = np.ones(n, bool) if inv not in arrays else arrays[inv][:n] == 0
                xyz = (p[ok] @ R.T + t).astype(np.float32)
                rgb = _rgb({k: arrays[k][:n][ok] for k in ("colorRed", "colorGreen", "colorBlue")}) if want_rgb else None
                yield xyz, rgb
        finally:
            reader.close()


def _rgb(d: dict) -> np.ndarray | None:
    if "colorRed" not in d:
        return None
    rgb = np.stack([d["colorRed"], d["colorGreen"], d["colorBlue"]], axis=1)
    if rgb.size and rgb.max() > 255:
        rgb = rgb / 257.0
    return rgb.astype(np.uint8)


# ---------------------------------------------------------------- A0
def pair_scans(headers: list[dict], scan_pos: dict) -> tuple[dict, list[dict], bool]:
    ids = list(scan_pos)
    P = np.array([scan_pos[k] for k in ids])
    rows, mapping = [], {}
    for h in headers:
        d = np.linalg.norm(P - np.array(h["translation"]), axis=1)
        j = int(np.argmin(d))
        second = float(np.partition(d, 1)[1]) if len(d) > 1 else math.inf
        rows.append({"scanIndex": h["index"], "scanPointId": ids[j], "distM": r3(d[j]), "secondM": r3(second)})
        mapping[h["index"]] = ids[j]
    unique = len(set(mapping.values())) == len(mapping)
    ok = unique and len(headers) == len(ids) and all(r["distM"] < 0.10 for r in rows)
    return mapping, rows, ok


# ---------------------------------------------------------------- A2
def load_cloud(src: Source, headers: list[dict], mapping: dict, scan_pos: dict, args) -> dict:
    want_rgb = any(h["hasRGB"] for h in headers)
    fine_xyz, fine_rgb, per_scan, counts = [], [], {}, []
    for h in headers:
        i, t0 = h["index"], time.time()
        sid = mapping[i]
        keep_check = sid in args.check_scan_set
        parts, parts_rgb, check_parts, check_rgb, raw, mean_acc = [], [], [], [], 0, np.zeros(3)
        for xyz, rgb in src.chunks(i, want_rgb):
            ok = np.isfinite(xyz).all(axis=1)
            xyz, rgb = xyz[ok], (rgb[ok] if rgb is not None else None)
            raw += len(xyz)
            mean_acc += xyz.sum(axis=0, dtype=np.float64)
            a, b = voxel_unique(xyz, args.ray_voxel, rgb)
            parts.append(a)
            parts_rgb.append(b)
            if keep_check:
                near = np.linalg.norm(xyz - scan_pos[sid], axis=1) <= 8.5
                c, cr = voxel_unique(xyz[near], 0.005, rgb[near] if rgb is not None else None)
                check_parts.append(c)
                check_rgb.append(cr)
            del xyz, rgb
        xyz = np.concatenate(parts) if parts else np.zeros((0, 3), np.float32)
        rgb = np.concatenate(parts_rgb) if want_rgb and parts_rgb and parts_rgb[0] is not None else None
        xyz, rgb = voxel_unique(xyz, args.ray_voxel, rgb)
        fine_xyz.append(xyz)
        fine_rgb.append(rgb)
        if keep_check:
            c = np.concatenate(check_parts)
            cr = np.concatenate(check_rgb) if check_rgb and check_rgb[0] is not None else None
            per_scan[sid] = voxel_unique(c, 0.005, cr)
        mean = (mean_acc / max(raw, 1)).tolist()
        counts.append({"scanIndex": i, "scanPointId": sid, "pointsRead": raw, "pointsFine": int(len(xyz)),
                       "meanXYZ": [r3(v) for v in mean],
                       "meanToTranslationM": r3(np.linalg.norm(np.array(mean) - np.array(h["translation"]))),
                       "seconds": round(time.time() - t0, 1)})
        log(f"  scan {i:02d} -> {sid}: {raw:>11,} pts -> {len(xyz):>9,} @ {args.ray_voxel} m   {time.time() - t0:5.1f} s")
        del parts, parts_rgb, check_parts, check_rgb
        gc.collect()
    xyz = np.concatenate(fine_xyz)
    rgb = np.concatenate(fine_rgb) if want_rgb and fine_rgb[0] is not None else None
    xyz, rgb = voxel_unique(xyz, args.ray_voxel, rgb)
    coarse, _ = voxel_unique(xyz, args.voxel, None)
    return {"fine": xyz, "fineRgb": rgb, "coarse": coarse, "perScan": per_scan, "counts": counts, "hasRGB": rgb is not None}


def cache_key(src: Source, args) -> str:
    p = src.e57_path or (src.npz_dir / "manifest.json")
    st = p.stat()
    return f"{p.name}|{st.st_size}|{int(st.st_mtime)}|{args.ray_voxel}|{args.voxel}|{sorted(args.check_scan_set)}"


def save_cache(cloud: dict, key: str) -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    arrays = {"fine": cloud["fine"], "coarse": cloud["coarse"], "key": np.array(key)}
    if cloud["fineRgb"] is not None:
        arrays["fineRgb"] = cloud["fineRgb"]
    for sid, (c, cr) in cloud["perScan"].items():
        arrays[f"scan__{sid}"] = c
        if cr is not None:
            arrays[f"scanrgb__{sid}"] = cr
    np.savez(CACHE / "cloud_voxel.npz", **arrays)
    (CACHE / "cloud_counts.json").write_text(json.dumps(cloud["counts"]), encoding="utf-8")


def load_cache(key: str) -> dict | None:
    f = CACHE / "cloud_voxel.npz"
    if not f.exists():
        return None
    z = np.load(f)
    if str(z["key"]) != key:
        log("  cache is for another input/voxel - rebuilding")
        return None
    per = {k[6:]: (z[k], z[f"scanrgb__{k[6:]}"] if f"scanrgb__{k[6:]}" in z else None) for k in z.files if k.startswith("scan__")}
    rgb = z["fineRgb"] if "fineRgb" in z.files else None
    counts = json.loads((CACHE / "cloud_counts.json").read_text(encoding="utf-8"))
    return {"fine": z["fine"], "fineRgb": rgb, "coarse": z["coarse"], "perScan": per, "counts": counts, "hasRGB": rgb is not None}


# ---------------------------------------------------------------- A3
W3, H3 = 2048, 1024


def render_equirect(points: np.ndarray, rgb: np.ndarray | None, origin: np.ndarray, mirror: bool = False):
    v = points.astype(np.float64) - origin
    rng = np.linalg.norm(v, axis=1)
    sel = (rng >= 0.4) & (rng <= 8.0)
    v, rng = v[sel], rng[sel]
    yaw, pitch = geom.dirs_to_yaw_pitch(v)
    if mirror:
        yaw = -yaw
    u, vv = geom.yaw_pitch_to_equirect(yaw, pitch, W3, H3)
    u = np.clip(u.astype(np.int64), 0, W3 - 1)
    vv = np.clip(vv.astype(np.int64), 0, H3 - 1)
    idx = vv * W3 + u
    zbuf = np.full(W3 * H3, np.inf)
    np.minimum.at(zbuf, idx, rng)
    win = rng <= zbuf[idx] + 1e-9
    if rgb is not None:
        val = rgb[sel][win].astype(np.float64).mean(axis=1)
        col = np.zeros((W3 * H3, 3), np.uint8)
        col[idx[win]] = rgb[sel][win]
    else:
        val = 255 * (1 - np.clip(np.log1p(rng[win]) / np.log1p(8.0), 0, 1))
        col = None
    img = np.zeros(W3 * H3)
    img[idx[win]] = val
    valid = np.isfinite(zbuf).reshape(H3, W3)
    img = img.reshape(H3, W3)
    # close splat holes from the nearest rendered pixel (max 3 px)
    dist, (iy, ix) = ndimage.distance_transform_edt(~valid, return_indices=True)
    fill = (dist <= 3) & ~valid
    img[fill] = img[iy[fill], ix[fill]]
    if col is not None:
        col = col.reshape(H3, W3, 3)
        col[fill] = col[iy[fill], ix[fill]]
    return img, col, valid | fill


def edges(gray: np.ndarray) -> np.ndarray:
    g = ndimage.gaussian_filter(gray.astype(np.float64), 1.0)
    return np.hypot(ndimage.sobel(g, 1), ndimage.sobel(g, 0))


def parabolic(c: np.ndarray, i: int) -> float:
    n = len(c)
    a, b, d = c[(i - 1) % n], c[i], c[(i + 1) % n]
    den = a - 2 * b + d
    return 0.0 if abs(den) < 1e-12 else 0.5 * (a - d) / den


def yaw_correlation(e_r: np.ndarray, e_p: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Masked normalized cross-correlation for every circular yaw shift (column shift), rows summed.

    The photo energy is normalized inside the shifted mask window, otherwise strong photo edges next to
    unrendered holes would pull the peak a few pixels sideways."""
    m = mask.astype(np.float64)
    a = np.where(mask, e_r - e_r[mask].mean(), 0.0)
    b = e_p - e_p.mean()

    def corr(x, y):  # sum over rows of sum_x x[c] * y[c + k]
        return np.fft.irfft(np.fft.rfft(y, axis=1) * np.conj(np.fft.rfft(x, axis=1)), n=W3, axis=1).sum(axis=0)

    n = m.sum()
    s1, s2 = corr(m, b), corr(m, b * b)
    var_b = np.maximum(s2 - s1 * s1 / n, 1e-12)
    return corr(a, b) / np.sqrt((a ** 2).sum() * var_b)


def ncc_shift(e_r, e_p, mask, dx: int, dy: int) -> float:
    a = np.roll(np.where(mask, e_r, 0.0), dx, axis=1)
    m = np.roll(mask, dx, axis=1)
    a, m = np.roll(a, dy, axis=0), np.roll(m, dy, axis=0)
    if dy > 0:
        m[:dy] = False
    elif dy < 0:
        m[dy:] = False
    x, y = a[m], e_p[m]
    x, y = x - x.mean(), y - y.mean()
    return float((x * y).sum() / (np.sqrt((x ** 2).sum() * (y ** 2).sum()) + 1e-12))


def reprojection_check(sid: str, pts, rgb, origin, dets_here: list[dict], out_png: Path) -> dict:
    photo_path = PANO_DIR / sid / "equirect.jpg"
    if not photo_path.exists():
        return {"scanPointId": sid, "ok": False, "reason": f"missing {photo_path}"}
    photo = Image.open(photo_path).convert("RGB").resize((W3, H3), Image.BILINEAR)
    pg = np.asarray(photo.convert("L"), dtype=np.float64)
    img, col, valid = render_equirect(pts, rgb, origin)
    rows = np.abs(90 - (np.arange(H3) + 0.5) / H3 * 180) <= 60  # skip the poles
    mask = ndimage.binary_erosion(valid, iterations=2) & rows[:, None]
    if mask.sum() < 0.05 * W3 * H3:
        return {"scanPointId": sid, "ok": False, "reason": "too few rendered pixels"}
    e_p = edges(pg)
    e_r = edges(img)
    c = yaw_correlation(e_r, e_p, mask)
    i = int(np.argmax(c))
    dx = i if i <= W3 // 2 else i - W3
    sub = parabolic(c, i)
    away = np.abs(((np.arange(W3) - i + W3 // 2) % W3) - W3 // 2) > 2 * W3 / 360 * 2  # outside ±2 deg
    peak_ratio = float(c[i] / (c[away].max() + 1e-12))
    # mirrored rendering (yaw -> -yaw) for the mirror test
    img_m, _, valid_m = render_equirect(pts, rgb, origin, mirror=True)
    mask_m = ndimage.binary_erosion(valid_m, iterations=2) & rows[:, None]
    cm = yaw_correlation(edges(img_m), e_p, mask_m)
    mirrored = bool(cm.max() > c[i] * 1.05)
    # pitch: rows shift at the best yaw shift, ±40 px
    dys = list(range(-40, 41))
    pc = np.array([ncc_shift(e_r, e_p, mask, dx, dy) for dy in dys])
    j = int(np.argmax(pc))
    sub_y = parabolic(pc, j) if 0 < j < len(dys) - 1 else 0.0
    yaw_shift = (dx + sub) * 360 / W3  # photo = render shifted right by this
    pitch_shift = -(dys[j] + sub_y) * 180 / H3  # +rows = down = negative pitch
    ok = abs(yaw_shift) < 0.5 and abs(pitch_shift) < 0.5 and not mirrored and peak_ratio > 1.1
    # 50/50 blend + detections of this scan point
    rend = Image.fromarray(col) if col is not None else Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).convert("RGB")
    blend = Image.blend(photo, rend, 0.5)
    dr = ImageDraw.Draw(blend)
    for d in dets_here:
        u, v = geom.yaw_pitch_to_equirect(d["yaw"], d["pitch"], W3, H3)
        r = 14
        dr.ellipse([u - r, v - r, u + r, v + r], outline=(34, 197, 94) if d["auto"] else (245, 158, 11), width=3)
        dr.text((u + r + 3, v - r), d["id"], fill=(255, 255, 255))
    dr.text((10, 10), f"{sid}  yaw shift {yaw_shift:+.2f} deg  pitch shift {pitch_shift:+.2f} deg  mirrored={mirrored}", fill=(255, 255, 0))
    blend.save(out_png, optimize=True)
    return {"scanPointId": sid, "ok": bool(ok), "yawShiftDeg": round(yaw_shift, 3), "pitchShiftDeg": round(pitch_shift, 3),
            "mirrored": mirrored, "peakNcc": round(float(c[i]), 4), "mirroredPeakNcc": round(float(cm.max()), 4),
            "peakRatio": round(peak_ratio, 3), "renderedFraction": round(float(mask.mean()), 3),
            "detectionsDrawn": [d["id"] for d in dets_here], "image": out_png.name}


# ---------------------------------------------------------------- A4
def near_scan_points(xy: np.ndarray, scan_xy: np.ndarray, radius: float) -> np.ndarray:
    """Mask of points within `radius` (xy) of any scan point: the scanned room, not what was seen
    far away through doors and windows (those points stretched the first run to 56 x 109 m)."""
    d, _ = cKDTree(scan_xy).query(xy, k=1, distance_upper_bound=radius)
    return np.isfinite(d)


def find_floor(z: np.ndarray, cam_z: np.ndarray | None = None) -> float:
    """Floor = densest horizontal level 0.8-2.2 m below the median camera (the scanner stands on it).
    Falls back to the lowest dense peak when the camera heights are unknown."""
    lo, hi = np.percentile(z, 0.1), np.percentile(z, 99.9)
    bins = np.arange(lo - 0.02, hi + 0.02, 0.01)
    h, e = np.histogram(z, bins)
    hs = np.convolve(h, np.ones(3) / 3, mode="same")
    thr = 0.25 * hs.max()
    peaks = [i for i in range(1, len(hs) - 1) if hs[i] >= thr and hs[i] >= hs[i - 1] and hs[i] >= hs[i + 1]]
    pick = peaks[0]
    if cam_z is not None and len(cam_z):
        top = float(np.median(cam_z))
        mids = (e[:-1] + e[1:]) / 2
        cand = [i for i in range(1, len(hs) - 1) if 0.8 <= top - mids[i] <= 2.2 and hs[i] >= hs[i - 1] and hs[i] >= hs[i + 1]]
        if cand:
            pick = max(cand, key=lambda i: hs[i])
    z0 = (e[pick] + e[pick + 1]) / 2
    near = z[np.abs(z - z0) <= 0.03]
    return float(np.median(near))


def floor_plan_layers(coarse: np.ndarray, floor_z: float, bounds: dict, cell: float, min_pts: int, width: int):
    x0, y1 = bounds["xMin"], bounds["yMax"]
    nx = int(math.ceil((bounds["xMax"] - x0) / cell))
    ny = int(math.ceil((y1 - bounds["yMin"]) / cell))

    def grid(sel):
        p = coarse[sel]
        ix = np.clip(((p[:, 0] - x0) / cell).astype(int), 0, nx - 1)
        iy = np.clip(((y1 - p[:, 1]) / cell).astype(int), 0, ny - 1)
        g = np.zeros((ny, nx), np.int32)
        np.add.at(g, (iy, ix), 1)
        return g

    z = coarse[:, 2]
    floor_g = grid(np.abs(z - floor_z) <= 0.05) >= 1
    obst_g = grid((z >= floor_z + 0.3) & (z <= floor_z + 2.0)) >= min_pts
    st = np.ones((3, 3), bool)
    floor_g = ndimage.binary_closing(floor_g, st)  # floor is sparse at grazing angles: close 1-cell gaps
    # A 1-cell opening would erase walls (a wall is 1-2 cells thick in a point cloud), so isolated
    # specks are removed by connected-component size instead, then dilated by 1 cell.
    lab, n = ndimage.label(obst_g, st)
    if n:
        sizes = np.bincount(lab.ravel())
        obst_g = (sizes >= 4)[lab] & obst_g
    obst_g = ndimage.binary_dilation(obst_g, st)
    mpp = (bounds["xMax"] - x0) / width
    height = int(round((y1 - bounds["yMin"]) / mpp))

    def up(g):
        im = Image.fromarray((g * 255).astype(np.uint8)).resize((width, height), Image.BILINEAR)
        return np.asarray(im) >= 128

    return up(floor_g), up(obst_g), mpp, height, {"cellM": cell, "gridPx": [nx, ny],
                                                 "floorCells": int(floor_g.sum()), "obstacleCells": int(obst_g.sum())}


def write_png(floor: np.ndarray, obst: np.ndarray, path: Path) -> int:
    idx = np.zeros(floor.shape, np.uint8)
    idx[floor] = 1
    idx[obst] = 2
    im = Image.fromarray(idx, mode="P")
    pal = [0, 0, 0, *FLOOR_RGBA[:3], *OBSTACLE_RGBA[:3]]
    im.putpalette(pal + [0] * (768 - len(pal)))
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, optimize=True, transparency=bytes([0, FLOOR_RGBA[3], 255]))
    return path.stat().st_size


# ---------------------------------------------------------------- A5
def raycast(tree: cKDTree, pts: np.ndarray, origin: np.ndarray, d: np.ndarray, args) -> dict | None:
    tan = math.tan(math.radians(0.6))
    ts = np.arange(0.4, 10.0 + 1e-9, 0.025)
    centers = origin + ts[:, None] * d
    radii = np.maximum(args.ray_radius, ts * tan) + 0.0125 + 1e-3
    lists = tree.query_ball_point(centers, r=radii)
    idx = np.unique(np.fromiter((j for l in lists for j in l), dtype=np.int64)) if any(len(l) for l in lists) else np.zeros(0, np.int64)
    if not len(idx):
        return None
    v = pts[idx].astype(np.float64) - origin
    t = v @ d
    perp = np.linalg.norm(v - t[:, None] * d, axis=1)
    ok = (perp < np.maximum(args.ray_radius, t * tan)) & (t >= 0.4) & (t <= 10.0)
    idx, t = idx[ok], t[ok]
    order = np.argsort(t)
    idx, t = idx[order], t[order]
    lo = np.searchsorted(t, t - 0.05, "left")
    hi = np.searchsorted(t, t + 0.05, "right")
    good = np.nonzero(hi - lo >= args.min_support)[0]
    if not len(good):
        return None
    k = good[0]
    members = pts[idx[lo[k]:hi[k]]].astype(np.float64)
    hit = np.median(members, axis=0)
    dist_t = float((hit - origin) @ d)
    if not (0.4 <= dist_t <= 8.0):
        return None
    return {"point": hit, "t": dist_t, "support": int(len(members)),
            "spread": float(np.median(np.linalg.norm(members - hit, axis=1)))}


def reference_triangulation() -> list[dict] | None:
    for exe in (["node"], ["bun"]):
        try:
            out = subprocess.run([*exe, str(HERE / "triangulate.mjs")], capture_output=True, text=True, check=True, cwd=REPO)
            return json.loads(out.stdout)
        except (OSError, subprocess.CalledProcessError, json.JSONDecodeError):
            continue
    return None


# ---------------------------------------------------------------- A6
class UnionFind:
    def __init__(self, ids, cannot: set[frozenset]):
        self.p = {i: i for i in ids}
        self.members = {i: {i} for i in ids}
        self.cannot = cannot

    def find(self, a):
        while self.p[a] != a:
            self.p[a] = self.p[self.p[a]]
            a = self.p[a]
        return a

    def union(self, a, b) -> bool:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return True
        if any(frozenset((x, y)) in self.cannot for x in self.members[ra] for y in self.members[rb]):
            return False
        self.p[rb] = ra
        self.members[ra] |= self.members.pop(rb)
        return True


def cluster_devices(dets: list[dict], located: dict, scan_pos: dict, eps: float, same_deg: float):
    ids = [d["id"] for d in dets]
    by = {d["id"]: d for d in dets}
    cannot, same = set(), []
    for i, a in enumerate(dets):
        for b in dets[i + 1:]:
            if a.get("scanPointId") != b.get("scanPointId") or a.get("yaw") is None or b.get("yaw") is None:
                continue
            ang = float(geom.angular_dist_deg(a["yaw"], a["pitch"], b["yaw"], b["pitch"]))
            if a.get("image") == b.get("image") and ang > same_deg:
                cannot.add(frozenset((a["id"], b["id"])))
            elif ang < same_deg:
                same.append((ang, a["id"], b["id"]))
    loc_ids = [k for k in ids if k in located]
    P = np.array([located[k]["point"] for k in loc_ids]) if loc_ids else np.zeros((0, 3))
    edges3d = []
    if len(P):
        tree = cKDTree(P)
        for i, j in tree.query_pairs(eps):
            edges3d.append((float(np.linalg.norm(P[i] - P[j])), loc_ids[i], loc_ids[j]))
    uf = UnionFind(ids, cannot)
    refused = 0
    for _, a, b in sorted(same) + sorted(edges3d):
        if not uf.union(a, b):
            refused += 1
    groups = {}
    for k in ids:
        groups.setdefault(uf.find(k), []).append(by[k])
    return list(groups.values()), {"cannotLinkPairs": len(cannot), "sameImageMerges": len(same),
                                   "edges3d": len(edges3d), "refusedByCannotLink": refused}


def build_devices(groups, located, scan_pos, previous: list[dict]):
    devices, unlocated = [], []
    for g in groups:
        pts = [located[d["id"]] for d in g if d["id"] in located]
        if not pts:
            for d in g:
                unlocated.append({"detectionId": d["id"], "scanPointId": d.get("scanPointId"),
                                  "reason": "no hit, single view" if len(g) == 1 else "no hit, no triangulation"})
            continue
        ray = [p for p in pts if p["method"] == "raycast"]
        use = ray or pts
        P = np.array([p["point"] for p in use])
        c = np.median(P, axis=0)
        spread = float(np.median(np.linalg.norm(P - c, axis=1)))
        best = sorted(g, key=lambda d: (-d["confidence"], float(np.linalg.norm(scan_pos[d["scanPointId"]] - c)) if d.get("scanPointId") in scan_pos else 1e9))[0]
        types = [d.get("assetTypeId") or "relay-615" for d in g]
        devices.append({
            "x": r3(c[0]), "y": r3(c[1]), "z": r3(c[2]),
            "assetTypeId": max(set(types), key=types.count),
            "status": "auto" if any(d["auto"] for d in g) else "review",
            "detectionIds": sorted((d["id"] for d in g), key=lambda s: (len(s), s)),
            "scanPointIds": sorted({d["scanPointId"] for d in g if d.get("scanPointId")}),
            "bestDetectionId": best["id"],
            "method": "raycast" if ray else "triangulation",
            "positionSpread": r3(spread),
            "confidenceMax": r3(max(d["confidence"] for d in g)),
        })
    # stable ids: reuse a previous id within 0.2 m (closest pairs first), number the rest after the highest
    used, taken = {}, set()
    pairs = sorted(((math.dist((dv["x"], dv["y"], dv["z"]), (pv["x"], pv["y"], pv["z"])), i, pv["id"])
                    for i, dv in enumerate(devices) for pv in previous), key=lambda t: t[0])
    for dist, i, pid in pairs:
        if dist <= 0.2 and i not in used and pid not in taken:
            used[i] = pid
            taken.add(pid)
    nxt = max([int(p["id"].split("-")[1]) for p in previous if p["id"].startswith("dev-")] + [0]) + 1
    order = sorted(range(len(devices)), key=lambda i: (-devices[i]["x"], devices[i]["y"], devices[i]["z"]))
    for i in order:
        if i not in used:
            used[i] = f"dev-{nxt:02d}"
            nxt += 1
    out = [{"id": used[i], **devices[i]} for i in range(len(devices))]
    out.sort(key=lambda d: d["id"])
    unlocated.sort(key=lambda u: (len(u["detectionId"]), u["detectionId"]))
    return out, unlocated


# ---------------------------------------------------------------- A8
def draw_check(base_png: Path, fp: dict, ref: list[dict], rays: list[tuple], out: Path) -> None:
    plan = Image.open(base_png).convert("RGBA")
    im = Image.new("RGBA", plan.size, (255, 255, 255, 255))
    im.alpha_composite(plan)
    dr = ImageDraw.Draw(im)
    try:
        font = ImageFont.truetype("arial.ttf", 14)
    except OSError:
        font = ImageFont.load_default()
    b, mpp = fp["bounds"], fp["metersPerPixel"]
    px = lambda x, y: tuple(float(v) for v in geom.world_to_px(x, y, b, mpp))  # noqa: E731
    for o, h in rays:
        dr.line([px(o[0], o[1]), px(h[0], h[1])], fill=(37, 99, 235, 200), width=2)
    for s in fp["scanPoints"]:
        x, y = px(s["x"], s["y"])
        dr.ellipse([x - 5, y - 5, x + 5, y + 5], fill=(100, 116, 139, 255))
        dr.text((x + 7, y - 7), s["id"].replace("scan-", ""), fill=(51, 65, 85, 255), font=font)
    for c in ref:
        if c["position"]:
            x, y = px(c["position"][0], c["position"][1])
            dr.line([x - 6, y - 6, x + 6, y + 6], fill=(15, 23, 42, 255), width=2)
            dr.line([x - 6, y + 6, x + 6, y - 6], fill=(15, 23, 42, 255), width=2)
    for d in fp["devices"]:
        x, y = px(d["x"], d["y"])
        col = (34, 197, 94, 255) if d["status"] == "auto" else (245, 158, 11, 255)
        dr.ellipse([x - 9, y - 9, x + 9, y + 9], fill=col, outline=(255, 255, 255, 255), width=2)
        dr.text((x + 11, y + 2), f"{d['id']} z={d['z']:.2f}", fill=(15, 23, 42, 255), font=font)
    im.convert("RGB").save(out, optimize=True)


# ---------------------------------------------------------------- main
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src_g = ap.add_mutually_exclusive_group(required=True)
    src_g.add_argument("--e57", type=Path)
    src_g.add_argument("--npz-dir", type=Path, help="folder written by export_e57.py (scan_XX.npz + manifest.json)")
    ap.add_argument("--voxel", type=float, default=0.04, help="voxel of the floor plan cloud (m)")
    ap.add_argument("--ray-voxel", type=float, default=0.01, help="voxel of the cloud the rays are cast into (m)")
    ap.add_argument("--width", type=int, default=1600)
    ap.add_argument("--cache", action="store_true", help="save/reuse the voxelized cloud in cache/cloud_voxel.npz")
    ap.add_argument("--reader", choices=["read_scan", "chunked"], default="read_scan")
    ap.add_argument("--check-scans", default="scan-01,scan-07,scan-12")
    ap.add_argument("--ray-radius", type=float, default=0.03)
    ap.add_argument("--min-support", type=int, default=8)
    ap.add_argument("--eps", type=float, default=0.15)
    ap.add_argument("--obstacle-min-points", type=int, default=3)
    ap.add_argument("--roi-radius", type=float, default=4.0,
                    help="floor plan covers points within this xy distance (m) of a scan point")
    ap.add_argument("--headers-only", action="store_true", help="stage 0: print scan headers + pairing and stop")
    ap.add_argument("--report-dir", type=Path, default=HERE, help="where report.json and check*.png go")
    ap.add_argument("--pano-dir", type=Path, default=None, help="equirect.jpg folders for A3 (selftest only)")
    ap.add_argument("--skip-reprojection-gate", action="store_true",
                    help="debug/synthetic data only: never publishes, outputs go to cache/rejected/")
    args = ap.parse_args()

    t_start = time.time()
    global PANO_DIR, REJECTED
    PANO_DIR = args.pano_dir or PANO_DIR
    REJECTED = CACHE / "rejected" if args.report_dir == HERE else args.report_dir / "rejected"
    args.report_dir.mkdir(parents=True, exist_ok=True)
    pano, scan_pos, dets = load_inputs()
    report: dict = {"generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "gates": {}, "notes": []}
    src = Source(args.e57, args.npz_dir, args.reader)
    report["notes"] += src.notes

    def finish(code: int) -> int:
        report["notes"] += [n for n in src.notes if n not in report["notes"]]
        report["peakMemoryMB"] = peak_memory_mb()
        report["seconds"] = round(time.time() - t_start, 1)
        (args.report_dir / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        log(f"\nreport.json written ({'OK' if code == 0 else f'exit {code}'})")
        return code

    # ---- stage 0 / A0
    headers = [src.header(i) for i in range(src.count)]
    log(f"{src.name}: {src.count} scans")
    for h in headers:
        log(f"  scan {h['index']:02d} {str(h['name'])[:20]:20s} pts={h['points']}  rgb={h['hasRGB']} intensity={h['hasIntensity']}"
            f"  t={[round(v, 3) for v in h['translation']]}  q(wxyz)={[round(v, 4) for v in h['rotation_wxyz']]}")
    report["scans"] = headers
    mapping, rows, a0 = pair_scans(headers, scan_pos)
    report["A0_pairing"] = rows
    report["gates"]["A0"] = a0
    for r in rows:
        log(f"  scan {r['scanIndex']:02d} -> {r['scanPointId']}  {r['distM']:.3f} m (next {r['secondM']:.3f} m)")
    if not a0:
        log("A0 FAILED: scans could not be paired 1:1 with panoramas.json within 0.10 m - stopping.")
        return finish(2)
    if args.headers_only:
        return finish(0)

    # ---- A2
    args.check_scan_set = set(args.check_scans.split(","))
    tag_dets = pick_tag_checks(dets, args.check_scan_set)
    args.check_scan_set |= {d["scanPointId"] for d in tag_dets}
    key = cache_key(src, args)
    cloud = load_cache(key) if args.cache else None
    if cloud is None:
        log(f"Reading points (fine voxel {args.ray_voxel} m, plan voxel {args.voxel} m)...")
        cloud = load_cloud(src, headers, mapping, scan_pos, args)
        if args.cache:
            save_cache(cloud, key)
    else:
        log("Using cache/cloud_voxel.npz")
    fine, coarse = cloud["fine"], cloud["coarse"]
    raw_total = sum(c["pointsRead"] for c in cloud["counts"])
    report["A2_cloud"] = {"pointsRead": raw_total, "pointsFine": int(len(fine)), "pointsCoarse": int(len(coarse)),
                          "rayVoxelM": args.ray_voxel, "planVoxelM": args.voxel, "hasRGB": cloud["hasRGB"],
                          "perScan": cloud["counts"]}
    log(f"  total {raw_total:,} -> {len(fine):,} (fine) -> {len(coarse):,} (plan)")

    # ---- A3
    a3 = []
    for sid in sorted(args.check_scan_set):
        pts, rgb = cloud["perScan"][sid]
        here = [d for d in tag_dets if d["scanPointId"] == sid] or [d for d in dets if d.get("scanPointId") == sid and d["auto"]][:3]
        res = reprojection_check(sid, pts, rgb, scan_pos[sid], here, args.report_dir / f"check_reprojection_{sid}.png")
        res["gate"] = sid in set(args.check_scans.split(","))
        a3.append(res)
        log(f"  A3 {sid}: {res}")
    report["A3_reprojection"] = a3
    a3_ok = all(r["ok"] for r in a3 if r["gate"])
    report["gates"]["A3"] = a3_ok
    report["A3_tagChecks"] = [{"detectionId": d["id"], "scanPointId": d["scanPointId"]} for d in tag_dets]
    if not a3_ok and not args.skip_reprojection_gate:
        log("A3 FAILED: the point cloud does not line up with the panoramas. Fix geom.py (see report.json) - stopping.")
        return finish(3)

    # ---- A4 floor + bounds (only the scanned room: points near the scan points)
    S = np.array([[p[0], p[1]] for p in scan_pos.values()])
    cam_z = np.array([p[2] for p in scan_pos.values()])
    room = coarse[near_scan_points(coarse[:, :2], S, args.roi_radius)]
    floor_z = find_floor(room[near_scan_points(room[:, :2], S, 1.5), 2], cam_z)
    cam_h = {k: r3(v[2] - floor_z) for k, v in scan_pos.items()}
    report["A4_floor"] = {"floorZ": r3(floor_z), "cameraHeightAboveFloor": cam_h,
                          "cameraHeightOutside1to1_8": [k for k, h in cam_h.items() if not 1.0 <= h <= 1.8]}
    log(f"  floor z = {floor_z:.3f}; camera heights outside 1.0-1.8 m: {report['A4_floor']['cameraHeightOutside1to1_8']}")
    fl = room[np.abs(room[:, 2] - floor_z) <= 0.05]
    lo, hi = np.percentile(fl[:, :2], 0.5, axis=0), np.percentile(fl[:, :2], 99.5, axis=0)
    lo, hi = np.minimum(lo, S.min(0)), np.maximum(hi, S.max(0))

    # ---- A5 rays
    log("Casting detection rays...")
    tree = cKDTree(fine)
    ray_hits, located = {}, {}
    for d in dets:
        if d.get("scanPointId") not in scan_pos or d.get("yaw") is None:
            continue
        o = scan_pos[d["scanPointId"]]
        dv = geom.yaw_pitch_to_dirs(d["yaw"], d["pitch"])
        h = raycast(tree, fine, o, dv, args)
        if h:
            h["heightAboveFloor"] = h["point"][2] - floor_z
            h["flag"] = None if 1.2 <= h["heightAboveFloor"] <= 2.0 else "height outside 1.2-2.0 m"
            ray_hits[d["id"]] = h
            located[d["id"]] = {"point": h["point"], "method": "raycast"}
    ref = reference_triangulation()
    tri = {}
    if ref is None:
        report["notes"].append("triangulation reference unavailable (node/bun not found)")
        ref = []
    for c in ref:
        if c["position"]:
            for m in c["members"]:
                tri[m] = np.array(c["position"])
    for k, p in tri.items():
        if k not in located:
            located[k] = {"point": p, "method": "triangulation"}
    cross = [float(np.linalg.norm(ray_hits[k]["point"] - tri[k])) for k in ray_hits if k in tri]
    auto_ids = [d["id"] for d in dets if d["auto"]]
    hit_rate_auto = sum(k in ray_hits for k in auto_ids) / max(len(auto_ids), 1)
    med_cross = float(np.median(cross)) if cross else None
    report["A5_rays"] = {
        "detections": len(dets), "raycastHits": len(ray_hits), "hitRateAuto": round(hit_rate_auto, 3),
        "triangulatedFallback": sum(1 for v in located.values() if v["method"] == "triangulation"),
        "medianRaycastVsTriangulationM": r3(med_cross) if med_cross is not None else None,
        "maxRaycastVsTriangulationM": r3(max(cross)) if cross else None,
        "perDetection": {k: {"t": r3(h["t"]), "support": h["support"], "spread": r3(h["spread"]),
                             "xyz": [r3(v) for v in h["point"]], "flag": h["flag"],
                             "vsTriangulationM": r3(np.linalg.norm(h["point"] - tri[k])) if k in tri else None}
                         for k, h in ray_hits.items()},
        "noHit": sorted((d["id"] for d in dets if d["id"] not in ray_hits), key=lambda s: (len(s), s)),
    }
    a5 = hit_rate_auto >= 0.8 and med_cross is not None and med_cross < 0.10
    report["gates"]["A5"] = a5
    log(f"  raycast hits {len(ray_hits)}/{len(dets)} (auto {hit_rate_auto:.0%}), median ray vs triangulation {med_cross}")

    # ---- A6 devices
    previous = []
    if OUT_JSON.exists():
        try:
            previous = json.loads(OUT_JSON.read_text(encoding="utf-8")).get("devices", [])
        except json.JSONDecodeError:
            pass
    groups, cstats = cluster_devices(dets, located, scan_pos, args.eps, 3.0)
    devices, unlocated = build_devices(groups, located, scan_pos, previous)
    dev_of = {k: dv["id"] for dv in devices for k in dv["detectionIds"]}
    # every multi-view reference cluster must map to its own device (row of 5 + the stacked pair)
    ref_map = []
    for c in ref:
        if not c["position"]:
            continue
        got = [dev_of.get(m) for m in c["members"] if dev_of.get(m)]
        maj = max(set(got), key=got.count) if got else None
        ref_map.append({"position": [r3(v) for v in c["position"]], "views": len(c["members"]), "device": maj,
                        "agreement": round(got.count(maj) / len(c["members"]), 2) if maj else 0})
    majors = [r["device"] for r in ref_map if r["device"]]
    a6 = len(majors) == len(set(majors)) == len(ref_map)
    report["A6_clusters"] = {**cstats, "devices": len(devices), "referenceMapping": ref_map,
                             "groups": [{"id": d["id"], "xyz": [d["x"], d["y"], d["z"]], "members": d["detectionIds"],
                                         "spread": d["positionSpread"], "method": d["method"]} for d in devices]}
    report["gates"]["A6"] = a6
    log(f"  {len(devices)} devices, {len(unlocated)} unlocated; reference clusters 1:1 -> {a6}")

    # ---- A4 image (bounds include every device)
    D = np.array([[d["x"], d["y"]] for d in devices]) if devices else S[:1]
    lo, hi = np.minimum(lo, D.min(0)) - 0.3, np.maximum(hi, D.max(0)) + 0.3
    bounds = {"xMin": r3(lo[0]), "xMax": r3(hi[0]), "yMin": r3(lo[1]), "yMax": r3(hi[1])}
    inside = room[(room[:, 0] >= lo[0]) & (room[:, 0] <= hi[0]) & (room[:, 1] >= lo[1]) & (room[:, 1] <= hi[1])]
    floor_m, obst_m, mpp, height, layer_info = floor_plan_layers(inside, floor_z, bounds, args.voxel, args.obstacle_min_points, args.width)
    spx = [geom.world_to_px(p[0], p[1], bounds, mpp) for p in scan_pos.values()]
    # a scan point is blocked only if most of a 0.25 m disc around it is obstacle: the scanner's own
    # tripod, seen from the neighbouring scans, marks a few pixels right at every scan position
    r_px = max(1, int(round(0.25 / mpp)))
    yy, xx = np.mgrid[-r_px:r_px + 1, -r_px:r_px + 1]
    disc = (xx * xx + yy * yy) <= r_px * r_px

    def is_blocked(x: float, y: float) -> bool:
        cy, cx = int(y), int(x)
        y0, y1, x0, x1 = cy - r_px, cy + r_px + 1, cx - r_px, cx + r_px + 1
        if y0 < 0 or x0 < 0 or y1 > height or x1 > args.width:
            return bool(obst_m[min(max(cy, 0), height - 1), min(max(cx, 0), args.width - 1)])
        return float(obst_m[y0:y1, x0:x1][disc].mean()) > 0.5

    blocked = [k for k, (x, y) in zip(scan_pos, spx) if is_blocked(x, y)]
    walk_ok = len(blocked) / len(scan_pos) < 0.05
    report["A4_floor"].update({"bounds": bounds, "metersPerPixel": round(mpp, 6), "sizePx": [args.width, height],
                               "layers": layer_info, "scanPointsOnObstacle": blocked})
    report["gates"]["walkway"] = walk_ok

    out_dir_ok = all(report["gates"].values()) and not args.skip_reprojection_gate
    out_png = OUT_PNG if out_dir_ok else REJECTED / "floorplan.png"
    out_json = OUT_JSON if out_dir_ok else REJECTED / "floorplan.json"
    png_bytes = write_png(floor_m, obst_m, out_png)

    # ---- A7
    stats = {"detections": len(dets), "raycastHits": len(ray_hits),
             "triangulated": sum(1 for d in devices if d["method"] == "triangulation"),
             "unlocated": len(unlocated), "medianRaycastVsTriangulationM": r3(med_cross) if med_cross is not None else None,
             "devices": len(devices), "devicesWithAuto": sum(d["status"] == "auto" for d in devices)}
    fp = {
        "version": 1,
        "generatedAt": report["generatedAt"],
        "source": {"e57": src.name, "detectionsSha1": sha1_12(DETECTIONS), "voxel": args.voxel, "rayVoxel": args.ray_voxel},
        "frame": "panoramas.json world frame (z up, metres); px=(x-xMin)/mpp, py=(yMax-y)/mpp",
        "image": "/floorplan/floorplan.png",
        "widthPx": args.width, "heightPx": height,
        "bounds": bounds,
        "metersPerPixel": round(mpp, 6),
        "floorZ": r3(floor_z),
        "scanPoints": [{"id": p["scanPointId"], "x": r3(p["position"][0]), "y": r3(p["position"][1])} for p in pano],
        "devices": devices,
        "unlocated": unlocated,
        "stats": stats,
    }
    out_json.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(fp, indent=1) + "\n"
    out_json.write_text(text, encoding="utf-8")
    sizes_ok = png_bytes < 1_000_000 and len(text.encode()) < 100_000
    report["gates"]["sizes"] = sizes_ok
    report["sizes"] = {"pngKB": round(png_bytes / 1024, 1), "jsonKB": round(len(text.encode()) / 1024, 1)}

    # ---- A8
    sample = sample_rays(devices, ray_hits, scan_pos, {d["id"]: d for d in dets})
    draw_check(out_png, fp, ref, sample, args.report_dir / "check.png")
    report["stats"] = stats
    published = all(report["gates"].values()) and not args.skip_reprojection_gate
    if out_dir_ok and not published:  # a late gate (sizes) failed after writing: move to rejected/
        REJECTED.mkdir(parents=True, exist_ok=True)
        os.replace(out_png, REJECTED / "floorplan.png")
        os.replace(out_json, REJECTED / "floorplan.json")
    report["published"] = published
    log(f"\nGates: {report['gates']}  ->  {'PUBLISHED' if published else 'NOT published (cache/rejected/)'}")
    log(f"  {stats}")
    return finish(0 if published else 4)


def pick_tag_checks(dets: list[dict], prefer: set[str], n: int = 5) -> list[dict]:
    """n auto detections from different scan points (preferring the A3 scans) for the visual tag check."""
    out, seen = [], set()
    pool = sorted((d for d in dets if d["auto"] and d.get("scanPointId")),
                  key=lambda d: (d["scanPointId"] not in prefer, -d["confidence"]))
    for d in pool:
        if d["scanPointId"] not in seen:
            out.append(d)
            seen.add(d["scanPointId"])
        if len(out) == n:
            break
    return out


def sample_rays(devices, ray_hits, scan_pos, by_id, n: int = 8):
    """Up to n example rays from different scan points; always includes both devices of a vertical stack."""
    stacked = set()
    for i, a in enumerate(devices):
        for b in devices[i + 1:]:
            if math.hypot(a["x"] - b["x"], a["y"] - b["y"]) < 0.25:
                stacked |= {a["id"], b["id"]}
    order = sorted(devices, key=lambda d: d["id"] not in stacked)
    out, scans = [], set()
    for d in order:
        for k in d["detectionIds"]:
            s = by_id[k].get("scanPointId")
            if k in ray_hits and s not in scans:
                out.append((scan_pos[s], ray_hits[k]["point"]))
                scans.add(s)
                break
        if len(out) >= n:
            break
    return out


if __name__ == "__main__":
    sys.exit(main())
