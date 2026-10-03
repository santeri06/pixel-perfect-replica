"""Build the 3D room layout for the floor plan page (src/data/floorplan3d.json).

Input (read only):
  src/data/floorplan.json         frame (bounds, floorZ) and the relay positions
  src/data/panoramas.json         scan point positions (relay facing direction)
  cv/floorplan/room_grid.npz      3D occupancy grid from export_room_grid.py (preferred)
  public/floorplan/floorplan.png  fallback when room_grid.npz is missing: obstacles at one height

Output: src/data/floorplan3d.json
  floor   [{outer, holes}]                    floor slab polygons (world metres, x/y)
  solids  [{kind, height, outer, holes}]      extruded room geometry
          kind: "wall" (full height partitions), "equipment" (cabinets, switchgear), "low" (< 0.6 m)
  devices {id: {facing: [nx, ny], top}}       facing = horizontal direction to the scan points that
                                              saw the relay; top = height of what it is mounted on
Nothing is hand-drawn: every polygon comes from the point cloud occupancy.

    python build_layout3d.py            # uses room_grid.npz if present
    python build_layout3d.py --from-png # force the floorplan.png fallback
"""
import argparse
import json
import math
from pathlib import Path

import cv2
import numpy as np
from scipy import ndimage

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
PLAN = ROOT / "src" / "data" / "floorplan.json"
PANOS = ROOT / "src" / "data" / "panoramas.json"
GRID = HERE / "room_grid.npz"
PNG = ROOT / "public" / "floorplan" / "floorplan.png"
OUT = ROOT / "src" / "data" / "floorplan3d.json"

WALL_MIN = 2.35      # a column reaching this height (to the cap) is a wall / full-height partition
CAP = 2.60           # columns are cut here: cable trays and lights under the ceiling are not walls
LOW_MAX = 0.60       # below this a solid is a low object (boxes, plinths)
LEVEL = 0.10         # height quantisation step (m)
MIN_AREA = 0.02      # m2, smaller solids are noise


def r3(v: float) -> float:
    return round(float(v), 3)


# ---------------------------------------------------------------- grid -> per-cell solid height
def heights_from_grid(path: Path, floor_z: float):
    d = np.load(path, allow_pickle=False)
    meta = json.loads(str(d["meta"]))
    counts = d["counts"].astype(np.int32)
    cell, dz, z0 = meta["cell"], meta["dz"], meta["z0"]
    nz = counts.shape[2]
    zc = z0 + (np.arange(nz) + 0.5) * dz - floor_z            # bin centre height above the floor
    occ = counts >= 2

    # floor = points in the floor band
    floor_m = (counts[:, :, np.abs(zc) <= 0.05].sum(axis=2) >= 2)

    band = (zc >= 0.12) & (zc <= CAP)
    low_band = (zc >= 0.12) & (zc <= 1.0)
    any_m = occ[:, :, band].any(axis=2)
    low_m = occ[:, :, low_band].any(axis=2)
    # top of the solid: highest occupied bin up to the cap
    idx = np.where(band)[0]
    ob = occ[:, :, idx]
    has = ob.any(axis=2)
    last = len(idx) - 1 - np.argmax(ob[:, :, ::-1], axis=2)
    top = np.where(has, zc[idx[last]] + dz / 2, 0.0)

    # keep only solids that stand on something: components of any_m with enough low support
    # (hanging cables and trays have none). Cabinet interiors only show their top surface, so
    # support is judged per component, not per cell.
    lab, n = ndimage.label(ndimage.binary_closing(any_m, iterations=1))
    if n:
        sup = ndimage.sum(low_m, lab, index=np.arange(1, n + 1))
        size = ndimage.sum(np.ones_like(lab), lab, index=np.arange(1, n + 1))
        keep = np.zeros(n + 1, bool)
        keep[1:] = (sup >= 6) & (sup / np.maximum(size, 1) >= 0.08)
        solid = keep[lab] & any_m
    else:
        solid = any_m
    info = {"source": "room_grid.npz", "cell": cell, "points": meta.get("points")}
    return cell, meta["x0"], meta["y1"], floor_m, solid, top, info


def heights_from_png(path: Path, plan: dict, cell: float = 0.04):
    from PIL import Image

    a = np.array(Image.open(path).convert("RGBA"))
    obst = (a[:, :, 3] > 200) & (a[:, :, 0] < 100)
    floor = (a[:, :, 3] > 30) & ~obst
    mpp = plan["metersPerPixel"]
    f = cell / mpp
    ny, nx = int(round(a.shape[0] / f)), int(round(a.shape[1] / f))
    obst_c = cv2.resize(obst.astype(np.uint8) * 255, (nx, ny), interpolation=cv2.INTER_AREA) > 100
    floor_c = cv2.resize(floor.astype(np.uint8) * 255, (nx, ny), interpolation=cv2.INTER_AREA) > 100
    top = np.where(obst_c, 2.0, 0.0)
    b = plan["bounds"]
    info = {"source": "floorplan.png (no heights: obstacles drawn at 2.0 m)", "cell": cell}
    return cell, b["xMin"], b["yMax"], floor_c, obst_c, top, info


