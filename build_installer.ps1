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
Write-Host "[1/2] Compiling native desktop executable..." -ForegroundColor Cyan
& (Join-Path $rootDir "build_native_desktop.ps1")

# 2. Check for Inno Setup compiler
Write-Host "`n[2/2] Checking Inno Setup 6 compiler..." -ForegroundColor Cyan
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
