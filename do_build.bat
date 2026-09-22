@echo off
cd /d "%~dp0"
node node_modules\next\dist\bin\next build > build_out.txt 2> build_err.txt
echo EXIT_CODE=%ERRORLEVEL% >> build_out.txt
