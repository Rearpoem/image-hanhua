@echo off
cd /d "%~dp0.."
if not exist runtime\venv\Scripts\python.exe (
  echo Please run windows\install.bat first.
  pause
  exit /b 1
)
set PYTHONUTF8=1
runtime\venv\Scripts\python.exe service\server.py
pause
