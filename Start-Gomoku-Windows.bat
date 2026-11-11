@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or is not on PATH.
  echo Download the LTS installer from https://nodejs.org/en/download
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)
if not exist "node_modules\socket.io" (
  echo Installing Gomoku dependencies. This may take a minute...
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)
start "Gomoku Server" /D "%~dp0" cmd /k npm start
timeout /t 3 /nobreak >nul
start "" http://localhost:3000
echo The game should open in your browser. Keep the Gomoku Server window open while playing.
