@echo off
title Meridian Server

cd /d "D:\Meridian-username-auth-fixed\meridian"

echo.
echo ========================================
echo       MERIDIAN SYMPTOM CHECKER
echo ========================================
echo.
echo Starting server...
echo.

start "" "http://localhost:3000"

npm.cmd start

pause
