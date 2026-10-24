<#
.SYNOPSIS
    RPA Video Editor - Studio Launcher
#>

Set-Location -Path $PSScriptRoot
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "          STARTING RPA VIDEO EDITOR STUDIO            " -ForegroundColor Yellow
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Launching local media server on http://127.0.0.1:3800..." -ForegroundColor Green
Start-Process "http://localhost:3800"

& node "server\server.js"
