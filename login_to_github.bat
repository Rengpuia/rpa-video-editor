@echo off
setlocal
echo ========================================================
echo   GitHub Login for Rengpuia
echo ========================================================
echo.
echo Opening your browser to sign in as 'Rengpuia'...
"C:\Program Files\Git\ucrt64\bin\git-credential-manager.exe" github login --username Rengpuia --browser
echo.
if %ERRORLEVEL% equ 0 (
    echo [SUCCESS] Logged in successfully!
    echo Now pushing your project to GitHub...
    cd /d "%~dp0"
    git push -u origin main --tags
) else (
    echo [NOTICE] If browser did not open, you can also sign in via device code or personal access token.
)
echo.
pause
