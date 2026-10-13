@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist app.jar (
  call mvn -B clean package
  if errorlevel 1 exit /b 1
  copy /Y target\04-compression-library-1.0.0.jar app.jar >nul
)
java -jar app.jar %*
pause
