@echo off
setlocal
set "APPDIR=%~dp0"
set "ELECTRON=%APPDIR%CodeArts Bar.exe"
set "CLI=%APPDIR%resources\cli\src\cli.js"
if not exist "%ELECTRON%" set "ELECTRON=%APPDIR%CodeArts Bar"
if not exist "%CLI%" (
  echo CodeArts Bar CLI not found: %CLI% 1>&2
  exit /b 1
)
set "ELECTRON_RUN_AS_NODE=1"
"%ELECTRON%" "%CLI%" %*
set "EXITCODE=%ERRORLEVEL%"
set "ELECTRON_RUN_AS_NODE="
exit /b %EXITCODE%
