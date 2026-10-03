# Creates $HOME\Downloads\E57 and splits cloud_0.e57 into small per-scan files (scan_XX.npz + manifest.json)
# so Claude can read them. Run in PowerShell:
#   powershell -ExecutionPolicy Bypass -File export_e57.ps1
$ErrorActionPreference = "Stop"
$base = "https://raw.githubusercontent.com/santeri06/pixel-perfect-replica/feat/floorplan/cv/floorplan"
$e57 = Join-Path $HOME "Downloads\cloud_0.e57"
$dir = Join-Path $HOME "Downloads\E57"
if (-not (Test-Path $e57)) { throw "Not found: $e57" }
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Set-Location $dir

# Python (3.12 preferred, any 3.10+ works)
$pyExe = $null; $pyArgs = @()
foreach ($v in @("-3.12", "-3.13", "-3.11", "-3")) {
    try { & py $v -c "import sys" 2>$null; if ($LASTEXITCODE -eq 0) { $pyExe = "py"; $pyArgs = @($v); break } } catch {}
}
if (-not $pyExe) {
    if (Get-Command python -ErrorAction SilentlyContinue) { $pyExe = "python" }
    else { throw "Python not found. Install it: winget install Python.Python.3.12  (then open a new PowerShell and rerun)" }
}
Write-Host "Using: $pyExe $pyArgs"

if (-not (Test-Path ".venv")) { & $pyExe @pyArgs -m venv .venv }
& .\.venv\Scripts\python.exe -m pip install --quiet --upgrade pip
& .\.venv\Scripts\python.exe -m pip install --quiet pye57 numpy

Invoke-RestMethod "$base/export_e57.py" -OutFile export_e57.py
& .\.venv\Scripts\python.exe export_e57.py $e57 (Join-Path $dir "export") --voxel 0.02
Write-Host ""
Write-Host "Valmis. Kansio: $dir\export  -  kerro Claudelle, niin se lukee tiedostot."
