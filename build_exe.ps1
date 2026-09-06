# 一键打包 RedNote 桌面版
# 用法：powershell -ExecutionPolicy Bypass -File build_exe.ps1          # 默认: 文件夹版(快, 重建与启动都快)
#       powershell -ExecutionPolicy Bypass -File build_exe.ps1 -SingleFile   # 单文件 exe(分发方便, 打包慢)
# 前置：先执行 frontend 目录的 npm run build 生成 frontend/dist；venv 已安装 requirements-dev.txt

param(
    [switch]$SingleFile,
    [string]$Name = "RedNote"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $root

if (-not (Test-Path "frontend\dist\index.html")) {
    Write-Host "[!] 缺少 frontend\dist，请先执行: cd frontend; npm run build" -ForegroundColor Yellow
    Pop-Location
    exit 1
}

$pyinstaller = Join-Path $root ".venv\Scripts\pyinstaller.exe"
if (-not (Test-Path $pyinstaller)) {
    Write-Host "[!] 未找到 .venv，请先创建虚拟环境并安装依赖" -ForegroundColor Yellow
    Pop-Location
    exit 1
}

$mode = if ($SingleFile) { "--onefile" } else { "--onedir" }

& $pyinstaller --noconfirm --clean $mode --windowed --name $Name `
    --add-data "frontend\dist;frontend_dist" `
    --hidden-import webview.platforms.winforms `
    --collect-data rapidocr_onnxruntime `
    run_desktop.py

$out = if ($SingleFile) { Join-Path $root "dist\$Name.exe" } else { Join-Path $root "dist\$Name\$Name.exe" }
Pop-Location
Write-Host ""
if (Test-Path $out) {
    Write-Host "[OK] 打包完成: $out" -ForegroundColor Green
} else {
    Write-Host "[!] 打包未生成目标文件，请查看上方 PyInstaller 输出" -ForegroundColor Yellow
    exit 1
}
