@echo off
setlocal
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
  set PY=.venv\Scripts\python.exe
) else (
  set PY=python
)
%PY% -m compileall app || goto :error
%PY% -m unittest discover -s tests -v || goto :error
echo.
echo ACCEPTANCE PASSED
pause
goto :eof
:error
echo.
echo ACCEPTANCE FAILED
pause
