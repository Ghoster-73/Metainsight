@echo off
set ROOT=%~dp0

if not exist "%ROOT%backend\package.json" (
  echo Backend folder not found.
  pause
  exit /b 1
)

if not exist "%ROOT%frontend\package.json" (
  echo Frontend folder not found.
  pause
  exit /b 1
)

start "MetaInsight Backend" cmd /k "cd /d "%ROOT%backend" && npm.cmd run dev"
start "MetaInsight Frontend" cmd /k "cd /d "%ROOT%frontend" && npm.cmd run dev"

timeout /t 4 /nobreak >nul
start "" http://localhost:5173
