@echo off
setlocal
cd /d "%~dp0"

set "PY=C:\Users\BOHAN LYU\.workbuddy\binaries\python\envs\default\Scripts\python.exe"
if not exist "%PY%" set "PY=python"

"%PY%" -c "import PIL, numpy, scipy" >nul 2>&1
if errorlevel 1 goto NOPY

echo.
set /p N=  How many people to split between (default 4):
if "%N%"=="" set N=4

"%PY%" tools\split_cards.py --parts %N% --prefilled
echo.
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