# ---------------------------------------------------------------- mask -> polygons
def polygons(mask: np.ndarray, cell: float, x0: float, y1: float, eps_cells: float = 0.9):
    """Rectilinear-ish polygons with holes (world x/y) of a boolean cell mask."""
    up = cv2.resize(mask.astype(np.uint8), None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)
    up = np.pad(up, 1)
    cnts, hier = cv2.findContours(up, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if hier is None:
        return []
    hier = hier[0]
    out = []

    def ring(c):
        c = cv2.approxPolyDP(c, eps_cells * 2, True)[:, 0, :].astype(np.float64)
        if len(c) < 3:
            return None
        # back to cell units: contour runs through pixel centres of the 2x mask -> cell edges
        u = (c[:, 0] - 1 + 0.5) / 2.0
        v = (c[:, 1] - 1 + 0.5) / 2.0
        return [[r3(x0 + ui * cell), r3(y1 - vi * cell)] for ui, vi in zip(u, v)]

    for i, c in enumerate(cnts):
        if hier[i][3] != -1:
            continue  # holes are attached to their parent
        outer = ring(c)
        if outer is None or abs(cv2.contourArea(c)) / 4 * cell * cell < MIN_AREA:
            continue
        holes = []
        j = hier[i][2]
        while j != -1:
            if abs(cv2.contourArea(cnts[j])) / 4 * cell * cell >= MIN_AREA:
                h = ring(cnts[j])
                if h:
                    holes.append(h)
            j = hier[j][0]
        out.append({"outer": outer, "holes": holes})
    return out


def clean(mask: np.ndarray, cell: float, open_it=1, close_it=1) -> np.ndarray:
    m = ndimage.binary_opening(mask, iterations=open_it) if open_it else mask
    m = ndimage.binary_closing(m, iterations=close_it) if close_it else m
    lab, n = ndimage.label(m)
    if n:
        size = ndimage.sum(m, lab, index=np.arange(1, n + 1)) * cell * cell
        keep = np.zeros(n + 1, bool)
        keep[1:] = size >= MIN_AREA
        m = keep[lab]
    return m


def components(mask: np.ndarray, cell: float):
    lab, n = ndimage.label(mask)
    for i in range(1, n + 1):
        m = lab == i
        if m.sum() * cell * cell >= MIN_AREA:
            yield m


def shape_of(m: np.ndarray, cell: float, x0: float, y1: float, mode: str):
    """CAD-like outline of one component: a rotated rectangle when the blob is boxy, else a
    simplified polygon (walls: straightened with a larger tolerance)."""
    if mode == "box":
        ys, xs = np.nonzero(m)
        pts = np.c_[xs, ys].astype(np.float32)
        (cx, cy), (w, h), a = cv2.minAreaRect(pts)
        w, h = w + 1, h + 1
        if w * h > 0 and m.sum() / (w * h) >= 0.55:
            box = cv2.boxPoints(((cx, cy), (w, h), a))
            return [{"outer": [[r3(x0 + (u + 0.5) * cell), r3(y1 - (v + 0.5) * cell)] for u, v in box], "holes": []}]
        return polygons(m, cell, x0, y1, eps_cells=2.0)
    if mode == "wall":
        return polygons(m, cell, x0, y1, eps_cells=2.5)
    return polygons(m, cell, x0, y1)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-png", action="store_true")
    args = ap.parse_args()
    plan = json.loads(PLAN.read_text(encoding="utf-8"))
    floor_z = float(plan["floorZ"])
    if GRID.exists() and not args.from_png:
        cell, x0, y1, floor_m, solid, top, info = heights_from_grid(GRID, floor_z)
    else:
        cell, x0, y1, floor_m, solid, top, info = heights_from_png(PNG, plan)
    print(f"source: {info['source']}, grid {solid.shape[1]} x {solid.shape[0]}")

    solid = clean(solid, cell, open_it=1, close_it=1)
    heights = np.where(solid, np.minimum(top, CAP), 0.0)

    # room footprint = floor + solids, holes filled; small specks removed
    room = ndimage.binary_closing(floor_m | solid, iterations=3)
    room = ndimage.binary_fill_holes(room)
    room = clean(room, cell, open_it=2, close_it=0)
    floor_polys = polygons(room, cell, x0, y1, eps_cells=3)

    tall = solid & (heights >= WALL_MIN)
    mid = solid & (heights >= LOW_MAX) & ~tall
    low = solid & (heights > 0) & (heights < LOW_MAX)

    # Pockets the scanner never saw (no floor points) inside the room. A shallow pocket (<= 1.2 m)
    # behind equipment fronts is the body of the switchgear / cabinet (a scanner at 1.45 m sees the
    # fronts, not the tops): drawn as solid at the height of its fronts, marked "inferred". Deeper
    # pockets are unscanned space: drawn flat and hatched, never as invented geometry.
    seen = ndimage.binary_dilation(floor_m, iterations=2)
    pocket = room & ~seen & ~solid
    bodies, unscanned = [], []
    lab, n = ndimage.label(pocket)
    for i in range(1, n + 1):
        m = lab == i
        if m.sum() * cell * cell < 0.15:
            continue
        ys, xs = np.nonzero(m)
        (_, _), (w, h), _ = cv2.minAreaRect(np.c_[xs, ys].astype(np.float32))
        ring = ndimage.binary_dilation(m, iterations=3) & ~m & solid
        if min(w, h) * cell <= 1.2 and ring.sum() >= 10:
            body = ndimage.binary_dilation(m, iterations=2) & (m | solid)
            hgt = min(float(np.percentile(heights[ring], 60)), WALL_MIN - LEVEL)
            bodies.append((ndimage.binary_closing(body, iterations=1), hgt))
        else:
            unscanned.append(m)
    for b, _ in bodies:
        tall &= ~b
        mid &= ~b
        low &= ~b

    solids = []

    def add(kind, mask, height, inferred=False, shape="poly"):
        for comp in components(mask, cell):
            for p in shape_of(comp, cell, x0, y1, shape):
                solids.append({"kind": kind, "height": r3(height), **p, **({"inferred": True} if inferred else {})})

    add_walls = clean(tall, cell, open_it=0, close_it=1)
    for comp in components(add_walls, cell):
        for p in shape_of(comp, cell, x0, y1, "wall"):
            solids.append({"kind": "wall", "height": CAP, **p})
    for kind, m in (("equipment", mid), ("low", low)):
        m = clean(m, cell, open_it=0, close_it=2)
        for comp in components(m, cell):
            h = float(np.percentile(heights[comp], 75))
            for p in shape_of(comp, cell, x0, y1, "box"):
                solids.append({"kind": kind, "height": r3(round(h / LEVEL) * LEVEL), **p})
    for m, h in bodies:
        for p in shape_of(m, cell, x0, y1, "box"):
            solids.append({"kind": "equipment", "height": r3(round(h / LEVEL) * LEVEL), "inferred": True, **p})
    unscanned_polys = [p for m in unscanned for p in polygons(m, cell, x0, y1, eps_cells=2.5)]
    kinds = {"wall": 0, "equipment": 0, "low": 0}
    heights_for_devices = heights.copy()
    for m, h in bodies:
        heights_for_devices[m] = h
    heights = heights_for_devices

    # relay facing (towards the scan points that saw it) and the height it is mounted on
    pano = {p["scanPointId"]: p["position"] for p in json.loads(PANOS.read_text(encoding="utf-8"))}
    devices = {}
    for d in plan["devices"]:
        v = np.zeros(2)
        for s in d["scanPointIds"]:
            if s in pano:
                w = np.array(pano[s][:2]) - [d["x"], d["y"]]
                v += w / max(np.linalg.norm(w), 1e-6)
        ang = math.atan2(v[1], v[0]) if np.linalg.norm(v) > 1e-6 else 0.0
        snap = round(ang / (math.pi / 2)) * (math.pi / 2)
        if abs(ang - snap) < math.radians(30):
            ang = snap
        c = int((y1 - d["y"]) / cell), int((d["x"] - x0) / cell)
        r = 3
        win = heights[max(c[0] - r, 0):c[0] + r + 1, max(c[1] - r, 0):c[1] + r + 1]
        devices[d["id"]] = {"facing": [r3(math.cos(ang)), r3(math.sin(ang))],
                            "top": r3(win.max()) if win.size else None}

    out = {
        "version": 1,
        "frame": "panoramas.json world frame (z up, metres); heights above floorZ",
        "floorZ": r3(floor_z),
        "bounds": plan["bounds"],
        "source": info,
        "wallHeight": CAP,
        "floor": floor_polys,
        "unscanned": unscanned_polys,
        "solids": solids,
        "devices": devices,
    }
    OUT.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    n_v = sum(len(s["outer"]) + sum(len(h) for h in s["holes"]) for s in solids)
    by = {k: sum(1 for s in solids if s["kind"] == k) for k in kinds}
    by["inferred"] = sum(1 for s in solids if s.get("inferred"))
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1e3:.0f} kB): floor {len(floor_polys)}, "
          f"solids {by}, {n_v} vertices")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
