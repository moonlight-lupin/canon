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
REM this PC's address on the office network (falls back to its name when none is found)
set CANON_LAN=
for /f "usebackq delims=" %%a in (`node scripts\lan-address.mjs`) do if not defined CANON_LAN set CANON_LAN=%%a
if not defined CANON_LAN set CANON_LAN=%COMPUTERNAME%
echo or http://%CANON_LAN%:%CANON_PORT% from other computers on the office network.
echo Keep this window open while Canon is in use.
echo.
REM Restarts Canon if it stops by itself (an error); closing this window or Ctrl+C stops it for good.
REM Canon writes what happens to data\logs\canon-<date>.log.
set CANON_RESTARTS=0
:run
call npm start
if not errorlevel 1 goto stopped
set /a CANON_RESTARTS+=1
if %CANON_RESTARTS% GTR 10 goto gaveup
echo.
echo Canon stopped unexpectedly. Starting it again in 10 seconds (see data\logs for why)...
if exist data\logs echo %date% %time% Canon stopped unexpectedly and was started again>> data\logs\launcher.log
timeout /t 10 /nobreak >nul
goto run
:gaveup
echo.
echo Canon stopped unexpectedly 10 times, so it was not started again. See data\logs for why.
pause
exit /b 1
:stopped
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
