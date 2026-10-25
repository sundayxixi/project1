@echo off
chcp 936 >nul 2>nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "ROOT=%CD%"
set "PY=%ROOT%\.venv\Scripts\python.exe"
REM 让 Python 的输出与中文控制台保持同一编码，避免中文提示乱码
set "PYTHONIOENCODING=gbk"

REM 支持 start.bat --no-pause 无人值守运行（自动化脚本不会卡在“按任意键”）
set "NO_PAUSE=0"
if /i "%~1"=="--no-pause" set "NO_PAUSE=1"

echo ================================================
echo   辰光 Agent 平台 - 一键启动
echo   数据库: SQLite    缓存: fakeredis  (无需 Docker)
echo   用法: start.bat            启动后保留窗口
echo         start.bat --no-pause 启动后自动退出
echo ================================================
echo.

REM ==================== 0. 基础文件检查 ====================
if not exist "%ROOT%\requirements.txt" (
    echo [错误] 未找到 requirements.txt，请确认 start.bat 位于项目根目录。
    call :pause_if_needed
    exit /b 1
)
if not exist "%ROOT%\app\package.json" (
    echo [错误] 未找到 app\package.json，前端目录不完整。
    call :pause_if_needed
    exit /b 1
)

REM .env 与 app\.env.local 被 .gitignore 忽略，首次克隆时自动生成
if not exist "%ROOT%\.env" (
    if exist "%ROOT%\.env.example" (
        copy /y "%ROOT%\.env.example" "%ROOT%\.env" >nul
        echo       已根据 .env.example 生成 .env
    )
)
if not exist "%ROOT%\app\.env.local" (
    > "%ROOT%\app\.env.local" echo VITE_USE_MOCK=false
    >> "%ROOT%\app\.env.local" echo VITE_API_BASE=http://localhost:8080/api/v1
    echo       已创建 app\.env.local（前端连接真实后端）
) else (
    findstr /B /C:"VITE_USE_MOCK=false" "%ROOT%\app\.env.local" >nul 2>&1
    if errorlevel 1 (
        echo       [警告] app\.env.local 中 VITE_USE_MOCK 不是 false，前端会显示 mock 数据
        echo              如需连接真实后端，请改为 VITE_USE_MOCK=false 后重启前端
    )
)

REM ==================== 1. Python 环境 ====================
echo [1/6] 检查 Python 环境 ...
set "SYS_PY="
python -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1
if not errorlevel 1 (
    set "SYS_PY=python"
) else (
    py -3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1
    if not errorlevel 1 set "SYS_PY=py -3"
)

if not defined SYS_PY (
    echo.
    echo [错误] 未检测到 Python 3.10 或以上版本。
    echo        请安装 Python 并勾选 "Add Python to PATH"。
    echo.
    call :pause_if_needed
    exit /b 1
)
for /f "delims=" %%v in ('%SYS_PY% -c "import sys; print(sys.version.split()[0])"') do set "SYS_VER=%%v"
echo       系统 Python 版本: !SYS_VER!

REM 关键修复：.venv 存在不代表可用，从其他电脑/用户目录拷贝来的 venv 会失效
set "VENV_OK=0"
if exist "%PY%" (
    "%PY%" -c "import sys" >nul 2>&1
    if not errorlevel 1 set "VENV_OK=1"
)

if "!VENV_OK!"=="0" (
    if exist "%ROOT%\.venv" (
        set "BROKEN=.venv.broken_!RANDOM!"
        echo       检测到 .venv 不可用，正在备份为 !BROKEN! ...
        ren "%ROOT%\.venv" "!BROKEN!" >nul 2>&1
    )
    echo       正在创建虚拟环境 .venv ...
    %SYS_PY% -m venv "%ROOT%\.venv"
    if errorlevel 1 (
        echo.
        echo [错误] 虚拟环境创建失败，请确认 Python 安装完整。
        call :pause_if_needed
        exit /b 1
    )
    echo       虚拟环境创建完成
) else (
    echo       虚拟环境已就绪
)

REM ==================== 2. 后端依赖 ====================
echo [2/6] 检查后端依赖 ...
"%PY%" -c "import fastapi, uvicorn, aiosqlite, fakeredis, alembic, sqlalchemy, minio, redis, loguru, PIL, jwt, pydantic_settings" >nul 2>&1
if errorlevel 1 (
    echo       正在安装后端依赖，首次运行可能需要几分钟 ...
    "%PY%" -m pip install -r "%ROOT%\requirements.txt"
    if errorlevel 1 (
        echo.
        echo [错误] 依赖安装失败。可尝试切换国内镜像源后重试：
        echo        pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple
        echo.
        call :pause_if_needed
        exit /b 1
    )
    "%PY%" -c "import fastapi, uvicorn, aiosqlite, fakeredis, alembic, sqlalchemy, minio, redis, loguru, PIL, jwt, pydantic_settings" >nul 2>&1
    if errorlevel 1 (
        echo.
        echo [错误] 依赖安装完成但无法导入，请检查 Python 版本与 requirements.txt。
        call :pause_if_needed
        exit /b 1
    )
)
echo       依赖检查通过

