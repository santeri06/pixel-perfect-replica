"""Generate a synthetic YOLO dataset (classes: device, label) from reference image(s).

Usage (PowerShell, from the cv folder):
    python generate_synthetic.py --mark        # click the device + label boxes, then generate
    python generate_synthetic.py               # generate using data/reference/regions.json
    python generate_synthetic.py --n 500       # smaller dataset
"""
import argparse
import json
import random
import shutil
from pathlib import Path

import albumentations as A
import cv2
import numpy as np

from common import (BACKGROUNDS_DIR, CLASSES, OUTPUTS_DIR, REFERENCE_DIR, REGIONS_FILE,
                    SYNTHETIC_DIR, imread, imwrite, list_images)

MIN_LABEL_PX = 5      # label boxes smaller than this (shorter side) are dropped
MIN_DEVICE_VISIBLE = 0.6
OPTS = {"max_angle": 0.0, "negatives": []}   # set from the command line in main()


# ----------------------------------------------------------------------------
# Region marking
# ----------------------------------------------------------------------------
def load_regions() -> dict:
    if REGIONS_FILE.exists():
        return json.loads(REGIONS_FILE.read_text(encoding="utf-8"))
    return {}


def save_regions(regions: dict) -> None:
    REGIONS_FILE.write_text(json.dumps(regions, indent=2), encoding="utf-8")


def mark_regions(img: np.ndarray, name: str) -> dict:
    """Simple OpenCV click tool: drag the device box, then one or more label boxes."""
    scale = min(1.0, 900 / max(img.shape[:2]))
    view = cv2.resize(img, None, fx=scale, fy=scale) if scale < 1 else img.copy()

    win = f"{name}: drag DEVICE box, then ENTER"
    x, y, w, h = cv2.selectROI(win, view, showCrosshair=True)
    cv2.destroyWindow(win)
    if w == 0 or h == 0:
        x, y, w, h = 0, 0, view.shape[1], view.shape[0]
    device = [int(v / scale) for v in (x, y, w, h)]

    cv2.rectangle(view, (x, y), (x + w, y + h), (0, 200, 0), 2)
    win = f"{name}: drag each LABEL box + ENTER, ESC when done"
    rois = cv2.selectROIs(win, view, showCrosshair=True)
    cv2.destroyWindow(win)
    labels = [[int(v / scale) for v in r] for r in rois if r[2] > 0 and r[3] > 0]
    return {"device": device, "labels": labels}


def object_mask(crop: np.ndarray) -> np.ndarray:
    """255 = object. Removes a plain white studio background connected to the crop border."""
    white = (crop.min(axis=2) >= 248).astype(np.uint8)
    padded = cv2.copyMakeBorder(white, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=1)
    cv2.floodFill(padded, None, (0, 0), 2)
    mask = np.where(padded[1:-1, 1:-1] == 2, 0, 255).astype(np.uint8)
    return cv2.erode(mask, np.ones((3, 3), np.uint8))


