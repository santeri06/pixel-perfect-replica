"""Export a compact 3D occupancy grid of the room for the 3D floor plan (no E57 needed).

Reads the voxelised cloud that build_floorplan.py cached (cache/cloud_voxel.npz, world frame,
1 cm voxels) and the floor plan frame (src/data/floorplan.json), and writes room_grid.npz:

    counts   (ny, nx, nz) uint8   points per 4 cm x 4 cm x 5 cm cell (clipped at 255)
    floorRgb (ny, nx, 3)  uint8   mean colour of the floor band (floor +- 4 cm), 0 if no points
    floorN   (ny, nx)     uint16  points in the floor band
    midRgb   (ny, nx, 3)  uint8   mean colour of the equipment band (floor + 0.3 ... 2.0 m)
    midN     (ny, nx)     uint16  points in the equipment band
    meta                  json    cell, dz, x0 (= bounds.xMin), y1 (= bounds.yMax), z0, floorZ, bounds

Grid row 0 is the top of the floor plan image (world yMax), column 0 its left edge (world xMin),
so a cell maps 1:1 onto floorplan.png. Usage (PowerShell, in cv\\floorplan, venv python):

    .\\.venv\\Scripts\\python.exe export_room_grid.py
"""
import json
import math
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
CACHE = HERE / "cache" / "cloud_voxel.npz"
PLAN = ROOT / "src" / "data" / "floorplan.json"
OUT = HERE / "room_grid.npz"

CELL = 0.04          # m, same as the floor plan layers
DZ = 0.05            # m, vertical bin
BELOW = 0.10         # m below the floor included
HEIGHT = 4.50        # m above the floor included
CHUNK = 2_000_000


def to_u8(rgb: np.ndarray) -> np.ndarray:
    rgb = np.asarray(rgb)
    if rgb.dtype == np.uint8:
        return rgb
    rgb = rgb.astype(np.float32)
    if rgb.max(initial=0) > 255:
        rgb = rgb / 256.0
    return np.clip(rgb, 0, 255).astype(np.uint8)


def main() -> int:
    t0 = time.time()
    if not CACHE.exists():
        print(f"Not found: {CACHE}\nRun run_floorplan.ps1 (or build_floorplan.py --cache) once first.")
        return 1
    if not PLAN.exists():
        print(f"Not found: {PLAN}")
        return 1
    plan = json.loads(PLAN.read_text(encoding="utf-8"))
    b, floor_z = plan["bounds"], float(plan["floorZ"])
    x0, y1 = float(b["xMin"]), float(b["yMax"])
    nx = int(math.ceil((float(b["xMax"]) - x0) / CELL))
    ny = int(math.ceil((y1 - float(b["yMin"])) / CELL))
    z0 = floor_z - BELOW
    nz = int(math.ceil((BELOW + HEIGHT) / DZ))
    print(f"grid {nx} x {ny} x {nz} cells ({CELL} m, {DZ} m), floor z = {floor_z:.3f}")

    print(f"loading {CACHE.name} ...")
    data = np.load(CACHE, allow_pickle=False)
    pts = data["fine"]
    rgb = data["fineRgb"] if "fineRgb" in data.files else None
    print(f"  {len(pts):,} points, colours: {rgb is not None}")

    ncell = nx * ny
    counts = np.zeros(ncell * nz, np.int64)
    sums = {k: np.zeros((ncell, 3), np.float64) for k in ("floor", "mid")}
    ns = {k: np.zeros(ncell, np.int64) for k in ("floor", "mid")}
    for s in range(0, len(pts), CHUNK):
        p = np.asarray(pts[s:s + CHUNK], dtype=np.float64)
        ix = np.floor((p[:, 0] - x0) / CELL).astype(np.int64)
        iy = np.floor((y1 - p[:, 1]) / CELL).astype(np.int64)
        iz = np.floor((p[:, 2] - z0) / DZ).astype(np.int64)
        ok = (ix >= 0) & (ix < nx) & (iy >= 0) & (iy < ny) & (iz >= 0) & (iz < nz)
        cell = iy[ok] * nx + ix[ok]
        counts += np.bincount(cell * nz + iz[ok], minlength=ncell * nz)
        if rgb is not None:
            c = to_u8(rgb[s:s + CHUNK])[ok].astype(np.float64)
            h = p[ok, 2] - floor_z
            for key, sel in (("floor", np.abs(h) <= 0.04), ("mid", (h >= 0.3) & (h <= 2.0))):
                ns[key] += np.bincount(cell[sel], minlength=ncell)
                for ch in range(3):
                    sums[key][:, ch] += np.bincount(cell[sel], weights=c[sel, ch], minlength=ncell)
        print(f"  {min(s + CHUNK, len(pts)):>11,} / {len(pts):,}", end="\r")
    print()

    def mean_rgb(key):
        n = np.maximum(ns[key], 1)[:, None]
        return np.clip(sums[key] / n, 0, 255).astype(np.uint8).reshape(ny, nx, 3)

    meta = {"cell": CELL, "dz": DZ, "x0": x0, "y1": y1, "z0": z0, "floorZ": floor_z, "nx": nx, "ny": ny, "nz": nz,
            "bounds": b, "source": "cache/cloud_voxel.npz (fine, 1 cm)", "points": int(len(pts))}
    np.savez_compressed(
        OUT,
        counts=np.clip(counts, 0, 255).astype(np.uint8).reshape(ny, nx, nz),
        floorRgb=mean_rgb("floor"), floorN=np.clip(ns["floor"], 0, 65535).astype(np.uint16).reshape(ny, nx),
        midRgb=mean_rgb("mid"), midN=np.clip(ns["mid"], 0, 65535).astype(np.uint16).reshape(ny, nx),
        meta=np.array(json.dumps(meta)),
    )
    occupied = int((counts > 0).sum())
    print(f"wrote {OUT} ({OUT.stat().st_size / 1e6:.1f} MB), {occupied:,} occupied cells, {time.time() - t0:.0f} s")
    print("Valmis - kerro Claudelle.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
