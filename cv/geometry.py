"""Camera geometry for the E57 skybox images: pixel <-> world direction <-> panorama yaw/pitch.

Conventions
- E57 pinhole camera: +x right, +y up, looks along -z. `rotation` (w, x, y, z) maps camera -> world.
- World: z up. All panoramas are world-aligned, so every scan point shares the same heading.
- Panorama angles (degrees, Pannellum convention): yaw 0 = world +Y (centre of the 'front' cube
  face / centre column of the equirectangular image), positive to the right; pitch positive up.
"""
import json
from pathlib import Path

import numpy as np

from common import TEST_SCANS_DIR

POSES_FILE = TEST_SCANS_DIR / "poses.json"


def quat_to_matrix(q) -> np.ndarray:
    w, x, y, z = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def load_poses(path: Path = POSES_FILE) -> dict:
    """poses.json with a 'scanPointId' added to every image (images grouped by camera position)."""
    if not path.exists():
        return {}
    poses = json.loads(path.read_text(encoding="utf-8"))
    ids = {}
    for info in poses.values():
        if "translation" not in info:
            continue
        key = tuple(round(v, 2) for v in info["translation"])
        ids.setdefault(key, f"scan-{len(ids):02d}")
        info["scanPointId"] = ids[key]
    return poses


def pixel_to_world_dir(info: dict, u: float, v: float) -> np.ndarray:
    """Unit world direction of pixel (u, v) of an image described by a poses.json entry."""
    x = (u - info["principalPointX"]) * info["pixelWidth"]
    y = -(v - info["principalPointY"]) * info["pixelHeight"]
    d = quat_to_matrix(info["rotation"]) @ np.array([x, y, -info["focalLength"]])
    return d / np.linalg.norm(d)


def world_dirs_to_pixels(info: dict, dirs: np.ndarray):
    """dirs (..., 3) -> (u, v, cos) arrays; cos <= 0 means the direction is behind the camera."""
    cam = dirs @ quat_to_matrix(info["rotation"])  # R^T d for every direction
    depth = -cam[..., 2]
    safe = np.where(depth > 1e-6, depth, 1e-6)
    u = info["principalPointX"] + cam[..., 0] / safe * info["focalLength"] / info["pixelWidth"]
    v = info["principalPointY"] - cam[..., 1] / safe * info["focalLength"] / info["pixelHeight"]
    return u, v, depth / np.linalg.norm(cam, axis=-1)


def dir_to_yaw_pitch(d: np.ndarray) -> tuple[float, float]:
    yaw = float(np.degrees(np.arctan2(d[0], d[1])))
    pitch = float(np.degrees(np.arcsin(np.clip(d[2], -1, 1))))
    return yaw, pitch


def yaw_pitch_to_dirs(yaw_deg: np.ndarray, pitch_deg: np.ndarray) -> np.ndarray:
    yaw, pitch = np.radians(yaw_deg), np.radians(pitch_deg)
    return np.stack([np.sin(yaw) * np.cos(pitch), np.cos(yaw) * np.cos(pitch), np.sin(pitch)], axis=-1)


def pixel_to_yaw_pitch(info: dict, u: float, v: float) -> tuple[float, float]:
    return dir_to_yaw_pitch(pixel_to_world_dir(info, u, v))
