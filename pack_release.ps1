# Build a shareable zip of the RedNote desktop app.
# Usage:  powershell -ExecutionPolicy Bypass -File pack_release.ps1
#         powershell -ExecutionPolicy Bypass -File pack_release.ps1 -SkipBuild

param(
    [string]$Name = "RedNote",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $root

if (-not $SkipBuild) {
    powershell -ExecutionPolicy Bypass -File "build_exe.ps1"
}

$src = Join-Path $root "dist\$Name"
if (-not (Test-Path (Join-Path $src "$Name.exe"))) {
    Write-Host "[!] Build output missing: $src\$Name.exe" -ForegroundColor Yellow
    Pop-Location
    exit 1
}

# Ship an end-user readme next to the exe
$readme = Join-Path $src "Readme.txt"
Copy-Item -Force (Join-Path $root "docs\Readme.txt") -Destination $readme

$stamp = Get-Date -Format "yyyyMMdd"
$zip = Join-Path $root "dist\$Name-$stamp.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $src -DestinationPath $zip -Force
$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)

Pop-Location
Write-Host ""
Write-Host "[OK] Share package ready: $zip" -ForegroundColor Green
Write-Host "     Size: $mb MB  |  Unzip anywhere and run $Name.exe"
