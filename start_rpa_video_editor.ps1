# RPA Video Editor - Studio Desktop Launcher
$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $rootDir

$exePath = Join-Path $rootDir "RPA_Video_Editor.exe"
if (Test-Path $exePath) {
    Start-Process -FilePath $exePath
    exit 0
}

Write-Host "Starting RPA Video Editor Studio..." -ForegroundColor Cyan
& node (Join-Path $rootDir "server\server.js")
