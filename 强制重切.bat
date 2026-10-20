@echo off
setlocal
cd /d "%~dp0"

echo.
echo  This will RE-CROP every page from scratch.
echo  Old results are moved to glyphs_XX\_stale\, not deleted.
echo.
choice /c YN /m "  Continue"
if errorlevel 2 goto CANCEL

set "PY=C:\Users\BOHAN LYU\.workbuddy\binaries\python\envs\default\Scripts\python.exe"
if not exist "%PY%" set "PY=python"

echo.
"%PY%" tools\pipeline_out.py --force
echo.
pause
exit /b 0

:CANCEL
echo  Cancelled.
timeout /t 2 >nul
exit /b 0
