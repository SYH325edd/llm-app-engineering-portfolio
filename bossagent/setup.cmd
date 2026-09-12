@echo off
chcp 65001 >nul
cd /d "%~dp0"

where py >nul 2>nul
if errorlevel 1 (
  echo [ERROR] 未找到 Python Launcher，请先安装 Python 3.11 或更高版本。
  pause
  exit /b 1
)

if not exist "venv\Scripts\python.exe" (
  echo [1/4] 创建虚拟环境...
  py -3 -m venv venv
  if errorlevel 1 goto :fail
)

echo [2/4] 升级 pip...
"venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto :fail

echo [3/4] 安装项目依赖...
"venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto :fail

echo [4/4] 安装 Playwright Chromium...
"venv\Scripts\python.exe" -m playwright install chromium
if errorlevel 1 goto :fail

echo.
echo [PASS] LakeJob 本地环境安装完成。
pause
exit /b 0

:fail
echo.
echo [ERROR] 安装失败，请保留当前窗口错误信息。
pause
exit /b 1
