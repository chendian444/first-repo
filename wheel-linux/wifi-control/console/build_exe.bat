@echo off
chcp 65001 >nul
title 打包 CubliConsole.exe
cd /d "%~dp0"

echo ============================================
echo   打包为单文件 exe（Windows 10/11 绿色版）
echo ============================================
echo.

python -m pip install --upgrade pyinstaller flask
if errorlevel 1 (
    echo [错误] 依赖安装失败
    pause
    exit /b 1
)

pyinstaller --noconfirm --clean --onefile ^
  --name CubliConsole ^
  --add-data "templates;templates" ^
  --add-data "static;static" ^
  app.py

if errorlevel 1 (
    echo [错误] 打包失败
    pause
    exit /b 1
)

echo.
echo 打包完成: dist\CubliConsole.exe
echo 双击即可启动，会自动打开浏览器 http://127.0.0.1:9001
echo.
echo 开机自启（可选）：把 dist\CubliConsole.exe 的快捷方式
echo   放到 shell:startup 目录即可。
echo.
pause
