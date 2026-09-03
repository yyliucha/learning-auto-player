@echo off
title Learning Auto Player - URL Player
echo ==============================================
echo    Learning Auto Player - URL Player
echo ==============================================
echo.
set INPUT=
set /p INPUT=Enter the course overview URL (then press Enter): 
echo.
if "%INPUT%"=="" (
  echo [ERROR] No URL entered.
  pause
  exit /b 1
)
set NODE_BIN=node
if exist "%USERPROFILE%\AppData\Local\nvm\v22.20.0\node.exe" set NODE_BIN=%USERPROFILE%\AppData\Local\nvm\v22.20.0\node.exe
echo Launching real browser. Please login in the browser window when it opens.
echo Keep this window open. Press Ctrl+C to stop anytime.
echo.
"%NODE_BIN%" "%~dp0auto-learn.js" --url "%INPUT%"
echo.
echo Finished. Press any key to close.
pause >nul
