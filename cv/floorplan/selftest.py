"""Self-test of build_floorplan.py on a SYNTHETIC point cloud (no real data needed).

    python selftest.py            # writes everything under cache/selftest/ (git-ignored)

1. Builds a synthetic switchgear room as an .e57 (18 scans at the panoramas.json positions, each
   stored in its own rotated local frame so the pose transform is exercised). Relay front panels
   sit at the triangulated reference positions, so the real detections.json rays hit them.
2. A3 machinery: renders synthetic "photos" from the cloud itself; one is rolled by +3 deg yaw and one
   is mirrored. The check must report ~0 deg, ~+3 deg and "mirrored".
3. Runs build_floorplan.py end to end with --skip-reprojection-gate (the synthetic room does not look
   like the real photos), which never publishes: output lands in cache/selftest/rejected/.

Nothing here is real data. It only proves the code paths work before running on cloud_0.e57.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

import build_floorplan as bf
import geom

OUT = bf.CACHE / "selftest"
RNG = np.random.default_rng(7)

ROW = [(-5.86, 1.85), (-4.79, 1.85), (-3.78, 1.84), (-2.79, 1.84), (-1.79, 1.84)]  # wall row, x = -5.72
STACK = [(-5.93, 1.43), (-5.93, 1.73)]  # opposite cabinet, x = -2.75


def plane(c0, u, v, nu, nv, step, color):
    a = np.arange(0, nu, step)
    b = np.arange(0, nv, step)
    A, B = np.meshgrid(a, b)
    p = np.asarray(c0) + A.reshape(-1, 1) * np.asarray(u) + B.reshape(-1, 1) * np.asarray(v)
    return p, np.tile(np.array(color, np.uint8), (len(p), 1))


def box(x0, x1, y0, y1, z0, z1, step, color):
    parts = [
        plane((x0, y0, z0), (0, 1, 0), (0, 0, 1), y1 - y0, z1 - z0, step, color),
        plane((x1, y0, z0), (0, 1, 0), (0, 0, 1), y1 - y0, z1 - z0, step, color),
        plane((x0, y0, z0), (1, 0, 0), (0, 0, 1), x1 - x0, z1 - z0, step, color),
        plane((x0, y1, z0), (1, 0, 0), (0, 0, 1), x1 - x0, z1 - z0, step, color),
        plane((x0, y0, z1), (1, 0, 0), (0, 1, 0), x1 - x0, y1 - y0, step, color),
    ]
    return np.concatenate([p for p, _ in parts]), np.concatenate([c for _, c in parts])


def room():
    parts = [
        plane((-9.2, -9.0, 0), (1, 0, 0), (0, 1, 0), 9.8, 9.6, 0.02, (150, 150, 150)),  # floor
        plane((-9.2, -9.0, 3), (1, 0, 0), (0, 1, 0), 9.8, 9.6, 0.04, (230, 230, 230)),  # ceiling
        plane((-9.2, -9.0, 0), (0, 1, 0), (0, 0, 1), 9.6, 3, 0.02, (210, 200, 180)),
        plane((0.6, -9.0, 0), (0, 1, 0), (0, 0, 1), 9.6, 3, 0.02, (210, 200, 180)),
        plane((-9.2, -9.0, 0), (1, 0, 0), (0, 0, 1), 9.8, 3, 0.02, (200, 190, 170)),
        plane((-9.2, 0.6, 0), (1, 0, 0), (0, 0, 1), 9.8, 3, 0.02, (200, 190, 170)),
        box(-6.3, -5.75, -6.4, -1.3, 0, 2.2, 0.008, (190, 195, 200)),  # wall cabinets, front x = -5.75
        box(-2.72, -2.2, -6.6, -5.3, 0, 2.2, 0.008, (190, 195, 200)),  # opposite cabinet, front x = -2.72
        box(-1.0, -0.4, -8.9, -8.2, 0, 2.2, 0.01, (120, 120, 120)),  # something near the review-only hit
    ]
    for y, z in ROW:  # relay front panels 3 cm proud of the cabinet
        parts.append(box(-5.75, -5.72, y - 0.08, y + 0.08, z - 0.09, z + 0.09, 0.004, (40, 40, 40)))
    for y, z in STACK:
        parts.append(box(-2.75, -2.72, y - 0.08, y + 0.08, z - 0.09, z + 0.09, 0.004, (40, 40, 40)))
    p = np.concatenate([a for a, _ in parts])
    c = np.concatenate([b for _, b in parts])
    return p, c


def quat_z(angle):
    return [float(np.cos(angle / 2)), 0.0, 0.0, float(np.sin(angle / 2))]


def make_e57(path: Path):
    import pye57

    pano = json.loads(bf.PANORAMAS.read_text(encoding="utf-8"))
    pts, col = room()
    path.unlink(missing_ok=True)
    e = pye57.E57(str(path), mode="w")
    for i, p in enumerate(pano):
        t = np.array(p["position"])
        q = quat_z(RNG.uniform(-np.pi, np.pi))
        R = geom.quat_to_matrix(q)
        keep = RNG.random(len(pts)) < 0.35
        w = pts[keep] + RNG.normal(0, 0.002, (keep.sum(), 3))
        local = (w - t) @ R  # world = R·local + t
        c = col[keep]
        e.write_scan_raw({"cartesianX": local[:, 0], "cartesianY": local[:, 1], "cartesianZ": local[:, 2],
                          "colorRed": c[:, 0], "colorGreen": c[:, 1], "colorBlue": c[:, 2]},
                         name=f"synthetic {i}", rotation=np.array(q), translation=t)
    e.close()
    return pts, col


def a3_selftest(pts, col):
    pano = {p["scanPointId"]: np.array(p["position"]) for p in json.loads(bf.PANORAMAS.read_text(encoding="utf-8"))}
    fake = OUT / "pano"
    results = {}
    for sid, mode in (("scan-01", "same"), ("scan-07", "yaw+3"), ("scan-12", "mirror")):
        _, rgb, _ = bf.render_equirect(pts, col, pano[sid], mirror=(mode == "mirror"))
        img = Image.fromarray(rgb)
        if mode == "yaw+3":
            img = Image.fromarray(np.roll(rgb, round(3 * bf.W3 / 360), axis=1))
        (fake / sid).mkdir(parents=True, exist_ok=True)
        img.resize((4096, 2048)).save(fake / sid / "equirect.jpg", quality=90)
        bf.PANO_DIR = fake
        r = bf.reprojection_check(sid, pts[::3], col[::3], pano[sid], [], OUT / f"a3_{sid}.png")  # sparser than the "photo"
        results[mode] = r
        print(f"A3 selftest {mode:6s}: yaw {r['yawShiftDeg']:+.2f}  pitch {r['pitchShiftDeg']:+.2f}  mirrored={r['mirrored']}  ok={r['ok']}")
    assert results["same"]["ok"], results["same"]
    assert abs(results["yaw+3"]["yawShiftDeg"] - 3) < 0.3 and not results["yaw+3"]["ok"], results["yaw+3"]
    assert results["mirror"]["mirrored"] and not results["mirror"]["ok"], results["mirror"]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    e57 = OUT / "synthetic.e57"
    print("Writing synthetic E57...")
    pts, col = make_e57(e57)
    a3_selftest(pts, col)
    for reader in ("read_scan", "chunked"):
        print(f"\nPipeline with --reader {reader}:")
        r = subprocess.run([sys.executable, "build_floorplan.py", "--e57", str(e57), "--reader", reader,
                            "--skip-reprojection-gate", "--report-dir", str(OUT / reader)], cwd=bf.HERE)
        rep = json.loads((OUT / reader / "report.json").read_text(encoding="utf-8"))
        fp = json.loads((OUT / reader / "rejected" / "floorplan.json").read_text(encoding="utf-8"))
        assert r.returncode == 4, "synthetic run must never publish"
        assert rep["gates"]["A0"] and rep["gates"]["A5"] and rep["gates"]["A6"], rep["gates"]
        means = [s["meanToTranslationM"] for s in rep["A2_cloud"]["perScan"]]
        print(f"  devices {len(fp['devices'])}, unlocated {len(fp['unlocated'])}, gates {rep['gates']}, "
              f"scan mean-to-translation {min(means):.2f}..{max(means):.2f} m")
    print("\nSELFTEST OK")


if __name__ == "__main__":
    main()
