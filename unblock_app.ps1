# RPA Video Editor - Unblock Script for Windows Smart App Control (SAC) & SmartScreen
# Strips Zone.Identifier (Mark-of-the-Web) from all files in the app folder.

$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  RPA VIDEO EDITOR - SMART APP CONTROL UNBLOCK SCRIPT        " -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Unblocking all files in: $appDir" -ForegroundColor Yellow

Get-ChildItem -Path $appDir -Recurse | Unblock-File -ErrorAction SilentlyContinue

Write-Host "All files successfully unblocked!" -ForegroundColor Green
Write-Host "You can now launch RPA_Video_Editor.exe." -ForegroundColor Cyan
