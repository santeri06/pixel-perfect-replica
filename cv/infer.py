"""Run the trained model on data/test_scans, OCR the labels and write outputs/detections.json.

Usage (PowerShell, from the cv folder):
    python infer.py
    python infer.py --conf 0.15 --imgsz 1600
"""
import argparse
import json
from pathlib import Path

from common import ANNOTATED_DIR, DETECTIONS_FILE, TEST_SCANS_DIR, imread, imwrite, list_images
from geometry import load_poses
from pipeline import AutoTagPipeline


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--source", default=str(TEST_SCANS_DIR), help="folder with screenshots")
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--imgsz", type=int, default=1280)
    args = ap.parse_args()

    images = list_images(Path(args.source))
    if not images:
        raise SystemExit(f"No images in {args.source}.")

    pipe = AutoTagPipeline(conf=args.conf, imgsz=args.imgsz)
    poses = load_poses()  # camera poses from extract_e57.py -> scanPointId, pitch, yaw
    all_dets = []
    for path in images:
        img = imread(path)
        if img is None:
            print(f"  ! could not read {path.name}")
            continue
        dets, annotated = pipe.detect(img, path.name, id_prefix=path.stem, pose=poses.get(path.name))
        imwrite(ANNOTATED_DIR / f"{path.stem}.jpg", annotated, 88)
        all_dets.extend(dets)
        print(f"  {path.name}: {len(dets)} detection(s)")
        for d in dets:
            print(f"     {d['assetTypeId']}  conf={d['confidence']}  yaw={d['yaw']} pitch={d['pitch']}  ocr='{d['ocrText']}'")

    for i, d in enumerate(all_dets, start=1):
        d["id"] = f"d{i}"
    DETECTIONS_FILE.parent.mkdir(exist_ok=True)
    DETECTIONS_FILE.write_text(json.dumps(all_dets, indent=2), encoding="utf-8")
    print(f"\n{len(all_dets)} detection(s) -> {DETECTIONS_FILE}")
    print(f"Annotated images -> {ANNOTATED_DIR}")


if __name__ == "__main__":
    main()
