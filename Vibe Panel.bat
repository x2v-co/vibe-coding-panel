@echo off
setlocal
cd /d "%~dp0"
if exist "runtime\node.exe" set "PATH=%CD%\runtime;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 LTS: https://nodejs.org/
  exit /b 1
)
node scripts/launch.mjs %*
exit /b %errorlevel%
