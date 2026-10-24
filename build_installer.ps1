# RPA Video Editor - Windows Installer & Desktop Builder (PowerShell)
# Developer: K Vanlalrengpuia (rengakhiangte@gmail.com)
# Version: 2.0.0 (Cleanroom Open Source)

$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $rootDir

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "  RPA Video Editor - Windows Desktop & Installer Builder" -ForegroundColor Cyan
Write-Host "  Developer: K Vanlalrengpuia (rengakhiangte@gmail.com)" -ForegroundColor Gray
Write-Host "  Version: 2.0.0 (Cleanroom Open Source)" -ForegroundColor Gray
Write-Host "=======================================================" -ForegroundColor Cyan

# 1. Compile native executable first
Write-Host "[1/3] Compiling native desktop executable..." -ForegroundColor Cyan
& (Join-Path $rootDir "build_native_desktop.ps1")

# 2. Package Portable ZIP distribution
Write-Host "`n[2/3] Packaging Portable ZIP release..." -ForegroundColor Cyan
$exportsDir = Join-Path $rootDir "exports"
if (-not (Test-Path $exportsDir)) { New-Item -ItemType Directory -Path $exportsDir | Out-Null }
$zipPath = Join-Path $exportsDir "RPA_Video_Editor_v2.0.0_Portable.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

$itemsToZip = @(
    "client", "server", "RPA_Video_Editor.exe", "main.js", "preload.js",
    "mcp_server.js", "package.json", "LICENSE", "README.md",
    "unblock_app.bat", "unblock_app.ps1", "start_rpa_video_editor.bat", "start_rpa_video_editor.ps1"
) | ForEach-Object { Join-Path $rootDir $_ } | Where-Object { Test-Path $_ }

Compress-Archive -Path $itemsToZip -DestinationPath $zipPath -CompressionLevel Optimal
Write-Host "[SUCCESS] Portable ZIP package created: $zipPath" -ForegroundColor Green

# 3. Check for Inno Setup compiler
Write-Host "`n[3/3] Checking Inno Setup 6 compiler..." -ForegroundColor Cyan
$isccPaths = @(
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe",
    (Get-Command iscc.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)
)

$compiler = $isccPaths | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (-not $compiler) {
    Write-Host "[INFO] Inno Setup 6 is not installed on this local system." -ForegroundColor Yellow
    Write-Host "Download Inno Setup 6 at: https://jrsoftware.org/isdl.php" -ForegroundColor Gray
    Write-Host "Alternatively, GitHub Actions will compile the installer and electron binaries on push!" -ForegroundColor Green
    return
}

Write-Host "[INFO] Compiling installer with $compiler..." -ForegroundColor Cyan
$issFile = Join-Path $rootDir "installer.iss"
& $compiler $issFile

if ($LASTEXITCODE -eq 0) {
    Write-Host "[SUCCESS] Installer generated at:" -ForegroundColor Green
    Write-Host "  $(Join-Path $rootDir 'exports\RPA_Video_Editor_Setup_v2.0.0.exe')" -ForegroundColor White
} else {
    Write-Host "[ERROR] Installer compilation failed with exit code $LASTEXITCODE." -ForegroundColor Red
}
