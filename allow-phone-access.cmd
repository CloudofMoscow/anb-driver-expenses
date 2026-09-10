@echo off
chcp 65001 >nul
title ANB - разрешение доступа с телефона

net session >nul 2>&1
if not "%errorlevel%"=="0" (
  powershell.exe -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

netsh advfirewall firewall add rule name="ANB Phone Local 8788" dir=in action=allow protocol=TCP localport=8788 remoteip=localsubnet profile=any

echo.
echo Доступ к ANB на порту 8788 разрешён только устройствам локальной сети.
echo Теперь запустите start-phone-demo.cmd.
echo.
pause
