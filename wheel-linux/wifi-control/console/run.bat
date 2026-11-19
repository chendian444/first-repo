@echo off
chcp 65001 >nul
title Cubli 遥控调试终端
cd /d "%~dp0"

echo ============================================
echo   Cubli WiFi 遥控调试终端
echo   浏览器: http://127.0.0.1:9001
echo ============================================
echo.

where python >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 python，请先安装 Python 3.9+ 并加入 PATH
    pause
    exit /b 1
)

REM 首次运行自动安装依赖
python -c "import flask" >nul 2>nul
if errorlevel 1 (
    echo [依赖] 正在安装 Flask ...
    python -m pip install -r requirements.txt
    if errorlevel 1 (
        echo [依赖] 默认源失败，改用阿里云镜像重试 ...
        python -m pip install -r requirements.txt -i https://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com
        if errorlevel 1 (
            echo [错误] 依赖安装失败，请手动执行:
            echo        python -m pip install flask -i https://mirrors.aliyun.com/pypi/simple/
            pause
            exit /b 1
        )
    )
)

python app.py
echo.
echo 服务已退出。
pause
