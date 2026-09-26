@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
title AI Commerce Studio - Startup Diagnostics

echo ============================================================
echo AI Commerce Studio startup diagnostics
echo ============================================================
echo.
echo [Python launcher]
where py 2>nul
where python 2>nul
py -3 --version 2>nul
python --version 2>nul

echo.
echo [Local environment]
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" --version
  ".venv\Scripts\python.exe" -c "import fastapi,uvicorn,multipart,pydantic,httpx,cryptography,PIL,imageio_ffmpeg; print('Dependencies: OK')" 2>&1
) else (
  echo .venv not found
)

echo.
echo [Port 8000]
netstat -ano | findstr ":8000 "
if errorlevel 1 echo Port 8000 is not currently listed as in use.

echo.
echo [Latest startup log]
if exist "data\startup.log" (
  type "data\startup.log"
) else (
  echo data\startup.log does not exist yet.
)

echo.
echo Copy this window or send data\startup.log if startup still fails.
pause
