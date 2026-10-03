"""Shared paths and small helpers for the VEO360 AutoTag CV pipeline."""
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
E57_DIR = ROOT.parent / "E57"
REFERENCE_DIR = DATA / "reference"
REGIONS_FILE = REFERENCE_DIR / "regions.json"
BACKGROUNDS_DIR = DATA / "backgrounds"
TEST_SCANS_DIR = DATA / "test_scans"
SYNTHETIC_DIR = DATA / "synthetic"
ASSET_LIBRARY = DATA / "asset_library.json"
MODELS_DIR = ROOT / "models"
RUNS_DIR = ROOT / "runs"
OUTPUTS_DIR = ROOT / "outputs"
ANNOTATED_DIR = OUTPUTS_DIR / "annotated"
DETECTIONS_FILE = OUTPUTS_DIR / "detections.json"
BEST_WEIGHTS = MODELS_DIR / "best.pt"

CLASSES = ["device", "label"]
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def list_images(folder: Path) -> list[Path]:
    if not folder.exists():
        return []
    return sorted(p for p in folder.iterdir() if p.suffix.lower() in IMAGE_EXTS)


def imread(path: Path) -> np.ndarray | None:
    """cv2.imread that also works with non-ASCII Windows paths."""
    data = np.fromfile(str(path), dtype=np.uint8)
    if data.size == 0:
        return None
    return cv2.imdecode(data, cv2.IMREAD_COLOR)


def imwrite(path: Path, img: np.ndarray, quality: int = 92) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    ext = path.suffix.lower()
    params = [cv2.IMWRITE_JPEG_QUALITY, quality] if ext in (".jpg", ".jpeg") else []
    ok, buf = cv2.imencode(ext, img, params)
    if not ok:
        raise IOError(f"Could not encode {path}")
    buf.tofile(str(path))
