# Floor plan (feat/floorplan)

Builds a top-down floor plan of the switchgear room from the E57 point cloud and places
every physical relay on it (`public/floorplan/floorplan.png` + `src/data/floorplan.json`).
The full task description is in [PROMPT.md](PROMPT.md).

## Setup (Windows, PowerShell)
Run `setup_floorplan.ps1` once (clones the repo to `$HOME\dev\autotag-floorplan`,
switches to `feat/floorplan`, copies `cloud_0.e57` to `cv\data\raw\` (git-ignored) and creates
the Python venv). Then either one command that does everything (selftest, run, tests, commit +
push of the data, or of the gate report only if a gate fails):

```powershell
powershell -ExecutionPolicy Bypass -File $HOME\dev\autotag-floorplan\cv\floorplan\run_floorplan.ps1
```

or step by step:

```powershell
cd $HOME\dev\autotag-floorplan\cv\floorplan
.\.venv\Scripts\Activate.ps1
python selftest.py                                            # 2-3 min, synthetic data, proves the code paths
python build_floorplan.py --e57 ..\data\raw\cloud_0.e57 --headers-only   # stage 0: headers + scan pairing
python build_floorplan.py --e57 ..\data\raw\cloud_0.e57 --cache          # full run (2nd run uses cache/)
```

`--npz-dir <folder>` reads the output of `export_e57.py` instead of the .e57 (already voxelized at 2 cm).
Node (or bun) must be on PATH: the triangulation reference runs `triangulate.mjs`, which calls
`clusterDetections()` from `scripts/build-registry.mjs` unchanged.

## Gates
| Gate | Check | On failure |
|---|---|---|
| A0 | every E57 scan pairs 1:1 with a `panoramas.json` scan point by translation, < 0.10 m | exit 2, nothing computed |
| A3 | cloud reprojected into scan-01/07/12 vs `equirect.jpg`: edge NCC peak shift < 0.5° yaw and pitch, not mirrored, distinct peak | exit 3; fix `geom.py` (`MIRROR_YAW`, `YAW_OFFSET_DEG`) |
| A5 | ray first-hit for ≥ 80 % of auto detections, median raycast vs triangulation < 0.10 m | not published |
| A6 | every multi-view triangulation cluster maps to its own device (row of 5 + stacked pair) | not published |
| walkway | < 5 % of scan points on an obstacle pixel | not published |
| sizes | png < 1 MB, json < 100 kB | not published |

Only when every gate passes are `public/floorplan/floorplan.png` and `src/data/floorplan.json`
written; otherwise the result goes to `cache/rejected/` (git-ignored) for inspection and the exit
code is non-zero. `report.json`, `check.png` and `check_reprojection_scan-XX.png` are always written.

## Deviations from PROMPT.md (and why)
- Rays are cast into a **1 cm** voxel cloud (`--ray-voxel`), the floor plan uses the 4 cm cloud
  (`--voxel`). With 4 cm voxels a 3 cm ray cylinder contains ~2 points per surface, so the
  "≥ 8 points within ±5 cm" first-hit rule could never fire.
- Occupancy is counted per **voxel-sized cell** (4 cm), then scaled to 1600 px (≈ 7 mm/px).
  Counting "≥ 3 points per 7 mm pixel" from a 4 cm cloud would leave every pixel empty.
- Obstacle cleanup removes connected specks < 4 cells instead of a 1-px opening, which erased walls.
- A3 uses masked normalized cross-correlation over all yaw shifts (so a constant 90° or mirrored
  convention error is detected, not only small shifts) and a ±7° row search for pitch.
