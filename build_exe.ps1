# 一键打包 RedNote 桌面版(exe)
# 用法：在项目根目录运行  powershell -ExecutionPolicy Bypass -File build_exe.ps1
# 前置：先执行 frontend 目录的 npm run build 生成 frontend/dist；venv 已安装 requirements-dev.txt

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

& $pyinstaller --noconfirm --clean --onefile --windowed --name RedNote `
    --add-data "frontend\dist;frontend_dist" `
    --hidden-import webview.platforms.winforms `
    --collect-data rapidocr_onnxruntime `
    run_desktop.py

Pop-Location
Write-Host ""
Write-Host "[OK] 打包完成: $root\dist\RedNote.exe" -ForegroundColor Green
