#!/bin/bash
cd "$(dirname "$0")"
echo "Starting Python AI Backend (FastAPI + LangGraph)..."
[ ! -f .env ] && cp .env.example .env
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

