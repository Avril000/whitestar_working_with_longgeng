@echo off
setlocal
cd /d "%~dp0"

set "PY=C://Users//BOHAN LYU\.workbuddy\binaries\python\envs\default\Scripts\python.exe"
if not exist "%PY%" set "PY=python"

echo.
set /p N=  How many people to split between (default 4):
if "%N%"=="" set N=4

"%PY%" tools\split_cards.py --parts %N% --prefilled
echo.
pause
