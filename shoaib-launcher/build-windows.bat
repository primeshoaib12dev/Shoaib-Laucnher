@echo off
cd /d "%~dp0"
call npm install && call npm run dist:win
echo Installer + portable exe: dist\
pause
