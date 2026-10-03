# One-time setup for the floor plan work. Run in PowerShell:
#   powershell -ExecutionPolicy Bypass -File setup_floorplan.ps1
# Creates $HOME\dev\autotag-floorplan. Does NOT touch any other clone (e.g. the CV session folder).
$ErrorActionPreference = "Stop"
$root = Join-Path $HOME "dev\autotag-floorplan"
$repo = "https://github.com/santeri06/pixel-perfect-replica"

# 1. Clone + branch
if (Test-Path "$root\.git") {
    Write-Host "Repo already at $root - updating"
    git -C $root fetch origin
} else {
    git clone $repo $root
}
Set-Location $root
git switch feat/floorplan
git pull --ff-only
Write-Host "HEAD: $(git log --oneline -1)"

# 2. Point cloud -> cv\data\raw (git-ignored)
$target = "$root\cv\data\raw\cloud_0.e57"
New-Item -ItemType Directory -Force -Path "$root\cv\data\raw" | Out-Null
if (Test-Path $target) {
    Write-Host "cloud_0.e57 already in place"
} else {
    $default = "$HOME\Downloads\cloud_0.e57"
    $src = Read-Host "Path to cloud_0.e57 (Enter = $default)"
    if (-not $src) { $src = $default }
    $src = $src.Trim('"')
    if (-not (Test-Path $src)) { throw "File not found: $src" }
    Write-Host "Copying 2.2 GB, please wait..."
    Copy-Item $src $target
}
$ignored = git check-ignore -v cv/data/raw/cloud_0.e57
if (-not $ignored) { throw "cloud_0.e57 is NOT git-ignored - stop and check cv/.gitignore" }
Write-Host "OK, git-ignored: $ignored"

# 3. Frontend dependencies (npm install fails in this repo, use bun)
if (Get-Command bun -ErrorAction SilentlyContinue) {
    bun install --frozen-lockfile
} else {
    Write-Warning "bun not found. Install: powershell -c `"irm bun.sh/install.ps1 | iex`" and rerun this script."
}

# 4. Python venv for cv/floorplan
Set-Location "$root\cv\floorplan"
if (-not (Test-Path ".venv")) { py -3.12 -m venv .venv }
& .\.venv\Scripts\python.exe -m pip install --upgrade pip
& .\.venv\Scripts\python.exe -m pip install -r ..\requirements.txt -r requirements.txt

Write-Host ""
Write-Host "Ready. Folder: $root (branch feat/floorplan)"
Write-Host "Next: open Claude Code in $root and paste cv\floorplan\PROMPT.md"
