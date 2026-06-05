@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\publish-to-github.ps1"
pause
