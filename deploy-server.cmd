@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\deploy-server.ps1"
pause
