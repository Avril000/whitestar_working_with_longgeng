@echo off
setlocal
cd /d "%~dp0"

set "PY=C:\Users\BOHAN LYU\.workbuddy\binaries\python\envs\default\Scripts\python.exe"
if not exist "%PY%" set "PY=python"

"%PY%" tools\deploy_server.py

echo.
pause
