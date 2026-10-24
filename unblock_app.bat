@echo off
title Unblock RPA Video Editor (Smart App Control Fix)
cd /d "%~dp0"
echo ============================================================
echo   RPA VIDEO EDITOR - WINDOWS SMART APP CONTROL UNBLOCKER    
echo ============================================================
echo.
echo Stripping Mark-of-the-Web (Zone.Identifier) metadata...
powershell -ExecutionPolicy Bypass -Command "Get-ChildItem -Path '%~dp0' -Recurse | Unblock-File; Write-Host 'All RPA Video Editor files unblocked successfully!' -ForegroundColor Green"
echo.
echo Windows Smart App Control and SmartScreen blocks have been resolved.
echo You can now launch RPA_Video_Editor.exe directly.
echo.
pause