REM ==================== 3. 数据库 ====================
echo [3/6] 准备数据库 ...
"%PY%" bootstrap_db.py
if errorlevel 1 (
    echo.
    echo [错误] 数据库初始化失败，请查看上方日志。
    call :pause_if_needed
    exit /b 1
)

REM ==================== 4. 前端依赖 ====================
echo [4/6] 检查前端依赖 ...
where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo.
    echo [错误] 未检测到 npm，请安装 Node.js 18 或以上版本。
    echo.
    call :pause_if_needed
    exit /b 1
)
if not exist "%ROOT%\app\node_modules" (
    echo       首次运行，正在安装 npm 依赖，请稍候 ...
    pushd "%ROOT%\app"
    call npm.cmd install
    popd
    if errorlevel 1 (
        echo.
        echo [错误] npm 依赖安装失败，请检查 Node.js 版本和网络。
        call :pause_if_needed
        exit /b 1
    )
) else (
    echo       前端依赖已就绪
)

REM ==================== 5. 启动服务 ====================
echo [5/6] 启动服务 ...

call :check_service 8080 "http://127.0.0.1:8080/health"
if "!BUSY!"=="1" (
    if "!ALIVE!"=="1" (
        echo       端口 8080 上已有本项目的后端在运行，跳过启动
    ) else (
        echo       [警告] 端口 8080 被其他程序占用，后端未启动
        echo              查看占用进程: netstat -ano ^| findstr :8080
    )
) else (
    start "辰光Agent-后端 8080" cmd /k "cd /d ""%ROOT%"" && ""%PY%"" -m uvicorn src.main:app --host 127.0.0.1 --port 8080"
    echo       后端启动中 ...
)

call :check_service 5173 "http://localhost:5173/"
if "!BUSY!"=="1" (
    if "!ALIVE!"=="1" (
        echo       端口 5173 上已有本项目的前端在运行，跳过启动
    ) else (
        echo       [警告] 端口 5173 被其他程序占用，前端未启动
        echo              查看占用进程: netstat -ano ^| findstr :5173
    )
) else (
    start "辰光Agent-前端 5173" cmd /k "cd /d ""%ROOT%\app"" && npm.cmd run dev -- --strictPort"
    echo       前端启动中 ...
)

REM ==================== 6. 等待就绪 ====================
echo.
echo [6/6] 等待服务就绪 ...
"%PY%" wait_ready.py 120
set "READY=!ERRORLEVEL!"

echo.
echo ================================================
echo   后端 API 文档: http://localhost:8080/docs
echo   健康检查:      http://localhost:8080/health
echo   前端界面:      http://localhost:5173
echo   默认账号:      admin / 123456
echo.
if "!READY!"=="0" (
    echo   启动完成，正在打开浏览器 ...
    start "" "http://localhost:5173"
) else (
    echo   有服务未能在 120 秒内就绪，请查看对应命令行窗口的报错日志。
)
echo.
echo  提示：控制台出现 MinIO 连接失败告警属正常现象，
echo        未启动 MinIO 时知识库文件上传不可用，其余功能不受影响。
echo  停止服务：关闭“辰光Agent-后端 8080”“辰光Agent-前端 5173”窗口，
echo            或执行 netstat -ano ^| findstr :8080 找到 PID 后 taskkill /PID ^<PID^> /F
echo ================================================
echo.
call :pause_if_needed
exit /b 0

REM ==================== 子程序：检查端口占用与服务存活 ====================
:check_service
REM 入参 %1=端口  %2=健康检查地址；输出 BUSY=1 表示端口被占用，ALIVE=1 表示该地址可访问
set "BUSY=0"
set "ALIVE=0"
netstat -ano | findstr /R /C:":%~1 .*LISTENING" >nul 2>&1
if not errorlevel 1 set "BUSY=1"
if "!BUSY!"=="1" (
    "%PY%" -c "import urllib.request; urllib.request.urlopen('%~2', timeout=3)" >nul 2>&1
    if not errorlevel 1 set "ALIVE=1"
)
exit /b 0

REM ==================== 子程序：按需暂停 ====================
:pause_if_needed
if "!NO_PAUSE!"=="0" pause
exit /b 0
