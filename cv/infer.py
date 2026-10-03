"""Run the trained model on the test scans, OCR the labels and write outputs/detections.json.

With data/test_scans/poses.json (from extract_e57.py) every scan point is searched through many
overlapping rendered views and the hits are merged by direction. Without poses, every image in
data/test_scans is processed on its own.

Usage (PowerShell, from the cv folder):
    python infer.py
    python infer.py --scans scan-09 scan-12     # only some scan points
    python infer.py --plain                     # ignore poses, one image at a time
"""
import argparse
import json
import shutil
import time
from pathlib import Path

import cv2
import numpy as np

from common import (ANNOTATED_DIR, DETECTIONS_FILE, OUTPUTS_DIR, RUNS_DIR, TEST_SCANS_DIR, imread, imwrite,
                    list_images)
from geometry import load_poses
from pipeline import VERIFY_ACCEPT, VERIFY_REVIEW, AutoTagPipeline

VIEWS_DIR = OUTPUTS_DIR / "views"  # clean copies of the views that contain a detection


def run_scans(pipe: AutoTagPipeline, poses: dict, only: list[str] | None) -> list[dict]:
    scans: dict[str, list[str]] = {}
    for name, info in poses.items():
        scans.setdefault(info["scanPointId"], []).append(name)
    all_dets, t0 = [], time.time()
    for scan_id, names in scans.items():
        if only and scan_id not in only:
            continue
        sources = [(poses[n], imread(TEST_SCANS_DIR / n)) for n in names]
        dets, views = pipe.detect_scan(sources, scan_id, id_prefix=scan_id)
        for name, (clean, annotated) in views.items():
            imwrite(VIEWS_DIR / name, clean, 90)
            imwrite(ANNOTATED_DIR / name, annotated, 88)
        all_dets.extend(dets)
        print(f"  {scan_id}: {len(dets)} detection(s)  [{time.time() - t0:.0f}s]", flush=True)
        for d in dets:
            print(f"     conf={d['confidence']}  yaw={d['yaw']} pitch={d['pitch']}  ocr='{d['ocrText']}'", flush=True)
    return all_dets


def run_plain(pipe: AutoTagPipeline, source: Path, poses: dict) -> list[dict]:
    all_dets = []
    for path in list_images(source):
        img = imread(path)
        if img is None:
            print(f"  ! could not read {path.name}")
            continue
        dets, annotated = pipe.detect(img, path.name, id_prefix=path.stem, pose=poses.get(path.name))
        imwrite(ANNOTATED_DIR / f"{path.stem}.jpg", annotated, 88)
        all_dets.extend(dets)
        print(f"  {path.name}: {len(dets)} detection(s)")
    return all_dets


def write_log_sheet(pipe: AutoTagPipeline) -> None:
    """runs/candidates_N.jpg: every merged candidate with its scores (green kept, orange review, red rejected)."""
    tiles = []
    for c in pipe.log:
        t = cv2.resize(c["crop"], (160, 160))
        score = c["similarity"] + 0.2 * c["conf"]
        col = (0, 200, 0) if score >= VERIFY_ACCEPT else (0, 165, 255) if score >= VERIFY_REVIEW else (0, 0, 255)
        cv2.rectangle(t, (0, 0), (160, 32), (0, 0, 0), -1)
        cv2.putText(t, f"{c['scan'][-2:]} c{c['conf']:.2f} v{c['views']}", (3, 13), cv2.FONT_HERSHEY_SIMPLEX, 0.42,
                    (255, 255, 255), 1, cv2.LINE_AA)
        cv2.putText(t, f"s{c['similarity']:.2f} = {score:.2f}", (3, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.45, col, 1,
                    cv2.LINE_AA)
        tiles.append(t)
    cols, rows = 12, 8
    for part in range(0, len(tiles), cols * rows):
        t = tiles[part:part + cols * rows]
        while len(t) % cols:
            t.append(np.zeros((160, 160, 3), np.uint8))
        imwrite(RUNS_DIR / f"candidates_{part // (cols * rows)}.jpg",
                np.vstack([np.hstack(t[i:i + cols]) for i in range(0, len(t), cols)]), 85)
    (RUNS_DIR / "candidates.json").write_text(
        json.dumps([{k: v for k, v in c.items() if k != "crop"} for c in pipe.log]))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--source", default=str(TEST_SCANS_DIR), help="folder with images (plain mode)")
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--imgsz", type=int, default=1280)
    ap.add_argument("--scans", nargs="*", help="scan point ids to process (default: all)")
    ap.add_argument("--plain", action="store_true", help="process every image on its own")
    args = ap.parse_args()

    poses = load_poses()
    plain = args.plain or not poses or Path(args.source) != TEST_SCANS_DIR
    if plain and not list_images(Path(args.source)):
        raise SystemExit(f"No images in {args.source}.")

    for folder in (ANNOTATED_DIR, VIEWS_DIR):
        shutil.rmtree(folder, ignore_errors=True)
    pipe = AutoTagPipeline(conf=args.conf, imgsz=args.imgsz)
    all_dets = run_plain(pipe, Path(args.source), poses) if plain else run_scans(pipe, poses, args.scans)

    for i, d in enumerate(all_dets, start=1):
        d["id"] = f"d{i}"
    DETECTIONS_FILE.parent.mkdir(exist_ok=True)
    DETECTIONS_FILE.write_text(json.dumps(all_dets, indent=2), encoding="utf-8")
    if pipe.log:
        write_log_sheet(pipe)
    print(f"\n{len(all_dets)} detection(s) -> {DETECTIONS_FILE}")
    print(f"Annotated images -> {ANNOTATED_DIR}")


if __name__ == "__main__":
    main()
