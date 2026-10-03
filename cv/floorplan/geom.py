"""Direction conventions for the floor plan (same as cv/geometry.py and scripts/build-registry.mjs).

World frame: the panoramas.json frame, z up, metres.
Panorama angles (degrees, Pannellum convention, cv/geometry.py dir_to_yaw_pitch / yaw_pitch_to_dirs):
    yaw 0 = world +Y, positive to the right (+X); pitch positive up (+Z)
    dir   = (sin(yaw)·cos(pitch), cos(yaw)·cos(pitch), sin(pitch))
    yaw   = atan2(dx, dy), pitch = asin(dz / |d|)
Equirectangular pixel (AssetSheet useCrop): u = (yaw/360 + 0.5)·W, v = (0.5 - pitch/180)·H.
Floor plan pixel: px = (x - xMin)/mpp, py = (yMax - y)/mpp  (+Y = up on the map).

The formulas are re-implemented here instead of imported because cv/geometry.py pulls in
OpenCV via cv/common.py. MIRROR_YAW / YAW_OFFSET_DEG exist so that a convention error found by
the A3 reprojection gate can be corrected in exactly one place; both are neutral by default.
"""
import numpy as np

MIRROR_YAW = False  # set True only if A3 shows a mirrored reprojection (document why)
YAW_OFFSET_DEG = 0.0  # constant yaw shift found by A3 (document why)


def yaw_pitch_to_dirs(yaw_deg, pitch_deg) -> np.ndarray:
    yaw = np.radians((-1 if MIRROR_YAW else 1) * np.asarray(yaw_deg, dtype=np.float64) + YAW_OFFSET_DEG)
    pitch = np.radians(np.asarray(pitch_deg, dtype=np.float64))
    return np.stack([np.sin(yaw) * np.cos(pitch), np.cos(yaw) * np.cos(pitch), np.sin(pitch)], axis=-1)


def dirs_to_yaw_pitch(d: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    d = np.asarray(d, dtype=np.float64)
    n = np.linalg.norm(d, axis=-1)
    yaw = np.degrees(np.arctan2(d[..., 0], d[..., 1])) - YAW_OFFSET_DEG
    if MIRROR_YAW:
        yaw = -yaw
    yaw = (yaw + 180.0) % 360.0 - 180.0
    pitch = np.degrees(np.arcsin(np.clip(d[..., 2] / np.maximum(n, 1e-12), -1, 1)))
    return yaw, pitch


def yaw_pitch_to_equirect(yaw, pitch, width: int, height: int):
    u = (np.asarray(yaw) / 360.0 + 0.5) * width
    v = (0.5 - np.asarray(pitch) / 180.0) * height
    return u, v


def angular_dist_deg(y1, p1, y2, p2) -> np.ndarray:
    r = np.radians
    c = np.sin(r(p1)) * np.sin(r(p2)) + np.cos(r(p1)) * np.cos(r(p2)) * np.cos(r(np.asarray(y1) - y2))
    return np.degrees(np.arccos(np.clip(c, -1, 1)))


def quat_to_matrix(q) -> np.ndarray:
    """(w, x, y, z) -> 3x3 rotation (same formula as cv/geometry.py quat_to_matrix)."""
    w, x, y, z = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def world_to_px(x, y, bounds: dict, mpp: float):
    return (np.asarray(x) - bounds["xMin"]) / mpp, (bounds["yMax"] - np.asarray(y)) / mpp
