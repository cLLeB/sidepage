@echo off
rem Opens Sidepage in its own window. Needs Node.js and Microsoft Edge; nothing is compiled.
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"
if not exist node_modules call npm.cmd install
if not exist dist\index.html call npm.cmd run build
start "Sidepage server" /min node node_modules\vite\bin\vite.js preview --port 4783 --strictPort
timeout /t 2 /nobreak >nul
start "" msedge --app=http://localhost:4783
