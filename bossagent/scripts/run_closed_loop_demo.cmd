@echo off
chcp 65001 >nul
cd /d "%~dp0\.."
if not exist "venv\Scripts\python.exe" (
  echo [ERROR] 未找到 venv，请先运行 setup.cmd
  pause
  exit /b 1
)
"venv\Scripts\python.exe" -m scripts.run_closed_loop --task-type double_end_visual_agent --output runtime\orchestration-final-demo.json
set CODE=%ERRORLEVEL%
echo.
if "%CODE%"=="0" (
  echo [PASS] 双端五角色闭环验证完成。
) else (
  echo [ERROR] 闭环任务未完成，请查看上方日志。
)
pause
exit /b %CODE%
