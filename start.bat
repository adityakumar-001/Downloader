@echo off
REM CHAIN: start.bat --(npm start)--> server.js (Backend: /api/*) --(yt-dlp + ffmpeg)--> video file
REM                        ^-- docs\index.html (Frontend) fetch() se server.js ko bulata hai
cd /d "%~dp0"
echo ========================================
echo   Video Downloader - Server Start ho raha hai
echo   [Frontend] docs\index.html -- [Backend] server.js -- [yt-dlp + ffmpeg]
echo   Koi login nahi chahiye!
echo ========================================
echo.

REM 1) Node check (backend ke liye jaruri)
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js installed nahi hai!
  echo https://nodejs.org se LTS download karo, phir ye file dobara chalao.
  pause
  exit /b 1
)

REM 2) Pehli baar ho to dependencies install karo (express, yt-dlp wrapper, ffmpeg)
if not exist "node_modules" (
  echo [1/3] Pehli baar setup ho raha hai, npm install chal raha hai...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install fail ho gaya. Internet check karo.
    pause
    exit /b 1
  )
) else (
  echo [1/3] Dependencies OK.
)

REM 3) Backend start hone ke 3 sec baad browser me frontend kholo
echo [2/3] Browser me khola ja raha hai: http://localhost:3000
start "" cmd /c "timeout /t 3 /nobreak >nul & start "" http://localhost:3000"

echo [3/3] Backend start ho raha hai (server.js)...
echo Band karne ke liye: Ctrl+C dabao
echo.
call npm start
pause