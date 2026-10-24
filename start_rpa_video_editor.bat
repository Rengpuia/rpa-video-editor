@echo off
title RPA Video Editor Pro
cd /d "%~dp0"
if exist "%~dp0RPA_Video_Editor.exe" (
    start "" "%~dp0RPA_Video_Editor.exe"
    exit /b
)
echo Starting RPA Video Editor Studio Desktop...
node server\server.js
