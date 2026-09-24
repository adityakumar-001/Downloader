@echo off
REM CHAIN: start.bat --(npm start)--> server.js (Backend: /api/*) --(yt-dlp + ffmpeg)--> video file
REM                        ^-- docs\index.html (Frontend) calls server.js via fetch()
cd /d "%~dp0"
echo ========================================
echo   Video Downloader - Starting server
echo   [Frontend] docs\index.html -- [Backend] server.js -- [yt-dlp + ffmpeg]
echo   No login required!
echo ========================================
echo.

REM 1) Node check (required for the backend)
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed!
  echo Download LTS from https://nodejs.org, then run this file again.
  pause
  exit /b 1
)

REM 2) On first run, install dependencies (express, yt-dlp wrapper, ffmpeg)
if not exist "node_modules" (
  echo [1/3] First-time setup, running npm install...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed. Check your internet connection.
    pause
    exit /b 1
  )
) else (
  echo [1/3] Dependencies OK.
)

REM 3) Open the browser only AFTER the server is UP (wait up to 15 sec, then open)
echo [2/3] The browser will open once the server is ready: http://localhost:3000
start "" powershell -NoProfile -Command "$u='http://localhost:3000/'; for($i=0;$i -lt 15;$i++){ try { $r=Invoke-WebRequest -Uri ($u+'api/health') -TimeoutSec 2 -UseBasicParsing; if($r.StatusCode -eq 200){ break } } catch {}; Start-Sleep -Seconds 1 }; Start-Process $u"

echo [3/3] Starting backend (server.js)...
echo To stop: press Ctrl+C
echo (Keep this black window open - do not close it!)
echo.
call npm start
echo.
echo [STOP] Server stopped (exit code: %errorlevel%).
echo To run again, open this file once more.
pause