@echo off
cd /d "%~dp0..\.."
node scripts/receiver.mjs prediction
pause
