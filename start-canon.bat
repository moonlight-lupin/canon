@echo off
title Canon server
REM Canon - double-click to start on the church office PC.
REM First run installs dependencies, imports the Bible and builds the web app.
REM Machine-specific settings (e.g. set CANON_PORT=5018) go in canon.local.bat next to this file;
REM it is not part of the repository.
cd /d "%~dp0"
if exist "%~dp0canon.local.bat" call "%~dp0canon.local.bat"
if not defined CANON_PORT set CANON_PORT=3000
if not exist node_modules (
  call npm install
  if errorlevel 1 goto err
)
if not exist data\canon.db call npm run import:bible
if not exist dist (
  call npm run build
  if errorlevel 1 goto err
)
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
:err
echo Something went wrong - see the messages above.
pause
