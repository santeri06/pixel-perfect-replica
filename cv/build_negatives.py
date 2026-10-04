"""Real backgrounds and hard negatives for retraining, taken from a subset of the scan points.

Usage (PowerShell, from the cv folder):
    python build_negatives.py --scans 0-8

Needs a previous infer.py run (outputs/detections.json and runs/candidates.json).

Output:
    data/backgrounds_v2/     views that contain no detected device (check the contact sheets!)
    data/negatives_v2/       crops of objects the detector proposed but the visual check rejected
    runs/negatives_sheet_*.jpg, runs/backgrounds_sheet_*.jpg   contact sheets for a manual check
"""
import argparse
import json
import re

import cv2
import numpy as np

from common import DATA, DETECTIONS_FILE, RUNS_DIR, TEST_SCANS_DIR, imread, imwrite
from geometry import load_poses, make_view, render_view, yaw_pitch_to_dirs

BACKGROUNDS = DATA / "backgrounds_v2"
NEGATIVES = DATA / "negatives_v2"
MAX_NEGATIVE_SCORE = 0.90   # similarity + 0.2 * confidence; clearly not the device
VIEW_RE = re.compile(r"_f(\d+)_s([\d.]+)_y([+-]\d+)_p([+-]\d+)\.jpg$")


def sheet(tiles, name, cols=12, size=128):
    tiles = [cv2.resize(t, (size, size)) for t in tiles]
    for part in range(0, len(tiles), cols * 10):
        t = tiles[part:part + cols * 10]
        while len(t) % cols:
            t.append(np.zeros((size, size, 3), np.uint8))
        imwrite(RUNS_DIR / f"{name}_{part // (cols * 10)}.jpg",
                np.vstack([np.hstack(t[i:i + cols]) for i in range(0, len(t), cols)]), 85)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--scans", default="0-8", help="range of scan point numbers to use, e.g. 0-8")
    args = ap.parse_args()
    lo, hi = (int(v) for v in args.scans.split("-"))
    scan_ids = [f"scan-{i:02d}" for i in range(lo, hi + 1)]

    poses = load_poses()
    dets = json.loads(DETECTIONS_FILE.read_text(encoding="utf-8"))
    cands = json.loads((RUNS_DIR / "candidates.json").read_text())
    for folder in (BACKGROUNDS, NEGATIVES):
        folder.mkdir(parents=True, exist_ok=True)
        for f in folder.glob("*.jpg"):
            f.unlink()

    neg_tiles, bg_tiles = [], []
    for sid in scan_ids:
        sources = [(i, imread(TEST_SCANS_DIR / n)) for n, i in poses.items() if i["scanPointId"] == sid]
        device_dirs = [yaw_pitch_to_dirs(np.array(d["yaw"]), np.array(d["pitch"]))
                       for d in dets if d["scanPointId"] == sid]

        # hard negatives: rejected candidates, cropped from the view they were found in
        by_view: dict[str, list[dict]] = {}
        for c in cands:
            if c["scan"] == sid and not c["kept"] and c["similarity"] + 0.2 * c["conf"] < MAX_NEGATIVE_SCORE:
                by_view.setdefault(c["view"], []).append(c)
        n_neg = 0
        for name, items in by_view.items():
            fov, stretch, yaw, pitch = VIEW_RE.search(name).groups()
            img = render_view(sources, make_view(float(yaw), int(pitch), int(fov), 1280, float(stretch)))
            for c in items:
                x1, y1, x2, y2 = c["box"]
                px, py = (x2 - x1) * 0.25, (y2 - y1) * 0.25
                crop = img[int(max(0, y1 - py)):int(y2 + py), int(max(0, x1 - px)):int(x2 + px)]
                if min(crop.shape[:2]) < 24:
                    continue
                imwrite(NEGATIVES / f"{sid}_{n_neg:03d}.jpg", crop, 92)
                neg_tiles.append(crop)
                n_neg += 1

        # backgrounds: views that look away from every detected device
        n_bg = 0
        for fov, stretch, pitches, step in ((60, 1.0, (-30, 0, 25), 30), (45, 2.0, (0, 20), 45)):
            reach = np.radians(fov) * 0.75 + np.radians(6)
            for pitch in pitches:
                for yaw in range(-180, 180, step):
                    centre = yaw_pitch_to_dirs(np.array(float(yaw)), np.array(float(pitch)))
                    if any(np.arccos(np.clip(centre @ d, -1, 1)) < reach for d in device_dirs):
                        continue
                    img = render_view(sources, make_view(float(yaw), pitch, fov, 768, stretch))
                    imwrite(BACKGROUNDS / f"{sid}_f{fov}_s{stretch:g}_y{yaw:+04d}_p{pitch:+03d}.jpg", img, 90)
                    bg_tiles.append(img)
                    n_bg += 1
        print(f"{sid}: {n_neg} negatives, {n_bg} backgrounds", flush=True)

    sheet(neg_tiles, "negatives_sheet")
    sheet(bg_tiles, "backgrounds_sheet", cols=10, size=192)
    print(f"total: {len(neg_tiles)} negatives -> {NEGATIVES}, {len(bg_tiles)} backgrounds -> {BACKGROUNDS}")


if __name__ == "__main__":
    main()
