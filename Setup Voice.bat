@echo off
setlocal
cd /d "%~dp0"
call "Vibe Panel.bat" --setup-voice
set "voice_result=%errorlevel%"
pause
exit /b %voice_result%
