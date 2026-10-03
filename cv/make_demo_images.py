"""Presentation images from outputs/detections.json.

Usage (PowerShell, from the cv folder):
    python make_demo_images.py                    # overview + tag check + strong vs review pair
    python make_demo_images.py --review-id d3     # choose the low-confidence example

Output (outputs/):
    detections_overview.jpg     crop of every detection with id, confidence, scan point, OCR text
    tag_check_<scan>.jpg        panorama with every tag drawn at its pitch/yaw
    demo_strong_vs_review.jpg   OCR-confirmed hit next to a detection that goes to the review queue
"""
import argparse
import json

import cv2
import numpy as np

from common import DETECTIONS_FILE, OUTPUTS_DIR, TEST_SCANS_DIR, imread, imwrite

PANORAMAS_DIR = OUTPUTS_DIR / "panoramas"
FONT = cv2.FONT_HERSHEY_SIMPLEX


def crop_around(d: dict, size: int, margin: float, draw_box: bool = False) -> np.ndarray:
    img = imread(TEST_SCANS_DIR / d["image"])
    x, y, w, h = d["bbox"]
    if draw_box:
        cv2.rectangle(img, (x, y), (x + w, y + h), (0, 200, 0), max(3, w // 60))
    p = int(max(w, h) * margin)
    c = img[max(0, y - p):y + h + p, max(0, x - p):x + w + p]
    return cv2.resize(c, (size, size), interpolation=cv2.INTER_AREA)


def overview(dets: list[dict]) -> None:
    tiles = []
    for d in dets:
        c = crop_around(d, 240, 0.6)
        cv2.rectangle(c, (0, 0), (240, 22), (0, 0, 0), -1)
        txt = f"{d['id']} {d['confidence']:.2f} s{(d['scanPointId'] or '--')[-2:]} {d['ocrText'][:8]}"
        cv2.putText(c, txt, (3, 16), FONT, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
        tiles.append(c)
    while len(tiles) % 8:
        tiles.append(np.zeros((240, 240, 3), np.uint8))
    grid = np.vstack([np.hstack(tiles[i:i + 8]) for i in range(0, len(tiles), 8)])
    imwrite(OUTPUTS_DIR / "detections_overview.jpg", grid, 85)


def tag_check(dets: list[dict], scan_id: str) -> None:
    pano = imread(PANORAMAS_DIR / scan_id / "equirect.jpg")
    H, W = pano.shape[:2]
    for d in (d for d in dets if d["scanPointId"] == scan_id):
        x = int((d["yaw"] / 360 + 0.5) * W)
        y = int((0.5 - d["pitch"] / 180) * H)
        col = (0, 170, 0) if d["confidence"] >= 0.8 else (0, 165, 255) if d["confidence"] >= 0.5 else (0, 0, 230)
        cv2.circle(pano, (x, y), 26, (255, 255, 255), 10)
        cv2.circle(pano, (x, y), 26, col, 6)
        cv2.drawMarker(pano, (x, y), col, cv2.MARKER_CROSS, 70, 4)
        cv2.putText(pano, f"{d['id']} {d['confidence']:.2f}", (x + 40, y - 30), FONT, 1.6, (255, 255, 255), 9, cv2.LINE_AA)
        cv2.putText(pano, f"{d['id']} {d['confidence']:.2f}", (x + 40, y - 30), FONT, 1.6, col, 4, cv2.LINE_AA)
    imwrite(OUTPUTS_DIR / f"tag_check_{scan_id}.jpg", cv2.resize(pano, (W // 2, H // 2), interpolation=cv2.INTER_AREA), 85)


def strong_vs_review(strong: dict, review: dict) -> None:
    panels = []
    for d, title, col in ((strong, "AUTO-TAGGED", (0, 150, 0)), (review, "REVIEW QUEUE", (0, 0, 220))):
        c = crop_around(d, 720, 1.0, draw_box=True)
        bar = np.full((110, 720, 3), 255, np.uint8)
        cv2.putText(bar, f"{title}  {round(d['confidence'] * 100)}%", (16, 44), FONT, 1.2, col, 3, cv2.LINE_AA)
        ocr = f"OCR: '{d['ocrText'][:28]}'" if d["ocrText"] else "OCR: (no readable text)"
        cv2.putText(bar, f"{d['id']}  {d['assetTypeId']}  {ocr}", (16, 90), FONT, 0.7, (40, 40, 40), 2, cv2.LINE_AA)
        panels.append(np.vstack([bar, c]))
    gap = np.full((panels[0].shape[0], 16, 3), 255, np.uint8)
    imwrite(OUTPUTS_DIR / "demo_strong_vs_review.jpg", np.hstack([panels[0], gap, panels[1]]), 88)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--strong-id", help="default: highest confidence")
    ap.add_argument("--review-id", help="default: lowest confidence")
    ap.add_argument("--scan", help="scan point for the tag check (default: scan of the strong hit)")
    args = ap.parse_args()

    dets = json.loads(DETECTIONS_FILE.read_text(encoding="utf-8"))
    if not dets:
        raise SystemExit("detections.json is empty.")
    by_id = {d["id"]: d for d in dets}
    strong = by_id[args.strong_id] if args.strong_id else max(dets, key=lambda d: d["confidence"])
    review = by_id[args.review_id] if args.review_id else min(dets, key=lambda d: d["confidence"])

    overview(dets)
    strong_vs_review(strong, review)
    scan = args.scan or strong["scanPointId"]
    if scan and (PANORAMAS_DIR / scan / "equirect.jpg").exists():
        tag_check(dets, scan)
    print(f"strong={strong['id']} review={review['id']} scan={scan} -> {OUTPUTS_DIR}")


if __name__ == "__main__":
    main()
