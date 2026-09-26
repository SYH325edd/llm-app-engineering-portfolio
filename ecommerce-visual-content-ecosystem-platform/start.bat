@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
title E-commerce Visual Content Ecosystem Platform - Launcher

echo ============================================================
echo   E-commerce Visual Content Ecosystem Platform v1.9
echo ============================================================
echo.

set "PY_CMD="
where py >nul 2>&1
if not errorlevel 1 set "PY_CMD=py -3"
if not defined PY_CMD (
  where python >nul 2>&1
  if not errorlevel 1 set "PY_CMD=python"
)

if not defined PY_CMD goto :no_python

%PY_CMD% -c "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)" >nul 2>&1
if errorlevel 1 goto :bad_python

if not exist ".venv\Scripts\python.exe" (
  echo [1/4] Creating local Python environment...
  %PY_CMD% -m venv .venv
  if errorlevel 1 goto :venv_error
) else (
  echo [1/4] Existing local Python environment found.
)

set "VPY=.venv\Scripts\python.exe"

"%VPY%" -c "import sys" >nul 2>&1
if errorlevel 1 (
  echo [2/4] Existing environment is broken. Rebuilding it...
  rmdir /s /q .venv >nul 2>&1
  %PY_CMD% -m venv .venv
  if errorlevel 1 goto :venv_error
  set "VPY=.venv\Scripts\python.exe"
)

"%VPY%" -c "import fastapi,uvicorn,multipart,pydantic,httpx,cryptography,PIL,imageio_ffmpeg" >nul 2>&1
if errorlevel 1 (
  echo [2/4] Installing or repairing dependencies...
  "%VPY%" -m pip install --disable-pip-version-check -r requirements.txt
  if errorlevel 1 goto :install_error
) else (
  echo [2/4] Dependencies are ready.
)

"%VPY%" -c "import fastapi,uvicorn,multipart,pydantic,httpx,cryptography,PIL,imageio_ffmpeg" >nul 2>&1
if errorlevel 1 goto :install_error

echo [3/4] Running startup self-check...
"%VPY%" -m compileall -q app run_local.py
if errorlevel 1 goto :selfcheck_error

echo [4/4] Starting web workspace...
echo.
echo Keep this window open while using AI Commerce Studio.
echo If port 8000 is occupied, the launcher will automatically use another port.
echo Startup diagnostics are written to data\startup.log.
echo.

"%VPY%" run_local.py
set "APP_EXIT=%ERRORLEVEL%"

echo.
if "%APP_EXIT%"=="0" (
  echo AI Commerce Studio has stopped.
) else (
  echo AI Commerce Studio exited unexpectedly. Exit code: %APP_EXIT%
  echo Check data\startup.log for details.
)
echo.
pause
exit /b %APP_EXIT%

:no_python
echo [ERROR] Python 3.10 or newer was not found.
echo Install Python from https://www.python.org/downloads/windows/
echo During installation, enable "Add python.exe to PATH".
goto :fatal

:bad_python
echo [ERROR] Python was found, but version 3.10 or newer is required.
goto :fatal

:venv_error
echo [ERROR] Failed to create the local Python environment.
goto :fatal

:install_error
echo [ERROR] Dependency installation failed.
echo Check your network connection and then run start.bat again.
goto :fatal

:selfcheck_error
echo [ERROR] Startup self-check failed.
goto :fatal

:fatal
echo.
echo The launcher will stay open so you can read the error above.
echo If needed, send the contents of data\startup.log together with this screen.
echo.
pause
exit /b 1
