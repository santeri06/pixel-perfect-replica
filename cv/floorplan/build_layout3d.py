"""Build the 3D room layout for the floor plan page (src/data/floorplan3d.json).

Input (read only):
  src/data/floorplan.json         frame (bounds, floorZ) and the relay positions
  src/data/panoramas.json         scan point positions
  cv/floorplan/room_grid.npz      3D occupancy grid from export_room_grid.py (preferred)
  public/floorplan/floorplan.png  fallback when room_grid.npz is missing: obstacles at one height

Output: src/data/floorplan3d.json
  floor     [{outer, holes}]                 floor slab (world metres, x/y)
  unscanned [{outer, holes}]                 floor the scanner never saw (drawn hatched)
  solids    [{kind, height, outer, holes, front?, inferred?}]
            kind "wall"       perimeter walls and full-height partitions (constant thickness)
                 "cabinet"    one switchgear / relay panel of a cabinet row (front = facing)
                 "equipment"  free-standing objects >= 0.6 m, "low" below that
  devices   {id: {facing, top, front?}}      facing = axis the relay faces (towards the aisle),
                                             top = cabinet height, front = point on the cabinet
                                             face (relays on a detected cabinet row)

How it stays clean (a CAD-like model, not a voxel blob):
  * the room is axis aligned, so every outline is rectilinear and snapped to a 5 cm grid;
    short jogs (< 0.4 m on the room, < 0.3 m on objects) are removed by merging edges
  * walls are 15 cm thick strips outside the measured floor outline, only where the point cloud
    shows a wall; the plan bounds are a section cut (no wall drawn there)
  * cabinet rows come from the relays: a row is the line of cabinet fronts the relays are mounted
    on; its length, depth and height are measured from the grid (depth to the rear aisle or wall)
    and it is split into panels between the relays
  * everything else becomes axis-aligned boxes (greedy largest-rectangle decomposition); pieces
    smaller than 0.3 m x 0.3 m are dropped as clutter
Nothing is hand-drawn: every position and size is measured from the point cloud.

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

WALL_MIN = 2.35      # a column reaching this height is a wall / full-height partition
WALL_EVIDENCE = 2.0  # along the room outline, columns this tall count as wall evidence
CAP = 2.60           # columns are cut here: cable trays and lights under the ceiling are not walls
LOW_MAX = 0.60       # below this a box is a low object
SNAP = 0.05          # plan grid (m): every coordinate and height is a multiple of this
WALL_T = 0.15        # wall thickness (m)
FINE = 0.01          # raster resolution for composing walls (m)
ROOM_SMOOTH = 0.40   # room mask: open / close with this square before tracing
ROOM_JOG = 0.60      # room outline: steps shorter than this are straightened
BOX_JOG = 0.30       # object outlines: same
BOX_MIN = 0.30       # smallest box side (m)
BOX_MIN_AREA = 0.12  # m2
ROW_DEPTH = 0.80     # cabinet depth when the back cannot be measured
ROW_DEPTH_MAX = 2.60
MIN_AREA = 0.02


def r3(v: float) -> float:
    return round(float(v), 3)


def snap(v: float, step: float = SNAP) -> float:
    return round(round(float(v) / step) * step, 3)


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


# ---------------------------------------------------------------- rectilinear polygons
# A rectilinear ring is kept as alternating edges: orient[i] in "HV", coord[i] = y of an H edge,
# x of a V edge. Vertex i joins edge i and edge i+1. Edge i runs from coord[i-1] to coord[i+1].
def _ortho_path(cnt: np.ndarray):
    pts = cnt[:, 0, :].astype(int)
    out = []
    for i in range(len(pts)):
        p, q = pts[i], pts[(i + 1) % len(pts)]
        out.append((int(p[0]), int(p[1])))
        if p[0] != q[0] and p[1] != q[1]:
            out.append((int(q[0]), int(p[1])))  # split a diagonal step into two axis steps
    return out


def _edges(v):
    v = [p for i, p in enumerate(v) if p != v[i - 1]]
    changed = True
    while changed and len(v) >= 4:
        changed = False
        keep = []
        for i in range(len(v)):
            a, b, c = v[i - 1], v[i], v[(i + 1) % len(v)]
            if a[0] == b[0] == c[0] or a[1] == b[1] == c[1]:
                changed = True
                continue
            keep.append(b)
        v = keep
    if len(v) < 4 or len(v) % 2:
        return None
    o, c = [], []
    for i in range(len(v)):
        p, q = v[i], v[(i + 1) % len(v)]
        if p[1] == q[1]:
            o.append("H")
            c.append(float(p[1]))
        else:
            o.append("V")
            c.append(float(p[0]))
    return o, c


def _simplify(o, c, min_edge):
    """Remove edges shorter than min_edge: the two parallel neighbours merge at their
    length-weighted mean (a least-squares straight wall through the steps)."""
    o, c = list(o), list(c)
    while len(c) > 4:
        n = len(c)
        arr = np.array(c)
        L = np.abs(np.roll(arr, -1) - np.roll(arr, 1))
        i = int(np.argmin(L))
        if L[i] >= min_edge:
            break
        a, b = (i - 1) % n, (i + 1) % n
        la, lb = L[a], L[b]
        new = (la * c[a] + lb * c[b]) / (la + lb) if la + lb > 1e-9 else c[a]
        idx = [(a + k) % n for k in range(n)]
        o = [o[a]] + [o[j] for j in idx[3:]]
        c = [new] + [c[j] for j in idx[3:]]
    return o, c


def _verts(o, c):
    n = len(c)
    return [(c[(k + 1) % n], c[k]) if o[k] == "H" else (c[k], c[(k + 1) % n]) for k in range(n)]


def _area(v):
    x = np.array([p[0] for p in v])
    y = np.array([p[1] for p in v])
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def ring_of(cnt, res, x0, y1, up, min_edge, min_area):
    e = _edges(_ortho_path(cnt))
    if e is None:
        return None
    o, c = e
    # contour runs through pixel centres of the (padded, upsampled) raster -> world
    c = [x0 + ((ci - 1 + 0.5) / up) * res if oi == "V" else y1 - ((ci - 1 + 0.5) / up) * res
         for oi, ci in zip(o, c)]
    o, c = _simplify(o, c, min_edge)
    c = [snap(ci) for ci in c]
    o, c = _simplify(o, c, 1e-6)
    if len(c) < 4:
        return None
    v = _verts(o, c)
    if abs(_area(v)) < min_area:
        return None
    return [[r3(x), r3(y)] for x, y in v]


def rect_polys(mask, res, x0, y1, min_edge, min_area=MIN_AREA, holes=True, up=2):
    """Rectilinear polygons (with holes) of a boolean raster, snapped to the plan grid."""
    m = mask.astype(np.uint8)
    if up > 1:
        m = np.kron(m, np.ones((up, up), np.uint8))
    m = np.pad(m, 1)
    cnts, hier = cv2.findContours(m, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    if hier is None:
        return []
    hier = hier[0]
    out = []
    for i, cnt in enumerate(cnts):
        if hier[i][3] != -1:
            continue
        outer = ring_of(cnt, res, x0, y1, up, min_edge, min_area)
        if outer is None:
            continue
        hs = []
        j = hier[i][2]
        while holes and j != -1:
            h = ring_of(cnts[j], res, x0, y1, up, min_edge, min_area)
            if h:
                hs.append(h)
            j = hier[j][0]
        out.append({"outer": outer, "holes": hs})
    return out


def rect(xa, ya, xb, yb):
    xa, xb = sorted((snap(xa), snap(xb)))
    ya, yb = sorted((snap(ya), snap(yb)))
    return [[xa, ya], [xb, ya], [xb, yb], [xa, yb]]


class Grid:
    """Cell index <-> world for a raster whose row 0 is world y1 and column 0 world x0."""

    def __init__(self, res, x0, y1, shape):
        self.res, self.x0, self.y1, self.shape = res, x0, y1, shape

    def window(self, xa, xb, ya, yb):
        """Row / column slices of the cells inside the world box."""
        xa, xb = sorted((xa, xb))
        ya, yb = sorted((ya, yb))
        c0 = max(int(math.floor((xa - self.x0) / self.res + 1e-6)), 0)
        c1 = min(int(math.ceil((xb - self.x0) / self.res - 1e-6)), self.shape[1])
        r0 = max(int(math.floor((self.y1 - yb) / self.res + 1e-6)), 0)
        r1 = min(int(math.ceil((self.y1 - ya) / self.res - 1e-6)), self.shape[0])
        return slice(r0, max(r1, r0)), slice(c0, max(c1, c0))

    def fill(self, img, outer, value=1):
        pts = np.array([[(x - self.x0) / self.res - 0.5, (self.y1 - y) / self.res - 0.5] for x, y in outer])
        cv2.fillPoly(img, [np.round(pts).astype(np.int32)], value)

    def cell_of(self, x, y):
        return int((self.y1 - y) / self.res), int((x - self.x0) / self.res)


def clean(mask: np.ndarray, cell: float, open_it=1, close_it=1, min_area=MIN_AREA) -> np.ndarray:
    m = ndimage.binary_opening(mask, iterations=open_it) if open_it else mask
    m = ndimage.binary_closing(m, iterations=close_it) if close_it else m
    lab, n = ndimage.label(m)
    if n:
        size = ndimage.sum(m, lab, index=np.arange(1, n + 1)) * cell * cell
        keep = np.zeros(n + 1, bool)
        keep[1:] = size >= min_area
        m = keep[lab]
    return m


def square(mask, k, op):
    k = max(int(k), 1) | 1
    return cv2.morphologyEx(mask.astype(np.uint8), op, np.ones((k, k), np.uint8)).astype(bool)


def runs(flags: np.ndarray):
    """[start, end) index pairs of the True runs of a 1D bool array."""
    d = np.diff(np.r_[0, flags.astype(np.int8), 0])
    return list(zip(np.where(d == 1)[0], np.where(d == -1)[0]))


def max_rect(m: np.ndarray, min_side: int):
    """Largest all-True axis-aligned rectangle with both sides >= min_side cells:
    (area, (r0, r1, c0, c1)) with exclusive ends, or (0, None)."""
    H, W = m.shape
    h = np.zeros(W, int)
    best = (0, None)
    for r in range(H):
        h = np.where(m[r], h + 1, 0)
        stack = []
        for c in range(W + 1):
            cur = h[c] if c < W else 0
            start = c
            while stack and stack[-1][1] >= cur:
                s, hh = stack.pop()
                w = c - s
                if hh >= min_side and w >= min_side and hh * w > best[0]:
                    best = (hh * w, (r - hh + 1, r + 1, s, c))
                start = s
            stack.append((start, cur))
    return best


# ---------------------------------------------------------------- cabinet rows from the relays
AXES = [(1, 0), (-1, 0), (0, 1), (0, -1)]


def facing_axis(g: Grid, floor_m, x, y):
    """Axis the relay faces: the side with the most measured floor in front of it (the aisle)."""
    best, score = (1, 0), -1.0
    for fx, fy in AXES:
        tx, ty = -fy, fx
        xa, xb = x + fx * 0.15 - abs(tx) * 0.3, x + fx * 1.0 + abs(tx) * 0.3
        ya, yb = y + fy * 0.15 - abs(ty) * 0.3, y + fy * 1.0 + abs(ty) * 0.3
        w = floor_m[g.window(xa, xb, ya, yb)]
        s = float(w.mean()) if w.size else 0.0
        if s > score:
            best, score = (fx, fy), s
    return best


def clusters(values, tol):
    vs = sorted(values)
    out = [[vs[0]]]
    for v in vs[1:]:
        (out[-1].append(v) if v - out[-1][-1] <= tol else out.append([v]))
    return out


def build_rows(g: Grid, plan, floor_m, solid, heights, room):
    devs = plan["devices"]
    face = {d["id"]: facing_axis(g, floor_m, d["x"], d["y"]) for d in devs}
    groups = []
    for f in AXES:
        ds = [d for d in devs if face[d["id"]] == f]
        if not ds:
            continue
        proj = {d["id"]: d["x"] * f[0] + d["y"] * f[1] for d in ds}
        for cl in clusters(list(proj.values()), 0.25):
            groups.append((f, [d for d in ds if min(cl) - 1e-9 <= proj[d["id"]] <= max(cl) + 1e-9]))

    cabinet_like = solid | (room & ~floor_m)
    rows, solids, dev_info = [], [], {}
    for f, ds in groups:
        fx, fy = f
        tx, ty = -fy, fx                                   # tangent (along the row)
        front = float(np.median([d["x"] * fx + d["y"] * fy for d in ds]))
        along = [d["x"] * tx + d["y"] * ty for d in ds]

        def box(s0, s1, n0, n1):
            """world box of along [s0, s1], depth behind the front [n0, n1]"""
            # a point at along s, depth n: p = s * tangent + (front - n) * facing
            p = [(s * tx + (front - n) * fx, s * ty + (front - n) * fy) for s in (s0, s1) for n in (n0, n1)]
            xs, ys = [q[0] for q in p], [q[1] for q in p]
            return min(xs), max(xs), min(ys), max(ys)

        def frac(mask, s0, s1, n0, n1):
            xa, xb, ya, yb = box(s0, s1, n0, n1)
            w = mask[g.window(xa, xb, ya, yb)]
            return float(w.mean()) if w.size else 0.0

        # length: walk out from the relays while the strip behind the front is cabinet-like
        step = g.res
        s_lo, s_hi = min(along) - 0.3, max(along) + 0.3
        ends = []
        for sign, s_start in ((-1, s_lo), (1, s_hi)):
            s, gap, last_ok = s_start, 0.0, s_start
            for _ in range(int(12 / step)):
                a, b = (s - step, s) if sign < 0 else (s, s + step)
                inside = frac(room, a, b, 0.04, 0.36) > 0.5
                # the floor under a cabinet is never seen: the row ends where floor shows behind the front
                ok = inside and frac(floor_m, a, b, 0.04, 0.5) <= 0.25 and frac(cabinet_like, a, b, 0.04, 0.36) >= 0.6
                if ok:
                    last_ok, gap = s + sign * step, 0.0
                else:
                    gap += step
                    if gap > 0.24 or not inside:
                        break
                s += sign * step
            ends.append(last_ok)
        sa, sb = sorted(ends)
        sa, sb = snap(sa), snap(sb)

        # depth: from the front back to the first seen floor (rear aisle) or the room outline
        depths = []
        for s in np.arange(sa + 0.1, sb - 0.1, 0.12):
            n = 0.3
            while n < ROW_DEPTH_MAX:
                if frac(room, s, s + 0.12, n, n + step) < 0.5 or frac(floor_m, s, s + 0.12, n, n + step) >= 0.5:
                    break
                n += step
            depths.append(n)
        depth = float(np.median(depths)) if depths else ROW_DEPTH
        inferred = True
        if depth >= ROW_DEPTH_MAX - 0.05:
            depth = ROW_DEPTH
        # a back that stops just short of the room outline stands against the wall
        s_mid = (sa + sb) / 2
        n = depth
        while n < depth + 0.25 and frac(room, s_mid - 0.2, s_mid + 0.2, n, n + step) >= 0.5:
            n += step
        if n < depth + 0.25:
            depth = n
        depth = max(snap(depth), 0.4)

        # height: the fronts (the scanner sees them; the tops are above the scanner)
        xa, xb, ya, yb = box(sa, sb, 0.0, 0.3)
        win = g.window(xa, xb, ya, yb)
        hv = heights[win][solid[win]]
        height = snap(min(max(float(np.percentile(hv, 75)) if hv.size else 2.2, 1.0), CAP))

        # panels: borders half-way between relays (stacked relays share a panel), long ends split
        centres = [float(np.mean(c)) for c in clusters(along, 0.3)]
        spacing = np.diff(centres)
        w_typ = float(np.clip(np.median(spacing), 0.6, 1.2)) if len(spacing) else 0.8
        # relay panels are w_typ wide and centred on their relay; what is left at the ends of the
        # row becomes end panels (cable / spare sections)
        lead = [centres[0] - w_typ / 2] if centres[0] - w_typ / 2 - sa >= 0.3 else []
        tail = [centres[-1] + w_typ / 2] if sb - (centres[-1] + w_typ / 2) >= 0.3 else []
        cuts = [sa] + lead + [(a + b) / 2 for a, b in zip(centres, centres[1:])] + tail + [sb]
        panels = []
        for a, b in zip(cuts, cuts[1:]):
            k = max(int(round((b - a) / w_typ)), 1) if (b - a) > 1.4 * w_typ else 1
            panels += [(a + (b - a) * i / k, a + (b - a) * (i + 1) / k) for i in range(k)]
        merged = []
        for a, b in panels:
            if merged and (b - a < 0.35 or merged[-1][1] - merged[-1][0] < 0.35):
                merged[-1] = (merged[-1][0], b)
            else:
                merged.append((a, b))
        for a, b in merged:
            xa, xb, ya, yb = box(snap(a), snap(b), 0.0, depth)
            solids.append({"kind": "cabinet", "height": height, "outer": rect(xa, ya, xb, yb), "holes": [],
                           "front": [fx, fy], **({"inferred": True} if inferred else {})})
        rows.append({"facing": [fx, fy], "front": snap(front, 0.01), "from": sa, "to": sb, "depth": depth,
                     "height": height, "panels": len(merged)})
        for d in ds:
            off = d["x"] * fx + d["y"] * fy - snap(front)       # onto the (snapped) cabinet face
            dev_info[d["id"]] = {"facing": [fx, fy], "top": height,
                                 "front": [r3(d["x"] - off * fx), r3(d["y"] - off * fy)]}
    return rows, solids, dev_info, face


# ---------------------------------------------------------------- main
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
    g = Grid(cell, x0, y1, solid.shape)

    # thin walls are only 1-2 cells wide: wall evidence uses the raw solid, objects the cleaned one
    solid_raw = solid
    heights_raw = np.where(solid_raw, np.minimum(top, CAP), 0.0)
    solid = clean(solid, cell, open_it=1, close_it=1)
    heights = np.where(solid, np.minimum(top, CAP), 0.0)

    # ---- room: measured floor + solids, holes filled, straightened to a rectilinear outline
    room = ndimage.binary_closing(floor_m | solid, iterations=3)
    room = ndimage.binary_fill_holes(room)
    room = clean(room, cell, open_it=2, close_it=0, min_area=1.0)
    k = ROOM_SMOOTH / cell
    room = square(square(room, k, cv2.MORPH_CLOSE), k, cv2.MORPH_OPEN)
    room = ndimage.binary_fill_holes(room)
    floor_polys = rect_polys(room, cell, x0, y1, ROOM_JOG, min_area=1.0, holes=False)
    room = np.zeros(solid.shape, np.uint8)
    for p in floor_polys:
        g.fill(room, p["outer"])
    room = room.astype(bool)

    # ---- cabinet rows (the relays tell where the fronts are)
    rows, cabinets, dev_info, face = build_rows(g, plan, floor_m, solid, heights, room)
    fx0 = min(q[0] for p in floor_polys for q in p["outer"])
    fx1 = max(q[0] for p in floor_polys for q in p["outer"])
    fy0 = min(q[1] for p in floor_polys for q in p["outer"])
    fy1 = max(q[1] for p in floor_polys for q in p["outer"])
    for c_ in cabinets:       # never into the walls
        (xa_, ya_), _, (xb_, yb_), _ = c_["outer"]
        c_["outer"] = rect(max(xa_, fx0), max(ya_, fy0), min(xb_, fx1), min(yb_, fy1))
    row_mask = np.zeros(solid.shape, np.uint8)
    for s in cabinets:
        g.fill(row_mask, s["outer"])
    row_mask = row_mask.astype(bool)

    # ---- walls: composed on a 1 cm raster so joints and corners are exact
    pad = 0.4
    fg = Grid(FINE, x0 - pad, y1 + pad, (int(round(solid.shape[0] * cell / FINE + 2 * pad / FINE)),
                                          int(round(solid.shape[1] * cell / FINE + 2 * pad / FINE))))
    room_f = np.zeros(fg.shape, np.uint8)
    for p in floor_polys:
        fg.fill(room_f, p["outer"])
    t = int(round(WALL_T / FINE))
    ring = cv2.dilate(room_f, np.ones((2 * t + 1, 2 * t + 1), np.uint8)).astype(bool) & ~room_f.astype(bool)

    b = plan["bounds"]
    evidence = solid_raw & (heights_raw >= WALL_EVIDENCE)
    wall_runs = 0
    for p in floor_polys:
        v = p["outer"]
        for i in range(len(v)):
            (xa, ya), (xb, yb) = v[i], v[(i + 1) % len(v)]
            horizontal = abs(ya - yb) < 1e-6
            lo, hi = (min(xa, xb), max(xa, xb)) if horizontal else (min(ya, yb), max(ya, yb))
            c = ya if horizontal else xa
            # which side is inside the room
            mid = (lo + hi) / 2
            probe = (lambda dd: room[g.cell_of(mid, c + dd)] if horizontal else room[g.cell_of(c + dd, mid)])
            inward = 1 if probe(0.1) else -1
            on_bounds = (horizontal and (abs(c - b["yMin"]) < 0.15 or abs(c - b["yMax"]) < 0.15)) or \
                        (not horizontal and (abs(c - b["xMin"]) < 0.15 or abs(c - b["xMax"]) < 0.15))
            ss = np.arange(lo, hi, cell)
            ev = np.zeros(len(ss), bool)
            if not on_bounds:
                for k_, s in enumerate(ss):
                    n0, n1 = sorted((c - inward * 0.15, c + inward * 0.4))
                    win = g.window(s, s + cell, n0, n1) if horizontal else g.window(n0, n1, s, s + cell)
                    ev[k_] = bool(evidence[win].any())
                gap = int(1.0 / cell)
                ev = ndimage.binary_closing(np.r_[np.ones(gap, bool), ev, np.ones(gap, bool)],
                                            structure=np.ones(gap))[gap:-gap]
                ev = ndimage.binary_opening(ev, structure=np.ones(int(0.5 / cell)))
            # clear the ring where there is no wall (openings and the section cut at the bounds)
            for r0, r1 in runs(~ev):
                ext = WALL_T + 0.02 if on_bounds else 0.0   # a section cut also clears the corners
                s0 = lo + r0 * cell if r0 > 0 else lo - ext
                s1 = lo + r1 * cell if r1 < len(ss) else hi + ext
                n0, n1 = sorted((c, c - inward * (WALL_T + 0.02)))
                win = fg.window(s0, s1, n0, n1) if horizontal else fg.window(n0, n1, s0, s1)
                ring[win] = False
            wall_runs += len(runs(ev))
    walls_f = clean(ring, FINE, open_it=0, close_it=0, min_area=0.06)

    # interior partitions: straight full-height lines away from the outline and the cabinet rows
    inner = ndimage.binary_erosion(room, iterations=int(0.6 / cell))
    tall = solid_raw & (heights_raw >= WALL_MIN) & inner & ~ndimage.binary_dilation(row_mask, iterations=3)
    tall = ndimage.binary_dilation(tall, iterations=1)
    L = int(0.8 / cell)
    partitions = []
    for kern, horizontal in ((np.ones((1, L), np.uint8), True), (np.ones((L, 1), np.uint8), False)):
        lines = cv2.morphologyEx(tall.astype(np.uint8), cv2.MORPH_OPEN, kern).astype(bool)
        lab, n = ndimage.label(lines)
        for i in range(1, n + 1):
            rr, cc = np.nonzero(lab == i)
            thick = (rr.max() - rr.min() + 1) if horizontal else (cc.max() - cc.min() + 1)
            if thick * cell > 0.5:
                continue
            if horizontal:
                yc = y1 - (np.median(rr) + 0.5) * cell
                xa_, xb_ = x0 + cc.min() * cell, x0 + (cc.max() + 1) * cell
                partitions.append(rect(xa_, yc - WALL_T / 2, xb_, yc + WALL_T / 2))
            else:
                xc = x0 + (np.median(cc) + 0.5) * cell
                ya_, yb_ = y1 - (rr.max() + 1) * cell, y1 - rr.min() * cell
                partitions.append(rect(xc - WALL_T / 2, ya_, xc + WALL_T / 2, yb_))
    walls_f = walls_f.astype(np.uint8)
    for r_ in partitions:
        fg.fill(walls_f, r_)
    rows_f = np.zeros(fg.shape, np.uint8)
    for s in cabinets:
        fg.fill(rows_f, s["outer"])
    walls_f = walls_f.astype(bool) & ~rows_f.astype(bool)
    wall_polys = rect_polys(walls_f, FINE, fg.x0, fg.y1, 0.05, min_area=0.03, up=1)

    # ---- everything else: axis-aligned boxes
    wall_c = cv2.resize(walls_f.astype(np.uint8), None, fx=FINE / cell, fy=FINE / cell,
                        interpolation=cv2.INTER_AREA)
    off = int(round(pad / cell))
    wall_c = wall_c[off:off + solid.shape[0], off:off + solid.shape[1]].astype(bool)
    edge_band = room & ~ndimage.binary_erosion(room, iterations=3)          # wall points
    rest = solid & (heights >= 0.2) & room & ~edge_band & ~ndimage.binary_dilation(row_mask, iterations=3) \
        & ~ndimage.binary_dilation(wall_c, iterations=2)
    rest = ndimage.binary_closing(rest, iterations=2)
    rest = ndimage.binary_fill_holes(rest)
    rest = clean(rest, cell, open_it=1, close_it=0, min_area=BOX_MIN_AREA)
    boxes = []
    min_side = int(math.ceil(BOX_MIN / cell))
    lab, n = ndimage.label(rest)
    for sl_i, sl in enumerate(ndimage.find_objects(lab)):
        m = lab[sl] == sl_i + 1
        for _ in range(10):
            area, rc = max_rect(m, min_side)
            if rc is None or area * cell * cell < BOX_MIN_AREA:
                break
            r0, r1, c0, c1 = rc
            m[r0:r1, c0:c1] = False
            R0, C0 = sl[0].start + r0, sl[1].start + c0
            R1, C1 = sl[0].start + r1, sl[1].start + c1
            hv = heights[R0:R1, C0:C1][solid[R0:R1, C0:C1]]
            if hv.size < 4:
                continue
            h = max(snap(float(np.percentile(hv, 75))), 0.2)
            xa_, xb_ = x0 + C0 * cell, x0 + C1 * cell
            ya_, yb_ = y1 - R1 * cell, y1 - R0 * cell
            boxes.append({"kind": "low" if h < LOW_MAX else "equipment", "height": h,
                          "outer": rect(xa_, ya_, xb_, yb_), "holes": []})
    # boxes standing just off a wall are against it (the gap is the wall's own scan noise)
    sides = [(p["outer"][i], p["outer"][(i + 1) % len(p["outer"])]) for p in floor_polys for i in range(len(p["outer"]))]
    for bx in boxes:
        (xa_, ya_), _, (xb_, yb_), _ = bx["outer"]
        for (pa, qa), (pb, qb) in sides:
            if abs(pa - pb) < 1e-6 and min(qa, qb) <= yb_ and max(qa, qb) >= ya_:      # vertical side
                if 0 < pa - xb_ <= 0.15:
                    xb_ = pa
                elif 0 < xa_ - pa <= 0.15:
                    xa_ = pa
            elif abs(qa - qb) < 1e-6 and min(pa, pb) <= xb_ and max(pa, pb) >= xa_:    # horizontal side
                if 0 < qa - yb_ <= 0.15:
                    yb_ = qa
                elif 0 < ya_ - qa <= 0.15:
                    ya_ = qa
        bx["outer"] = rect(xa_, ya_, xb_, yb_)
    box_mask = np.zeros(solid.shape, np.uint8)
    for s in boxes:
        g.fill(box_mask, s["outer"])

    # ---- unscanned floor (never seen, not covered by anything we draw): hatched, never invented
    seen = ndimage.binary_dilation(floor_m, iterations=2)
    pocket = room & ~seen & ~solid & ~row_mask & ~box_mask.astype(bool) & ~wall_c
    pocket = square(square(pocket, 0.2 / cell, cv2.MORPH_OPEN), 0.2 / cell, cv2.MORPH_CLOSE) & room
    unscanned = rect_polys(clean(pocket, cell, 0, 0, min_area=0.4), cell, x0, y1, BOX_JOG, min_area=0.4,
                           holes=False)

    # ---- relays not on a detected row: facing from the floor, top from the grid
    for d in plan["devices"]:
        if d["id"] in dev_info:
            continue
        fx, fy = face[d["id"]]
        r, c = g.cell_of(d["x"], d["y"])
        win = heights[max(r - 3, 0):r + 4, max(c - 3, 0):c + 4]
        dev_info[d["id"]] = {"facing": [fx, fy], "top": r3(win.max()) if win.size else None}

    solids = [{"kind": "wall", "height": CAP, **p} for p in wall_polys] + cabinets + boxes
    out = {
        "version": 1,
        "frame": "panoramas.json world frame (z up, metres); heights above floorZ",
        "floorZ": r3(floor_z),
        "bounds": plan["bounds"],
        "source": info,
        "wallHeight": CAP,
        "wallThickness": WALL_T,
        "grid": SNAP,
        "floor": floor_polys,
        "unscanned": unscanned,
        "rows": rows,
        "solids": solids,
        "devices": {d["id"]: dev_info[d["id"]] for d in plan["devices"]},
    }
    OUT.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    n_v = sum(len(s["outer"]) + sum(len(h) for h in s["holes"]) for s in solids)
    by = {k: sum(1 for s in solids if s["kind"] == k) for k in ("wall", "cabinet", "equipment", "low")}
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1e3:.0f} kB): floor {len(floor_polys)} "
          f"({sum(len(p['outer']) for p in floor_polys)} corners), wall runs {wall_runs}, "
          f"partitions {len(partitions)}, solids {by}, unscanned {len(unscanned)}, {n_v} vertices")
    for r_ in rows:
        print(f"  row facing {r_['facing']} front {r_['front']}: {r_['from']} .. {r_['to']}, depth {r_['depth']}, "
              f"height {r_['height']}, {r_['panels']} panels")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
