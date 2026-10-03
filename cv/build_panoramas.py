"""Build web-sized, world-aligned panoramas for every scan point from the E57 skybox images.

Usage (PowerShell, from the cv folder):
    python build_panoramas.py                 # cubemap faces (1024 px) + equirectangular (4096x2048)
    python build_panoramas.py --face 2048
    python build_panoramas.py --no-equirect

Output: outputs/panoramas/<scanPointId>/{front,right,back,left,up,down}.jpg, equirect.jpg
        outputs/panoramas/index.json
"""
import argparse
import json

import cv2
import numpy as np

from common import OUTPUTS_DIR, TEST_SCANS_DIR, imread, imwrite
from geometry import load_poses, world_dirs_to_pixels, yaw_pitch_to_dirs

PANORAMAS_DIR = OUTPUTS_DIR / "panoramas"

# Pannellum cubemap order. Each face: (forward, right, up) in world coordinates (z up, yaw 0 = +Y).
FACES = {
    "front": ((0, 1, 0), (1, 0, 0), (0, 0, 1)),
    "right": ((1, 0, 0), (0, -1, 0), (0, 0, 1)),
    "back": ((0, -1, 0), (-1, 0, 0), (0, 0, 1)),
    "left": ((-1, 0, 0), (0, 1, 0), (0, 0, 1)),
    "up": ((0, 0, 1), (1, 0, 0), (0, -1, 0)),
    "down": ((0, 0, -1), (1, 0, 0), (0, 1, 0)),
}


def face_dirs(name: str, size: int) -> np.ndarray:
    fwd, right, up = (np.array(a, float) for a in FACES[name])
    t = (np.arange(size) + 0.5) / size * 2 - 1
    xs, ys = np.meshgrid(t, -t)
    return fwd + xs[..., None] * right + ys[..., None] * up


def equirect_dirs(width: int) -> np.ndarray:
    height = width // 2
    yaw = ((np.arange(width) + 0.5) / width - 0.5) * 360
    pitch = (0.5 - (np.arange(height) + 0.5) / height) * 180
    return yaw_pitch_to_dirs(*np.meshgrid(yaw, pitch))


def sample(sources: list[tuple[dict, np.ndarray]], dirs: np.ndarray) -> np.ndarray:
    """Colour for every direction, taken from the source image that sees it most centrally."""
    out = np.zeros(dirs.shape[:2] + (3,), np.uint8)
    best = np.full(dirs.shape[:2], -1.0)
    for info, img in sources:
        u, v, cos = world_dirs_to_pixels(info, dirs)
        s = img.shape[1] / info["imageWidth"]  # sources may be pre-shrunk
        mx = ((u + 0.5) * s - 0.5).astype(np.float32)
        my = ((v + 0.5) * s - 0.5).astype(np.float32)
        warped = cv2.remap(img, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        take = cos > best
        out[take] = warped[take]
        best = np.where(take, cos, best)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--face", type=int, default=1024, help="cube face size in px")
    ap.add_argument("--equirect-width", type=int, default=4096)
    ap.add_argument("--no-equirect", action="store_true")
    args = ap.parse_args()

    poses = load_poses()
    if not poses:
        raise SystemExit("No poses.json. Run extract_e57.py first.")
    scans: dict[str, list[str]] = {}
    for name, info in poses.items():
        scans.setdefault(info["scanPointId"], []).append(name)

    src_size = max(args.face * 2, 0 if args.no_equirect else args.equirect_width // 2)
    index = []
    for scan_id, names in scans.items():
        sources = []
        for n in names:
            img = imread(TEST_SCANS_DIR / n)
            if img.shape[1] > src_size:  # shrink first so the resampling does not alias
                img = cv2.resize(img, (src_size, src_size), interpolation=cv2.INTER_AREA)
            sources.append((poses[n], img))

        for face in FACES:
            big = sample(sources, face_dirs(face, args.face * 2))
            small = cv2.resize(big, (args.face, args.face), interpolation=cv2.INTER_AREA)
            imwrite(PANORAMAS_DIR / scan_id / f"{face}.jpg", small, 85)
        entry = {
            "scanPointId": scan_id,
            "position": poses[names[0]]["translation"],
            "sourceImages": names,
            "cubeMap": [f"{scan_id}/{f}.jpg" for f in FACES],
        }
        if not args.no_equirect:
            eq = sample(sources, equirect_dirs(args.equirect_width))
            imwrite(PANORAMAS_DIR / scan_id / "equirect.jpg", eq, 82)
            entry["equirectangular"] = f"{scan_id}/equirect.jpg"
        index.append(entry)
        print(f"  {scan_id}: done")

    (PANORAMAS_DIR / "index.json").write_text(json.dumps(index, indent=2), encoding="utf-8")
    print(f"{len(index)} panorama(s) -> {PANORAMAS_DIR}")


if __name__ == "__main__":
    main()
