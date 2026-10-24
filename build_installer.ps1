# RPA Video Editor - Windows Installer Builder (PowerShell)
# Developer: K Vanlalrengpuia (rengakhiangte@gmail.com)
# Version: 2.0.0 (Cleanroom Open Source)

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "  RPA Video Editor - Windows Installer Builder" -ForegroundColor Cyan
Write-Host "  Developer: K Vanlalrengpuia (rengakhiangte@gmail.com)" -ForegroundColor Gray
Write-Host "  Version: 2.0.0 (Cleanroom Open Source)" -ForegroundColor Gray
Write-Host "=======================================================" -ForegroundColor Cyan

$isccPaths = @(
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe",
    (Get-Command iscc.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)
)

$compiler = $isccPaths | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (-not $compiler) {
    Write-Host "[INFO] Inno Setup 6 is not installed on this local system." -ForegroundColor Yellow
    Write-Host "Download Inno Setup 6 at: https://jrsoftware.org/isdl.php" -ForegroundColor Gray
    Write-Host "Alternatively, pushing to GitHub will build the installer automatically using GitHub Actions!" -ForegroundColor Green
    return
}

Write-Host "[INFO] Compiling installer with $compiler..." -ForegroundColor Cyan
$issFile = Join-Path $PSScriptRoot "installer.iss"
& $compiler $issFile

if ($LASTEXITCODE -eq 0) {
    Write-Host "[SUCCESS] Installer generated at:" -ForegroundColor Green
    Write-Host "  $(Join-Path $PSScriptRoot 'exports\RPA_Video_Editor_Setup_v2.0.0.exe')" -ForegroundColor White
} else {
    Write-Host "[ERROR] Installer compilation failed with exit code $LASTEXITCODE." -ForegroundColor Red
}
