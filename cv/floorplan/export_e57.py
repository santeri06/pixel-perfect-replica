"""Split a large E57 point cloud into small per-scan files that can be shared/staged (< 400 MB each).

Usage:
    python export_e57.py <cloud.e57> <out_dir> [--voxel 0.02]

Writes to <out_dir>:
    manifest.json        scan count, per-scan header pose (translation, rotation w,x,y,z), point counts, fields
    scan_XX.npz          xyz (float32, world frame, voxel-downsampled), rgb (uint8, if present),
                         intensity (float16, if present)
The point coordinates are read with transform=True (world frame), same as cv/extract_e57.py poses.
"""
import argparse
import gc
import json
import sys
import time
from pathlib import Path

import numpy as np
import pye57


def voxel_keep(xyz: np.ndarray, voxel: float) -> np.ndarray:
    """Indices of one point per voxel (first occurrence)."""
    k = np.floor(xyz / voxel).astype(np.int64) + (1 << 20)
    key = (k[:, 0] << 42) | (k[:, 1] << 21) | k[:, 2]
    _, idx = np.unique(key, return_index=True)
    return np.sort(idx)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("e57")
    ap.add_argument("out_dir")
    ap.add_argument("--voxel", type=float, default=0.02)
    a = ap.parse_args()

    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    e57 = pye57.E57(a.e57)
    n = e57.scan_count
    print(f"{n} scans in {a.e57}")
    manifest = {"source": Path(a.e57).name, "voxel": a.voxel, "frame": "E57 world (transform=True)", "scans": []}

    for i in range(n):
        t0 = time.time()
        h = e57.get_header(i)
        fields = list(h.point_fields)
        has_rgb = "colorRed" in fields
        has_int = "intensity" in fields
        try:
            d = e57.read_scan(i, ignore_missing_fields=True, colors=has_rgb, intensity=has_int, transform=True)
        except Exception as ex:  # noqa: BLE001
            print(f"  scan {i}: read failed ({ex}); retrying without colors/intensity")
            d = e57.read_scan(i, ignore_missing_fields=True, transform=True)
            has_rgb = has_int = False
        xyz = np.stack([d["cartesianX"], d["cartesianY"], d["cartesianZ"]], axis=1).astype(np.float32)
        ok = np.isfinite(xyz).all(axis=1)
        if "cartesianInvalidState" in d:
            ok &= np.asarray(d["cartesianInvalidState"]) == 0
        raw = int(len(xyz))
        xyz = xyz[ok]
        keep = voxel_keep(xyz, a.voxel)
        arrays = {"xyz": xyz[keep]}
        if has_rgb:
            rgb = np.stack([d["colorRed"], d["colorGreen"], d["colorBlue"]], axis=1)[ok][keep]
            if rgb.max() > 255:
                rgb = rgb / 256.0
            arrays["rgb"] = rgb.astype(np.uint8)
        if has_int:
            arrays["intensity"] = np.asarray(d["intensity"])[ok][keep].astype(np.float16)
        path = out / f"scan_{i:02d}.npz"
        np.savez_compressed(path, **arrays)
        entry = {
            "index": i,
            "name": getattr(h, "name", f"scan {i}"),
            "file": path.name,
            "translation": [float(v) for v in h.translation],
            "rotation_wxyz": [float(v) for v in h.rotation],
            "pointsRaw": raw,
            "pointsValid": int(ok.sum()),
            "pointsKept": int(len(keep)),
            "fields": fields,
            "hasRGB": has_rgb,
            "hasIntensity": has_int,
            "mean": [float(v) for v in arrays["xyz"].mean(axis=0)],
            "sizeMB": round(path.stat().st_size / 1e6, 1),
        }
        manifest["scans"].append(entry)
        print(f"  scan {i:02d}: {raw:>10,} -> {len(keep):>9,} pts  {entry['sizeMB']:>6} MB  "
              f"t={[round(v, 2) for v in entry['translation']]}  {time.time() - t0:.0f}s")
        del d, xyz, arrays, keep, ok
        gc.collect()

    (out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    total = sum(s["sizeMB"] for s in manifest["scans"])
    print(f"\nDone: {n} files, {total:.0f} MB total -> {out}")
    if max(s["sizeMB"] for s in manifest["scans"]) > 390:
        print("WARNING: a file is over 390 MB - rerun with a larger --voxel (e.g. 0.03)", file=sys.stderr)


if __name__ == "__main__":
    main()
