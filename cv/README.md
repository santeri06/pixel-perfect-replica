# VEO360 AutoTag – CV pipeline

Recognises industrial equipment (ABB 615-series protection relay) and its label in digital twin
screenshots. The detector is trained **only on synthetic data** generated from one reference photo.

```
reference photo ─► generate_synthetic.py ─► train.py (YOLOv8n) ─► infer.py (YOLO + EasyOCR + rapidfuzz) ─► outputs/detections.json
                                                                   api.py  (FastAPI: same pipeline over HTTP)
```

## Folders

| Path | Content | In git |
|---|---|---|
| `data/reference/` | reference image(s) + `regions.json` (device / label boxes) | yes |
| `data/backgrounds/` | background images (procedural textures are generated if empty) | no |
| `data/raw/` | raw scan exports (`.e57`) | no |
| `data/test_scans/` | Matterport images (real target domain) + `poses.json` | no |
| `outputs/panoramas/` | web-sized panoramas per scan point (~27 MB) | yes |
| `data/synthetic/` | generated YOLO dataset | no |
| `data/asset_library.json` | mock asset types, identifiers, linked documents | yes |
| `models/`, `runs/` | weights and training runs | no |
| `outputs/` | `preview_grid.png`, `metrics.png`, `sample_predictions.jpg`, `detections.json` | yes |
| `outputs/annotated/` | annotated test scans | no |

## Setup (Windows, PowerShell)

Requires Python 3.12. All commands are run from the `cv` folder.

```powershell
cd cv
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

If activation is blocked, run `Set-ExecutionPolicy -Scope Process RemoteSigned` first, or skip
activation and call `.\.venv\Scripts\python.exe` directly.

For an NVIDIA GPU, install the CUDA build of PyTorch before the requirements:
`pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124`

## 1. Generate synthetic data

Put the reference photo in `data/reference/`, then:

```powershell
python generate_synthetic.py --mark     # drag the DEVICE box (Enter), then each LABEL box (Enter), Esc to finish
python generate_synthetic.py            # later runs reuse data/reference/regions.json
python generate_synthetic.py --n 500    # smaller/faster dataset (default 3000)
```

`regions.json` can also be edited by hand (pixel coordinates in the reference image):

```json
{ "relay.jpg": { "device": [x, y, w, h], "labels": [[x, y, w, h]] } }
```

Each sample pastes 0–3 copies of the device on a random background with scale, rotation and
perspective, label wear (fading, scratches, dirt), colour shift, brightness/contrast, occlusion,
blur, noise and JPEG compression. Output: `data/synthetic/` and `outputs/preview_grid.png`.

## 2. Train

```powershell
python train.py                # YOLOv8n, auto GPU/CPU (8 epochs on CPU, 30 on GPU)
python train.py --epochs 20
```

Output: `models/best.pt`, `outputs/metrics.png`, `outputs/sample_predictions.jpg`.

## 3. Test scans and panoramas from a Matterport E57 export

Put the `.e57` file in `data/raw/` (git-ignored), then:

```powershell
python extract_e57.py          # embedded skybox images -> data/test_scans/ + poses.json
python build_panoramas.py      # web-sized panoramas -> outputs/panoramas/
```

`extract_e57.py` (uses `pye57`) writes the six 4096 px cube faces of every scan point and their
camera poses. `build_panoramas.py` writes, per scan point, `outputs/panoramas/<scanPointId>/`:

- `front.jpg, right.jpg, back.jpg, left.jpg, up.jpg, down.jpg` – 1024 px cube faces in Pannellum
  `cubeMap` order
- `equirect.jpg` – 4096×2048, drop-in for a Pannellum `type: "equirectangular"` viewer
- `outputs/panoramas/index.json` – `[{ scanPointId, position, cubeMap: [...], equirectangular }]`

All panoramas are world-aligned (z up, yaw 0 = world +Y), so the heading is the same at every
scan point and no `northOffset` is needed.

## 4. Inference on the test scans

Screenshots can also be dropped in `data/test_scans/` by hand (then `scanPointId`, `pitch` and
`yaw` are `null`). Then:

```powershell
python infer.py
python infer.py --conf 0.15 --imgsz 1600   # more sensitive, for small/far devices
```

Output: `outputs/detections.json` and annotated images in `outputs/annotated/`.

```json
[{ "id": "d1", "scanPointId": "scan-09", "image": "cloud_0_056.jpg", "assetTypeId": "relay-615",
   "ocrText": "615", "confidence": 0.87, "bbox": [x, y, w, h], "pitch": 12.3, "yaw": -48.1,
   "documents": [ ... ] }]
```

- `bbox` is the device box in pixels of `image`, `[x, y, w, h]`.
- `confidence` = detector confidence × (0.5 + 0.5 × OCR match score). A device with unreadable
  text keeps `assetTypeId: "relay-615"` (the only type the detector knows) at half confidence.
- `scanPointId` is the panorama the tag belongs to (folder name in `outputs/panoramas/`).
- `pitch` / `yaw` are degrees in that panorama, Pannellum convention (yaw positive to the right,
  pitch positive up), computed from the box centre and the camera pose. Use them directly as a
  Pannellum hot spot: `{ pitch, yaw }`.

Detections are filtered before they are written: only `device` boxes with a plausible shape and
|pitch| ≤ 45° are kept, and a box that OCR cannot confirm needs a label region inside it and a
detector confidence ≥ 0.5. OCR-confirmed hits end up at ≥ 0.75; unconfirmed ones stay below 0.5
and are meant for the frontend's review queue (on the test scan about half of them are wrong).

Presentation images (`outputs/detections_overview.jpg`, `tag_check_<scan>.jpg`,
`demo_strong_vs_review.jpg`):

```powershell
python make_demo_images.py --review-id d3
```

## 5. API

```powershell
uvicorn api:app --port 8000
```

- `POST /api/detect` – multipart upload, field `file` → detections JSON (same format as above)
- `GET /api/detections` – contents of `outputs/detections.json`
- `GET /api/panoramas` – contents of `outputs/panoramas/index.json`
- `GET /panoramas/<scanPointId>/front.jpg` … – the panorama images
- Docs: http://localhost:8000/docs

```powershell
curl.exe -F "file=@data/test_scans/scan_01.png" http://localhost:8000/api/detect
```
