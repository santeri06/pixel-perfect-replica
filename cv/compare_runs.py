"""Before/after comparison of two detections.json files, one image per scan point.

Usage (PowerShell, from the cv folder):
    python compare_runs.py runs/detections_before.json outputs/detections.json

Output: runs/comparison/<scan>.jpg - the eye-level band of the panorama (two rows = left and right
half). Magenta squares = before, circles = after (green: confidence >= 0.75, orange: below).
"""
import json
import sys
from collections import Counter
from pathlib import Path

import cv2

from common import OUTPUTS_DIR, RUNS_DIR, imread, imwrite

import numpy as np

AUTO = 0.75
OUT = RUNS_DIR / "comparison"


def xy(d, W, H):
    return int((d["yaw"] / 360 + 0.5) * W), int((0.5 - d["pitch"] / 180) * H)


def main() -> None:
    before = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    after = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
    scans = sorted(p.name for p in (OUTPUTS_DIR / "panoramas").iterdir() if p.is_dir())
    print("scan      before  after (auto / review)")
    for sid in scans:
        pano = imread(OUTPUTS_DIR / "panoramas" / sid / "equirect.jpg")
        H, W = pano.shape[:2]
        b = [d for d in before if d["scanPointId"] == sid]
        a = [d for d in after if d["scanPointId"] == sid]
        for d in b:
            x, y = xy(d, W, H)
            cv2.rectangle(pano, (x - 34, y - 34), (x + 34, y + 34), (255, 0, 255), 5)
        for d in a:
            x, y = xy(d, W, H)
            col = (0, 190, 0) if d["confidence"] >= AUTO else (0, 150, 255)
            cv2.circle(pano, (x, y), 24, (255, 255, 255), 9)
            cv2.circle(pano, (x, y), 24, col, 6)
        band = pano[int(H * 0.26):int(H * 0.64)]
        img = np.vstack([band[:, :W // 2], band[:, W // 2:]])
        auto = sum(d["confidence"] >= AUTO for d in a)
        head = np.full((70, img.shape[1], 3), 255, np.uint8)
        cv2.putText(head, f"{sid}   before: {len(b)} tags (magenta squares)   after: {auto} auto (green) + "
                          f"{len(a) - auto} review (orange)", (16, 46), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (30, 30, 30), 2, cv2.LINE_AA)
        imwrite(OUT / f"{sid}.jpg", np.vstack([head, img]), 85)
        print(f"{sid}   {len(b):>4}   {len(a):>4} ({auto} / {len(a) - auto})")
    c = Counter(d["confidence"] >= AUTO for d in after)
    print(f"total     {len(before):>4}   {len(after):>4} ({c[True]} / {c[False]})  -> {OUT}")


if __name__ == "__main__":
    main()
