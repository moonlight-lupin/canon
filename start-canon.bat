@echo off
title Canon server
REM Canon - double-click to start on the church office PC.
REM First run installs dependencies, imports the Bible and builds the web app; after an update it
REM installs and rebuilds what changed, and the database is upgraded (a copy is kept in data\pre-upgrade).
REM Machine-specific settings (e.g. set CANON_PORT=5018) go in canon.local.bat next to this file;
REM it is not part of the repository.
REM CANON_BACKGROUND=1 (set by scripts\windows-task.ps1): no window to answer, so no "press a key" pauses.
REM Canon is started again if it stops by itself (an error); closing this window or Ctrl+C stops it for good.
REM Canon writes what happens to data\logs\canon-<date>.log (and the launcher to data\logs\launcher.log).
cd /d "%~dp0"
if exist "%~dp0canon.local.bat" call "%~dp0canon.local.bat"
if not defined CANON_PORT set CANON_PORT=3000
where node >nul 2>nul
if errorlevel 1 goto nonode
REM scripts\launcher.mjs does the rest: preparing Canon, starting it, starting it again, installing updates.
REM Keep it all on ONE line: an update may replace this file while Canon runs, and Windows reads a batch file
REM line by line as it goes (one line is read whole before it runs).
node scripts\launcher.mjs & (if errorlevel 1 if not defined CANON_BACKGROUND pause) & exit /b
:nonode
echo Node.js is not installed on this computer. Install the "LTS" version from https://nodejs.org,
echo then double-click this file again.
if not defined CANON_BACKGROUND pause
