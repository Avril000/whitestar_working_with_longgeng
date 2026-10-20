@echo off
setlocal
cd /d "%~dp0"

set "PY=C:\Users\BOHAN LYU\.workbuddy\binaries\python\envs\default\Scripts\python.exe"
if not exist "%PY%" set "PY=python"

"%PY%" -c "import PIL, numpy, scipy" >nul 2>&1
if errorlevel 1 goto NOPY

echo.
"%PY%" tools\pipeline_out.py %*
echo.
echo --------------------------------------------------
echo  Done. Send the zip in dist\ to your group.
echo --------------------------------------------------
pause
exit /b 0

:NOPY
echo.
echo [ERROR] Python environment is not ready.
echo         Expected: %PY%
echo         Tell Changgeng, then run this again.
echo.
pause
exit /b 1
