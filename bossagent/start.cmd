@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist "venv\Scripts\python.exe" (
  echo [ERROR] 未找到 venv，请先运行 setup.cmd
  pause
  exit /b 1
)

start "LakeJob" http://127.0.0.1:8000/
"venv\Scripts\python.exe" -m lakejob.app.console
set CODE=%ERRORLEVEL%
if not "%CODE%"=="0" (
  echo.
  echo [ERROR] LakeJob 启动失败，退出码 %CODE%。
  pause
)
exit /b %CODE%
