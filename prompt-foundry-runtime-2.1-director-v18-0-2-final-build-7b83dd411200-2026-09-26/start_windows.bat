@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Prompt Foundry Runtime 2.1

set "PYTHON_CMD="
where python >nul 2>&1
if not errorlevel 1 set "PYTHON_CMD=python"
if not defined PYTHON_CMD (
  where py >nul 2>&1
  if not errorlevel 1 set "PYTHON_CMD=py -3"
)
if not defined PYTHON_CMD (
  echo [ERROR] Python 3 was not found.
  echo Install Python 3.11+ and enable "Add Python to PATH", then double-click start.bat again.
  goto :fail
)

if not exist ".venv\Scripts\python.exe" (
  echo [1/4] Creating Python virtual environment...
  %PYTHON_CMD% -m venv .venv
  if errorlevel 1 (
    echo [ERROR] Failed to create .venv.
    goto :fail
  )
)

call ".venv\Scripts\activate.bat"
if errorlevel 1 (
  echo [ERROR] Failed to activate .venv.
  goto :fail
)

if not exist ".venv\Scripts\python.exe" (
  echo [ERROR] Virtual-environment Python is missing.
  goto :fail
)

set "PYTHON_EXE=%CD%\.venv\Scripts\python.exe"

echo [2/4] Installing backend dependencies...
"%PYTHON_EXE%" -m pip install -r requirements.txt
if errorlevel 1 (
  echo [ERROR] Dependency installation failed.
  goto :fail
)

if not exist .env (
  copy .env.example .env >nul
  echo [3/4] Created local .env configuration.
) else (
  echo [3/4] Using existing local .env configuration.
)

echo [4/4] Starting Prompt Foundry Runtime 2.1...
echo The browser will open automatically after the API is healthy.
echo If it does not, keep this window open and use the URL printed below.
echo.
"%PYTHON_EXE%" scripts\serve.py --open-browser
set "SERVE_EXIT=%ERRORLEVEL%"
if not "%SERVE_EXIT%"=="0" (
  echo.
  echo [ERROR] Prompt Foundry stopped with exit code %SERVE_EXIT%.
  goto :fail
)
exit /b 0

:fail
echo.
echo Startup failed. The window will stay open so you can read the error above.
pause
exit /b 1
