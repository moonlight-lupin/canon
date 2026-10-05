@echo off
title Canon server
REM Canon - double-click to start on the church office PC.
REM First run installs dependencies, imports the Bible and builds the web app; after an update it
REM installs and rebuilds what changed, and the database is upgraded (a copy is kept in data\pre-upgrade).
REM Machine-specific settings (e.g. set CANON_PORT=5018) go in canon.local.bat next to this file;
REM it is not part of the repository.
cd /d "%~dp0"
if exist "%~dp0canon.local.bat" call "%~dp0canon.local.bat"
if not defined CANON_PORT set CANON_PORT=3000
where node >nul 2>nul
if errorlevel 1 goto nonode
REM Installs dependencies and rebuilds the web app when Canon was updated; refuses a too-old Node.js.
node scripts\startup-check.mjs
if errorlevel 1 goto err
if not exist data\canon.db call npm run import:bible
set NODE_ENV=production
echo.
echo Canon is starting. Open http://localhost:%CANON_PORT% on this PC,
echo or http://%COMPUTERNAME%:%CANON_PORT% from other computers on the office network.
echo Keep this window open while Canon is in use.
echo.
call npm start
echo.
echo Canon has stopped.
pause
goto :eof
:nonode
echo Node.js is not installed on this computer. Install the "LTS" version from https://nodejs.org,
echo then double-click this file again.
pause
goto :eof
:err
echo Something went wrong - see the messages above. Your data has not been changed.
pause