def get_references(mark: bool) -> list[dict]:
    """Return [{'crop': device image, 'labels': [[x,y,w,h] relative to crop]}]."""
    images = list_images(REFERENCE_DIR)
    if not images:
        raise SystemExit(f"No reference images in {REFERENCE_DIR}. Add one and run again.")
    regions = load_regions()
    refs = []
    for path in images:
        img = imread(path)
        if img is None:
            print(f"  ! could not read {path.name}, skipping")
            continue
        if mark or path.name not in regions:
            if mark:
                regions[path.name] = mark_regions(img, path.name)
                save_regions(regions)
            else:
                print(f"  ! {path.name} has no entry in regions.json -> using the whole image as "
                      f"device with no label. Run with --mark to fix.")
                regions[path.name] = {"device": [0, 0, img.shape[1], img.shape[0]], "labels": []}
        r = regions[path.name]
        dx, dy, dw, dh = r["device"]
        crop = img[dy:dy + dh, dx:dx + dw].copy()
        labels = [[lx - dx, ly - dy, lw, lh] for lx, ly, lw, lh in r["labels"]]
        # work at a sane resolution
        s = min(1.0, 800 / max(crop.shape[:2]))
        if s < 1:
            crop = cv2.resize(crop, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
            labels = [[v * s for v in lb] for lb in labels]
        refs.append({"name": path.name, "crop": crop, "labels": labels, "mask": object_mask(crop)})
        print(f"  reference {path.name}: device {dw}x{dh}px, {len(labels)} label region(s)")
    if not refs:
        raise SystemExit("No usable reference images.")
    return refs


# ----------------------------------------------------------------------------
# Backgrounds
# ----------------------------------------------------------------------------
def make_background(size: int, rng: random.Random) -> np.ndarray:
    """Procedural 'switchgear room' texture with distractor boxes and text."""
    base = np.array([rng.randint(60, 220)] * 3, dtype=np.float32) + np.array(
        [rng.randint(-15, 15) for _ in range(3)], dtype=np.float32)
    img = np.ones((size, size, 3), np.float32) * base
    # lighting gradient
    gx = np.linspace(rng.uniform(0.6, 1.0), rng.uniform(0.9, 1.3), size, dtype=np.float32)
    grad = gx[None, :, None] if rng.random() < 0.5 else gx[:, None, None]
    img *= grad
    img = np.clip(img, 0, 255).astype(np.uint8)
    # cabinet panels, doors, vents
    for _ in range(rng.randint(3, 14)):
        x, y = rng.randint(0, size), rng.randint(0, size)
        w, h = rng.randint(20, size // 2), rng.randint(20, size // 2)
        col = [int(np.clip(base[i] + rng.randint(-70, 70), 0, 255)) for i in range(3)]
        thick = -1 if rng.random() < 0.6 else rng.randint(1, 4)
        cv2.rectangle(img, (x, y), (x + w, y + h), col, thick)
    for _ in range(rng.randint(0, 8)):
        p1 = (rng.randint(0, size), rng.randint(0, size))
        p2 = (rng.randint(0, size), rng.randint(0, size))
        cv2.line(img, p1, p2, [rng.randint(0, 255)] * 3, rng.randint(1, 3))
    # distractor text so 'any text' is not a label
    for _ in range(rng.randint(0, 6)):
        txt = "".join(rng.choice("ABCDEFGHKLMNPRSTUVXZ0123456789-") for _ in range(rng.randint(3, 8)))
        cv2.putText(img, txt, (rng.randint(0, size - 60), rng.randint(20, size)),
                    rng.choice([cv2.FONT_HERSHEY_SIMPLEX, cv2.FONT_HERSHEY_DUPLEX]),
                    rng.uniform(0.3, 1.2), [rng.randint(0, 255)] * 3, rng.randint(1, 2), cv2.LINE_AA)
    noise = np.random.normal(0, rng.uniform(2, 10), img.shape)
    img = np.clip(img.astype(np.float32) + noise, 0, 255).astype(np.uint8)
    if rng.random() < 0.5:
        img = cv2.GaussianBlur(img, (0, 0), rng.uniform(0.5, 2.5))
    return img


def ensure_backgrounds(n: int, rng: random.Random, folder: Path = BACKGROUNDS_DIR) -> list[np.ndarray]:
    folder.mkdir(parents=True, exist_ok=True)
    paths = list_images(folder)
    if not paths:
        print(f"  backgrounds folder is empty -> generating {n} procedural textures")
        for i in range(n):
            imwrite(folder / f"gen_{i:03d}.jpg", make_background(768, rng), 88)
        paths = list_images(folder)
    bgs = [b for b in (imread(p) for p in paths[:400]) if b is not None]
    print(f"  {len(bgs)} background image(s)")
    return bgs


def sample_background(bgs: list[np.ndarray], size: int, rng: random.Random) -> np.ndarray:
    bg = rng.choice(bgs)
    h, w = bg.shape[:2]
    cs = rng.randint(int(min(h, w) * 0.5), min(h, w))
    x, y = rng.randint(0, w - cs), rng.randint(0, h - cs)
    out = cv2.resize(bg[y:y + cs, x:x + cs], (size, size), interpolation=cv2.INTER_AREA)
    if rng.random() < 0.5:
        out = cv2.flip(out, 1)
    return out


# ----------------------------------------------------------------------------
# Object augmentation
# ----------------------------------------------------------------------------
OBJECT_AUG = A.Compose([
    A.RandomBrightnessContrast(brightness_limit=0.35, contrast_limit=0.35, p=0.9),
    A.HueSaturationValue(hue_shift_limit=8, sat_shift_limit=30, val_shift_limit=20, p=0.6),
    A.RGBShift(r_shift_limit=18, g_shift_limit=18, b_shift_limit=18, p=0.5),
    A.RandomGamma(gamma_limit=(70, 140), p=0.4),
])

IMAGE_AUG = A.Compose([
    A.OneOf([
        A.MotionBlur(blur_limit=(3, 9)),
        A.GaussianBlur(blur_limit=(3, 7)),
    ], p=0.55),
    A.GaussNoise(std_range=(0.01, 0.06), p=0.5),
    A.RandomBrightnessContrast(brightness_limit=0.2, contrast_limit=0.2, p=0.5),
    A.RGBShift(r_shift_limit=10, g_shift_limit=10, b_shift_limit=10, p=0.3),
    A.ImageCompression(quality_range=(30, 90), p=0.7),
])


def wear_label(crop: np.ndarray, box, rng: random.Random) -> None:
    """Simulated label wear (fading, scratches, dirt), in place."""
    x, y, w, h = [int(round(v)) for v in box]
    x, y = max(x, 0), max(y, 0)
    roi = crop[y:y + h, x:x + w]
    if roi.size == 0:
        return
    if rng.random() < 0.5:  # fading towards the mean colour
        a = rng.uniform(0.1, 0.55)
        mean = roi.reshape(-1, 3).mean(axis=0)
        roi[:] = (roi * (1 - a) + mean * a).astype(np.uint8)
    if rng.random() < 0.5:  # scratches
        for _ in range(rng.randint(1, 6)):
            p1 = (rng.randint(0, max(w - 1, 1)), rng.randint(0, max(h - 1, 1)))
            p2 = (rng.randint(0, max(w - 1, 1)), rng.randint(0, max(h - 1, 1)))
            cv2.line(roi, p1, p2, [rng.randint(120, 255)] * 3, 1, cv2.LINE_AA)
    if rng.random() < 0.3:  # dirt spots
        for _ in range(rng.randint(1, 4)):
            c = (rng.randint(0, max(w - 1, 1)), rng.randint(0, max(h - 1, 1)))
            cv2.circle(roi, c, rng.randint(1, max(2, h // 5)), [rng.randint(20, 90)] * 3, -1)


def view_from_side(w: int, h: int, rng: random.Random, max_angle: float) -> np.float32:
    """Corners of the w x h front seen from the side: turned up to max_angle about the vertical axis."""
    yaw = np.radians(rng.uniform(-max_angle, max_angle))
    pitch = np.radians(rng.gauss(0, 8))
    ry = np.array([[np.cos(yaw), 0, np.sin(yaw)], [0, 1, 0], [-np.sin(yaw), 0, np.cos(yaw)]])
    rx = np.array([[1, 0, 0], [0, np.cos(pitch), -np.sin(pitch)], [0, np.sin(pitch), np.cos(pitch)]])
    corners = np.array([[-w / 2, -h / 2, 0], [w / 2, -h / 2, 0], [w / 2, h / 2, 0], [-w / 2, h / 2, 0]]) @ (rx @ ry).T
    dist = w * rng.uniform(1.5, 5.0)           # close = strong perspective, far = nearly parallel
    return np.float32(corners[:, :2] * (dist / (dist + corners[:, 2:3])))


def random_homography(w: int, h: int, size: int, rng: random.Random) -> np.ndarray:
    """Scale + rotation + perspective + translation, mapping the crop into the canvas."""
    target_h = size * rng.uniform(0.07, 0.6)   # small objects matter: scans show devices far away
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    if OPTS["max_angle"] and rng.random() < 0.75:
        dst = view_from_side(w, h, rng, OPTS["max_angle"])
        dst *= target_h / (dst[:, 1].max() - dst[:, 1].min())
        ow, oh = dst[:, 0].max() - dst[:, 0].min(), target_h
    else:
        s = target_h / h
        ow, oh = w * s, h * s
        dst = np.float32([[0, 0], [ow, 0], [ow, oh], [0, oh]])
    jitter = rng.uniform(0, 0.14 if not OPTS["max_angle"] else 0.05)   # perspective
    dst += np.float32([[rng.uniform(-jitter, jitter) * ow, rng.uniform(-jitter, jitter) * oh]
                       for _ in range(4)])
    ang = np.deg2rad(rng.gauss(0, 5))          # rotation
    c, s_ = np.cos(ang), np.sin(ang)
    centre = dst.mean(axis=0)
    dst = (dst - centre) @ np.float32([[c, s_], [-s_, c]]) + centre
    dst -= dst.min(axis=0)
    bw, bh = dst.max(axis=0)
    margin = 0.15                              # allow slightly out-of-frame objects
    tx = rng.uniform(-margin * bw, size - bw * (1 - margin))
    ty = rng.uniform(-margin * bh, size - bh * (1 - margin))
    dst += np.float32([tx, ty])
    return cv2.getPerspectiveTransform(src, dst.astype(np.float32))


def warp_box(H: np.ndarray, box) -> np.ndarray:
    x, y, w, h = box
    pts = np.float32([[[x, y], [x + w, y], [x + w, y + h], [x, y + h]]])
    q = cv2.perspectiveTransform(pts, H)[0]
    return np.array([q[:, 0].min(), q[:, 1].min(), q[:, 0].max(), q[:, 1].max()])


def clip_box(b: np.ndarray, size: int) -> np.ndarray:
    return np.clip(b, 0, size - 1)


def area(b) -> float:
    return max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])


def iou(a, b) -> float:
    inter = area([max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])])
    return inter / (area(a) + area(b) - inter + 1e-9)


def compose_sample(refs, bgs, size: int, rng: random.Random):
    """Return (image, [(class_id, x1, y1, x2, y2)])."""
    canvas = sample_background(bgs, size, rng)
    # hard negatives: real objects the detector used to confuse with the device, pasted unlabelled
    for _ in range(rng.choice([0, 1, 1, 2, 3]) if OPTS["negatives"] else 0):
        neg = rng.choice(OPTS["negatives"])
        nh = int(size * rng.uniform(0.06, 0.4))
        nw = int(np.clip(nh * neg.shape[1] / neg.shape[0] * rng.uniform(0.7, 1.4), 8, size - 1))
        nh = min(nh, size - 1)
        patch = cv2.resize(neg, (nw, nh), interpolation=cv2.INTER_AREA)
        x, y = rng.randint(0, size - nw), rng.randint(0, size - nh)
        m = np.zeros((nh, nw), np.float32)
        b = max(1, min(nh, nw) // 8)
        m[b:-b, b:-b] = 1
        m = cv2.GaussianBlur(m, (0, 0), b / 2)[..., None]
        canvas[y:y + nh, x:x + nw] = (patch * m + canvas[y:y + nh, x:x + nw] * (1 - m)).astype(np.uint8)
    boxes = []
    n_obj = rng.choices([0, 1, 2, 3], weights=[0.08, 0.62, 0.22, 0.08])[0]
    placed = []
    for _ in range(n_obj):
        ref = rng.choice(refs)
        crop = ref["crop"].copy()
        for lb in ref["labels"]:
            wear_label(crop, lb, rng)
        crop = OBJECT_AUG(image=crop)["image"]
        h, w = crop.shape[:2]

        for _attempt in range(10):
            H = random_homography(w, h, size, rng)
            full = warp_box(H, [0, 0, w, h])
            dev = clip_box(full, size)
            if area(dev) < MIN_DEVICE_VISIBLE * area(full):
                continue
            if any(iou(dev, p) > 0.02 for p in placed):
                continue
            break
        else:
            continue
        placed.append(dev)

        warped = cv2.warpPerspective(crop, H, (size, size), flags=cv2.INTER_LINEAR)
        mask = cv2.warpPerspective(ref["mask"], H, (size, size))
        mask = cv2.GaussianBlur(mask, (0, 0), rng.uniform(0.6, 1.5)).astype(np.float32)[..., None] / 255
        canvas = (warped * mask + canvas * (1 - mask)).astype(np.uint8)

        # random occlusion (cables, hands, other equipment)
        occluders = []
        if rng.random() < 0.3:
            dw, dh = dev[2] - dev[0], dev[3] - dev[1]
            for _ in range(rng.randint(1, 2)):
                ow, oh = dw * rng.uniform(0.08, 0.3), dh * rng.uniform(0.08, 0.3)
                ox = rng.uniform(dev[0], dev[2] - ow)
                oy = rng.uniform(dev[1], dev[3] - oh)
                o = [int(ox), int(oy), int(ox + ow), int(oy + oh)]
                if o[2] <= o[0] or o[3] <= o[1]:
                    continue
                if rng.random() < 0.5:
                    canvas[o[1]:o[3], o[0]:o[2]] = [rng.randint(0, 255) for _ in range(3)]
                else:
                    patch = sample_background(bgs, size, rng)
                    canvas[o[1]:o[3], o[0]:o[2]] = patch[o[1]:o[3], o[0]:o[2]]
                occluders.append(o)

        boxes.append((0, *dev))
        for lb in ref["labels"]:
            full_l = warp_box(H, lb)
            l = clip_box(full_l, size)
            if area(l) < 0.6 * area(full_l) or min(l[2] - l[0], l[3] - l[1]) < MIN_LABEL_PX:
                continue
            covered = sum(area([max(l[0], o[0]), max(l[1], o[1]), min(l[2], o[2]), min(l[3], o[3])])
                          for o in occluders)
            if covered > 0.5 * area(l):
                continue
            boxes.append((1, *l))

    # soft, low-res look of digital twin screenshots
    if rng.random() < 0.4:
        f = rng.uniform(0.4, 0.85)
        small = cv2.resize(canvas, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
        canvas = cv2.resize(small, (size, size), interpolation=cv2.INTER_LINEAR)
    canvas = IMAGE_AUG(image=canvas)["image"]
    return canvas, boxes


# ----------------------------------------------------------------------------
# Dataset writing
# ----------------------------------------------------------------------------
def to_yolo(boxes, size: int) -> str:
    lines = []
    for cls, x1, y1, x2, y2 in boxes:
        cx, cy = (x1 + x2) / 2 / size, (y1 + y2) / 2 / size
        w, h = (x2 - x1) / size, (y2 - y1) / size
        lines.append(f"{cls} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}")
    return "\n".join(lines)


def draw_boxes(img: np.ndarray, boxes) -> np.ndarray:
    out = img.copy()
    colors = [(0, 200, 0), (0, 140, 255)]
    for cls, x1, y1, x2, y2 in boxes:
        cv2.rectangle(out, (int(x1), int(y1)), (int(x2), int(y2)), colors[cls], 2)
        cv2.putText(out, CLASSES[cls], (int(x1), max(12, int(y1) - 4)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, colors[cls], 1, cv2.LINE_AA)
    return out


def main() -> None:
    global SYNTHETIC_DIR
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--n", type=int, default=3000, help="number of images (default 3000)")
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--val", type=float, default=0.15, help="validation fraction")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--mark", action="store_true", help="open the click tool to mark device/label boxes")
    ap.add_argument("--out", default=str(SYNTHETIC_DIR), help="dataset folder")
    ap.add_argument("--backgrounds", default=str(BACKGROUNDS_DIR), help="folder with background images")
    ap.add_argument("--negatives", help="folder with hard-negative crops pasted as unlabelled distractors")
    ap.add_argument("--max-angle", type=float, default=0,
                    help="also show the device from the side, turned up to this many degrees (e.g. 75)")
    ap.add_argument("--preview", default=str(OUTPUTS_DIR / "preview_grid.png"), help="preview grid image")
    args = ap.parse_args()
    SYNTHETIC_DIR = Path(args.out)

    rng = random.Random(args.seed)
    np.random.seed(args.seed)

    print("Loading references...")
    refs = get_references(args.mark)
    bgs = ensure_backgrounds(80, rng, Path(args.backgrounds))
    OPTS["max_angle"] = args.max_angle
    if args.negatives:
        OPTS["negatives"] = [n for n in (imread(p) for p in list_images(Path(args.negatives))) if n is not None]
        print(f"  {len(OPTS['negatives'])} hard-negative crop(s)")

    if SYNTHETIC_DIR.exists():
        shutil.rmtree(SYNTHETIC_DIR)
    for split in ("train", "val"):
        (SYNTHETIC_DIR / "images" / split).mkdir(parents=True)
        (SYNTHETIC_DIR / "labels" / split).mkdir(parents=True)

    n_val = int(args.n * args.val)
    preview, counts = [], [0, 0]
    print(f"Generating {args.n} images ({args.n - n_val} train / {n_val} val)...")
    for i in range(args.n):
        split = "val" if i < n_val else "train"
        img, boxes = compose_sample(refs, bgs, args.imgsz, rng)
        imwrite(SYNTHETIC_DIR / "images" / split / f"syn_{i:05d}.jpg", img, 90)
        (SYNTHETIC_DIR / "labels" / split / f"syn_{i:05d}.txt").write_text(to_yolo(boxes, args.imgsz))
        for b in boxes:
            counts[b[0]] += 1
        if len(preview) < 16 and boxes:
            preview.append(cv2.resize(draw_boxes(img, boxes), (256, 256), interpolation=cv2.INTER_AREA))
        if (i + 1) % 250 == 0:
            print(f"  {i + 1}/{args.n}")

    (SYNTHETIC_DIR / "dataset.yaml").write_text(
        f"path: {SYNTHETIC_DIR.as_posix()}\ntrain: images/train\nval: images/val\n"
        f"names:\n  0: {CLASSES[0]}\n  1: {CLASSES[1]}\n", encoding="utf-8")

    while len(preview) < 16:
        preview.append(np.zeros((256, 256, 3), np.uint8))
    grid = np.vstack([np.hstack(preview[r * 4:r * 4 + 4]) for r in range(4)])
    imwrite(Path(args.preview), grid)

    print(f"Done. device boxes: {counts[0]}, label boxes: {counts[1]}")
    print(f"Dataset: {SYNTHETIC_DIR}")
    print(f"Preview: {args.preview}")


if __name__ == "__main__":
    main()
