# Floor plan (feat/floorplan)

Builds a top-down floor plan of the switchgear room from the E57 point cloud and places
every physical relay on it (`public/floorplan/floorplan.png` + `src/data/floorplan.json`).
The full task description for the Claude Code session is in [PROMPT.md](PROMPT.md).

## Setup (Windows, PowerShell)
Run `setup_floorplan.ps1` once (clones the repo to `C:\Users\arttu\dev\autotag-floorplan`,
switches to `feat/floorplan`, copies `cloud_0.e57` to `cv\data\raw\` (git-ignored) and creates
the Python venv). Then:

```powershell
cd C:\Users\arttu\dev\autotag-floorplan\cv\floorplan
.\.venv\Scripts\Activate.ps1
python build_floorplan.py --e57 ..\data\raw\cloud_0.e57
```

The point cloud is never committed (`cv/.gitignore`: `data/raw/`; this folder: `*.e57`).
