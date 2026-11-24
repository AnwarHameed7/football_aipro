@echo off
setlocal
cd /d "%~dp0"
set "VENV=.football-coach"
set "PYTHON=%VENV%\Scripts\python.exe"

if not exist "%PYTHON%" (
    where py >nul 2>&1
    if errorlevel 1 (
        echo Install Python 3.12 for Windows from python.org, then try again.
        goto failed
    )
    py -3.12 -m venv "%VENV%"
    if errorlevel 1 goto failed
)

if not exist "%VENV%\requirements-installed.txt" goto install
fc /b requirements.txt "%VENV%\requirements-installed.txt" >nul 2>&1
if errorlevel 1 goto install
goto launch

:install
echo Installing Football AI Pro dependencies. This may take a few minutes.
"%PYTHON%" -m pip install -r requirements.txt
if errorlevel 1 goto failed
copy /y requirements.txt "%VENV%\requirements-installed.txt" >nul
if errorlevel 1 goto failed

:launch
"%PYTHON%" -m app.main
if errorlevel 1 goto failed
exit /b 0

:failed
echo.
echo Football AI Pro could not start. See the message above.
pause
exit /b 1
