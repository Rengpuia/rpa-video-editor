@echo off
setlocal
echo ========================================================
echo   RPA Video Editor - Push to GitHub
echo   Repository: https://github.com/Rengpuia/rpa-video-editor
echo ========================================================
echo.
cd /d "%~dp0"
echo Pushing main branch and release tags...
git push -u origin main --force --tags
echo.
if %ERRORLEVEL% equ 0 (
    echo [SUCCESS] Pushed to GitHub successfully!
    echo GitHub Actions is now compiling the Windows Installer.
) else (
    echo [ERROR] Push failed. If login window did not appear, please verify your credentials.
)
echo.
pause
