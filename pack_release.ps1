# 一键生成「可分发给他人」的 RedNote 分享包(zip)
# 用法： powershell -ExecutionPolicy Bypass -File pack_release.ps1
#        powershell -ExecutionPolicy Bypass -File pack_release.ps1 -SkipBuild   # 直接用现有 dist\RedNote 打包

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
    Write-Host "[!] 未找到 $src\$Name.exe，请先构建" -ForegroundColor Yellow
    Pop-Location
    exit 1
}

# 放入一份使用说明(面向最终用户)
$readme = Join-Path $src "使用说明.txt"
@"
====================================
  RedNote 学习笔记 · 本地版
====================================

【怎么用】
1. 把整个文件夹解压到任意位置；
2. 双击里面的  $Name.exe  启动；
3. 首次启动稍等片刻(自解压/初始化)。

【功能】
- 采集网页 / 拖入 PDF·DOCX·TXT·Markdown(扫描件自动 OCR)
- 一键生成 摘要+要点、详细讲解；选中文字可 解释/翻译/追问
- 笔记管理：收藏夹、全文检索、段落下注释、文末引用、附件、回收站
- 日历：日程/待办/每周重复；导出 Markdown 与数据库备份(防锁死)

【数据在哪】
- 你的所有笔记都存在： C:\Users\你\AppData\Roaming\RedNote\
- 删除了文件夹即卸载，数据就在上述目录，建议定期备份或使用应用内「导出备份」。

【可选：接入大模型增强分析】
- 进入「设置」→ 选择 DeepSeek 或 通义千问 → 粘贴 API Key → 「测试连接」→ 保存；
- 不配置也能用(本地规则)，配置后 AI 总结/讲解/翻译更聪明。

【常见问题】
- 打不开/白屏：请安装微软 WebView2 运行时(Windows 10/11 一般已自带)，
  可从 https://developer.microsoft.com/microsoft-edge/webview2/ 下载「Evergreen 安装程序」；
- 双击后没反应/杀毒拦截：Windows 可能首次扫描较慢，请稍等；如被拦截请允许运行(本地应用，无联网上传，除你配置的模型外)。
- 换设备：把 %APPDATA%\RedNote 文件夹拷到新机器对应位置即可带走全部笔记。
====================================
"@ | Out-File -FilePath $readme -Encoding utf8

$stamp = Get-Date -Format "yyyyMMdd"
$zip = Join-Path $root "dist\$Name-$stamp.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $src -DestinationPath $zip -Force
$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)

Pop-Location
Write-Host ""
Write-Host "[OK] 分享包已生成: $zip" -ForegroundColor Green
Write-Host "     大小: $mb MB  |  可发给他人，解压后双击 $Name.exe 即可使用"
