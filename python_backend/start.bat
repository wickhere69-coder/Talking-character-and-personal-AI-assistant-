@echo off
cd /d "%~dp0"
echo ========================================================
echo   Starting Python AI Backend (FastAPI + LangGraph)
echo ========================================================
if not exist ".env" (
    echo Creating .env from .env.example...
    copy ".env.example" ".env"
)
if exist ".venv\Scripts\python.exe" (
    set "PYTHON_EXE=.venv\Scripts\python.exe"
) else (
    set "PYTHON_EXE=python"
)
%PYTHON_EXE% -m pip install -r requirements.txt
%PYTHON_EXE% -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
