# One command: selftest -> floor plan from cloud_0.e57 -> tests -> commit + push to feat/floorplan.
#   powershell -ExecutionPolicy Bypass -File $HOME\dev\autotag-floorplan\cv\floorplan\run_floorplan.ps1
# Publishes data only when every quality gate passes. If a gate fails, only the report and check
# images are pushed (no floor plan data), so the problem can be diagnosed from the repo.
# Never touches main and never force-pushes.
$ErrorActionPreference = "Stop"
$root = Join-Path $HOME "dev\autotag-floorplan"
$e57 = Join-Path $root "cv\data\raw\cloud_0.e57"
function Step($m) { Write-Host "`n=== $m" -ForegroundColor Cyan }
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" } }

Step "Repo"
Set-Location $root
git switch feat/floorplan; Check "git switch"
git pull --ff-only; Check "git pull"
Write-Host "HEAD: $(git log --oneline -1)   main: $(git log --oneline -1 origin/main)"
if (-not (Test-Path $e57)) { throw "Not found: $e57 (run setup_floorplan.ps1 first)" }
if (-not (git check-ignore cv/data/raw/cloud_0.e57)) { throw "cloud_0.e57 is NOT git-ignored - stopping" }
# commits need an author; set a repo-local one only if git has none (does not touch global config)
if (-not (git config user.email)) { git config user.email "autotag-floorplan@users.noreply.github.com" }
if (-not (git config user.name)) { git config user.name "autotag-floorplan" }

Step "Python venv"
Set-Location "$root\cv\floorplan"
if (-not (Test-Path ".venv")) { py -3.12 -m venv .venv; Check "venv" }
$py = ".\.venv\Scripts\python.exe"
& $py -m pip install --quiet -r requirements.txt; Check "pip install"

Step "Selftest (synthetic data, 2-3 min)"
& $py selftest.py; Check "selftest"

Step "Floor plan from cloud_0.e57 (10-30 min)"
& $py build_floorplan.py --e57 $e57 --cache
$code = $LASTEXITCODE
Set-Location $root
$checks = @("cv/floorplan/report.json", "cv/floorplan/check.png") + (Get-ChildItem "cv/floorplan/check_reprojection_scan-07.png" -ErrorAction SilentlyContinue | ForEach-Object { "cv/floorplan/" + $_.Name })
$checks = $checks | Where-Object { Test-Path $_ }

if ($code -eq 0) {
    Step "All gates passed - tests"
    if (Get-Command bun -ErrorAction SilentlyContinue) { bun run test } else { Write-Warning "bun not found - tests skipped" }
    git add src/data/floorplan.json public/floorplan/floorplan.png $checks; Check "git add"
    git commit -m "floorplan: E57 slice + device positions (data)"; Check "git commit"
} else {
    Step "A quality gate failed (exit $code) - pushing the report only, no floor plan data"
    if ($checks) {
        git add $checks; Check "git add"
        git commit -m "floorplan: gate report, data rejected (exit $code)"; Check "git commit"
    }
}

Step "Merge origin/main and push feat/floorplan"
git fetch origin; Check "git fetch"
git merge origin/main --no-edit; Check "git merge (resolve conflicts, keep Santeri's changes)"
git push -u origin feat/floorplan; Check "git push"
Write-Host "`nDone (build_floorplan exit $code). Tell Claude: 'ajoin run_floorplan.ps1'." -ForegroundColor Green
