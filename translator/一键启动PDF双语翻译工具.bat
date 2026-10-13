@echo off
set PYTHONIOENCODING=utf-8
python -u "%~dp0scripts\launch_webui.py"
if errorlevel 1 pause
