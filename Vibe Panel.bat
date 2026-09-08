@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 LTS first: https://nodejs.org/
  goto :error
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Reinstall Node.js and enable the PATH option.
  goto :error
)

if not exist node_modules\ws (
  echo [1/2] Installing or updating Vibe Panel dependencies...
  call npm install
  if errorlevel 1 goto :error
)

if not exist node_modules\cross-spawn (
  echo [1/2] Installing or updating Vibe Panel dependencies...
  call npm install
  if errorlevel 1 goto :error
)

echo [2/2] Checking your Agent and connecting your phone...
call npm run connect
if errorlevel 1 goto :error
exit /b 0

:error
echo.
echo Connector did not start. Make sure Codex or Claude Code is installed and signed in.
pause
exit /b 1
