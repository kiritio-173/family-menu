@echo off
chcp 65001 >nul
title 家庭菜单服务
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode

echo.
echo   正在启动家庭菜单服务，请保持这个窗口不要关闭...
echo.
rem --max-old-space-size：给堆加个上限。小机器（2G 内存的 VPS、云主机）上
rem 不加的话 V8 会以为自己有整个内存可用，涨上去就被系统 OOM Killer 杀了。
node --max-old-space-size=384 server.js
echo.
echo   服务已停止。按任意键关闭窗口。
pause >nul
exit /b 0

:nonode
echo.
echo   [X] 没有检测到 Node.js
echo.
echo   请先安装 Node.js LTS 版本：https://nodejs.org/zh-cn
echo   安装完成后，重新双击本文件即可。
echo.
pause
exit /b 1