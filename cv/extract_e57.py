"""Extract the embedded 2D images of an E57 scan export into data/test_scans.

Usage (PowerShell, from the cv folder):
    python extract_e57.py                         # first .e57 in data/raw
    python extract_e57.py data/raw/cloud_0.e57
"""
import json
import sys
from pathlib import Path

import numpy as np
import pye57

from common import DATA, TEST_SCANS_DIR

RAW_DIR = DATA / "raw"


def read_blob(blob) -> bytes:
    n = blob.byteCount()
    buf = np.zeros(n, dtype=np.uint8)
    blob.read(buf, 0, n)
    return buf.tobytes()


def main() -> None:
    if len(sys.argv) > 1:
        path = Path(sys.argv[1])
    else:
        files = sorted(RAW_DIR.glob("*.e57"))
        if not files:
            raise SystemExit(f"No .e57 file in {RAW_DIR}")
        path = files[0]

    e57 = pye57.E57(str(path))
    root = e57.image_file.root()
    if not root.isDefined("images2D"):
        raise SystemExit("This E57 has no embedded images (images2D).")
    images = root["images2D"]
    TEST_SCANS_DIR.mkdir(parents=True, exist_ok=True)

    meta = {}
    for i in range(images.childCount()):
        node = images[i]
        rep = next((node[k] for k in ("pinholeRepresentation", "sphericalRepresentation",
                                      "cylindricalRepresentation", "visualReferenceRepresentation")
                    if node.isDefined(k)), None)
        if rep is None:
            continue
        ext = "jpg" if rep.isDefined("jpegImage") else "png" if rep.isDefined("pngImage") else None
        if ext is None:
            continue
        name = f"{path.stem}_{i:03d}.{ext}"
        (TEST_SCANS_DIR / name).write_bytes(read_blob(rep["jpegImage" if ext == "jpg" else "pngImage"]))

        info = {"e57Name": node["name"].value() if node.isDefined("name") else None}
        for key in ("imageWidth", "imageHeight", "focalLength", "pixelWidth", "pixelHeight",
                    "principalPointX", "principalPointY"):
            if rep.isDefined(key):
                info[key] = rep[key].value()
        if node.isDefined("pose"):
            pose = node["pose"]
            r, t = pose["rotation"], pose["translation"]
            info["rotation"] = [r[k].value() for k in ("w", "x", "y", "z")]
            info["translation"] = [t[k].value() for k in ("x", "y", "z")]
        meta[name] = info

    (TEST_SCANS_DIR / "poses.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"Extracted {len(meta)} image(s) from {path.name} -> {TEST_SCANS_DIR}")


if __name__ == "__main__":
    main()
