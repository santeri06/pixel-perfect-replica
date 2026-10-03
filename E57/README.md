# E57

Drop raw `.e57` scan exports (e.g. a Matterport E57 export) here. `cv/extract_e57.py` reads the
first `.e57` in this folder by default. The files are git-ignored because of their size, so they
stay on the machine where you run the CV pipeline.

```powershell
cd cv
python extract_e57.py          # embedded skybox images -> data/test_scans/ + poses.json
python build_panoramas.py      # web-sized panoramas -> outputs/panoramas/
```
