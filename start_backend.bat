@echo off
cd /d c:\MyPyProjects\reestr
echo Activating virtual environment...
call venv\Scripts\activate.bat
echo Starting backend on 0.0.0.0:8080...
python -m app.main
pause
