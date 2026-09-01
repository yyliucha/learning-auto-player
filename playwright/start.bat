@echo off
chcp 65001 >nul
title Learning Auto Player - 网址自动播放器
echo ==============================================
echo   学习系统自动播放器（网址播放器）
echo ==============================================
echo.
set /p INPUT=请输入学习平台网址后回车（如 https://xxx.com）: 
echo.
echo 正在打开真实浏览器，请在弹出的浏览器里登录...
echo （登录完成后会自动开始自动播放，本窗口请勿关闭）
echo.
set NODE_BIN=node
if exist "%USERPROFILE%\AppData\Local\nvm\v22.20.0\node.exe" set NODE_BIN=%USERPROFILE%\AppData\Local\nvm\v22.20.0\node.exe
"%NODE_BIN%" "%~dp0auto-learn.js" --url "%INPUT%"
echo.
echo 运行结束，按任意键关闭窗口。
pause >nul
