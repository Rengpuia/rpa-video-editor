@echo off
title RPA Video Editor Pro
cd /d "%~dp0"
echo ======================================================
echo           STARTING RPA VIDEO EDITOR STUDIO PRO
echo ======================================================
echo.
echo Launching local media server on http://localhost:3800 ...
start "" http://localhost:3800
node server\server.js
pause
