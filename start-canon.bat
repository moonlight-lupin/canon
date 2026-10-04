@echo off
title Canon server
REM Canon - double-click to start on the church office PC.
REM First run installs dependencies, imports the Bible and builds the web app.
cd /d "%~dp0"
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
echo Canon is starting. Open http://localhost:3000 on this PC,
echo or http://%COMPUTERNAME%:3000 from other computers on the office network.
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
