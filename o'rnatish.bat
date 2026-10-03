@echo off
chcp 65001 >nul
title OIS School Bell - o'rnatish
echo.
echo  OIS School Bell - bu kompyuterga o'rnatilmoqda...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
echo.
pause
