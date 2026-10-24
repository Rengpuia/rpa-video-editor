@echo off
setlocal
echo =======================================================
echo   RPA Video Editor - Windows Installer Builder
echo   Developer: K Vanlalrengpuia (rengakhiangte@gmail.com)
echo   Version: 2.0.0 (Cleanroom Open Source)
echo =======================================================

set ISCC_PATH="C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
if not exist %ISCC_PATH% (
    set ISCC_PATH="C:\Program Files\Inno Setup 6\ISCC.exe"
)

if not exist %ISCC_PATH% (
    echo [ERROR] Inno Setup 6 compiler (ISCC.exe) was not found.
    echo Please install Inno Setup 6 from: https://jrsoftware.org/isdl.php
    echo Or push to GitHub to build automatically via GitHub Actions!
    pause
    exit /b 1
)

echo Compiling installer.iss with Inno Setup...
%ISCC_PATH% "%~dp0installer.iss"

if %ERRORLEVEL% equ 0 (
    echo.
    echo [SUCCESS] Windows Installer successfully built:
    echo   %~dp0exports\RPA_Video_Editor_Setup_v2.0.0.exe
    echo.
) else (
    echo.
    echo [ERROR] Failed to compile installer.
)

pause
