@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
title AI Commerce Studio - Repair Environment

echo This repairs only the local Python environment.
echo Your projects, API settings and generated assets will not be deleted.
echo.

set "PY_CMD="
where py >nul 2>&1
if not errorlevel 1 set "PY_CMD=py -3"
if not defined PY_CMD (
  where python >nul 2>&1
  if not errorlevel 1 set "PY_CMD=python"
)
if not defined PY_CMD goto :error

if exist .venv rmdir /s /q .venv
%PY_CMD% -m venv .venv
if errorlevel 1 goto :error
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r requirements.txt
if errorlevel 1 goto :error
".venv\Scripts\python.exe" -c "import fastapi,uvicorn,multipart,pydantic,httpx,cryptography,PIL,imageio_ffmpeg"
if errorlevel 1 goto :error

echo.
echo Repair completed. You can now run start.bat.
pause
exit /b 0

:error
echo.
echo Repair failed. Confirm Python 3.10+ is installed and the network is available.
pause
exit /b 1
