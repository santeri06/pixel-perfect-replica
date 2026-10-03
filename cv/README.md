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
| `../E57/` | raw scan exports (`.e57`), read first | no |
| `data/raw/` | raw scan exports (`.e57`), fallback | no |
| `data/test_scans/` | Matterport images (real target domain) + `poses.json` | no |
| `outputs/panoramas/` | web-sized panoramas per scan point (~27 MB); the frontend copy is in `public/panoramas/` | no |
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

Put the `.e57` file in the repo-root `E57/` folder (git-ignored; `data/raw/` also works), then:

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

With `poses.json` present, `infer.py` searches every scan point as a panorama. Plain screenshots
can also be dropped in `data/test_scans/` and processed one by one with `--plain` (then
`scanPointId`, `pitch` and `yaw` are `null`).

```powershell
python infer.py
python infer.py --scans scan-09 scan-12    # only some scan points
python infer.py --plain                    # every image on its own, no panorama search
```

Output: `outputs/detections.json` and annotated images in `outputs/annotated/`.

```json
[{ "id": "d1", "scanPointId": "scan-09", "image": "scan-09_f45_s1_y+060_p+00.jpg", "assetTypeId": "relay-615",
   "ocrText": "615", "confidence": 0.87, "bbox": [x, y, w, h], "pitch": 12.3, "yaw": -48.1,
   "documents": [ ... ] }]
```

- `image` is the rendered view the box was taken from (saved in `outputs/views/`, git-ignored);
  `bbox` is the device box in its pixels, `[x, y, w, h]`.
- `confidence` = detector confidence × (0.5 + 0.5 × OCR match score). A device with unreadable
  text keeps `assetTypeId: "relay-615"` (the only type the detector knows) at half confidence.
- `scanPointId` is the panorama the tag belongs to (folder name in `outputs/panoramas/`).
- `pitch` / `yaw` are degrees in that panorama, Pannellum convention (yaw positive to the right,
  pitch positive up), computed from the box centre and the camera pose. Use them directly as a
  Pannellum hot spot: `{ pitch, yaw }`.

How a scan point is searched (`pipeline.py`, `detect_scan`):

1. **Overlapping views.** 174 views are rendered from the skybox images: 8 wide (90°), 24 zoomed
   (45°), and 142 zoomed views stretched horizontally 2× / 3.5×. Zooming finds small, far devices;
   stretching makes a panel seen at a steep angle look frontal, which the detector needs because
   the synthetic data only contains mild perspective. Views overlap, so nothing is cut at a seam.
2. **Shape filters.** Only `device` boxes with a plausible aspect ratio and |pitch| ≤ 45° are kept.
3. **Merging.** Hits on the same object from different views are merged by direction.
4. **Visual check.** Each candidate is compared with the reference photo using ImageNet features
   (ResNet18, no training). Stools, door handles and signs are rejected here.
5. **OCR.** The label is read from a full-resolution close-up and fuzzy-matched to the asset type.

`confidence` is the detector confidence scaled by the stronger of the OCR match and the visual
similarity. Candidates that only roughly resemble the reference are kept at half confidence for
manual review. On the 18 test scan points this gives 74 detections: 62 at ≥ 0.75 (all correct)
and 12 below (7 correct). The visual-check thresholds were tuned by eye on these same scan
points, so expect to re-tune them on another site. A full run takes about 2.5 min per scan
point on CPU.

Presentation images (`outputs/detections_overview.jpg`, `tag_check_<scan>.jpg`,
`demo_strong_vs_review.jpg`) and a before/after comparison of two runs:

```powershell
python make_demo_images.py --strong-id d39 --review-id d16 --scan scan-12
python compare_runs.py runs/detections_before.json outputs/detections.json
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
