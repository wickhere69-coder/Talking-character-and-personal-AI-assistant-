@echo off
title Talking Character App
cd /d "%~dp0"
echo Starting Talking Character App...
start http://localhost:5173/
npm run dev
