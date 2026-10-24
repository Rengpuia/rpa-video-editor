@echo off
title Build RPA Video Editor Native Desktop
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0build_native_desktop.ps1"
pause
