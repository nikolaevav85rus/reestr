@echo off
echo Stopping old backend process on port 8080...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8080.*LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)
timeout /t 2 /nobreak >nul

cd /d c:\MyPyProjects\reestr
echo Activating virtual environment...
call venv\Scripts\activate.bat
echo Starting backend on 0.0.0.0:8080...
python -m app.main
pause
