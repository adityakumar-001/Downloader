@echo off
REM CHAIN: start.bat --(npm start)--> server.js (Local Backend) --(yt-dlp.exe + ffmpeg)--> video file
REM                             ^-- public\index.html (Browser: HTML + CSS + JS) isko fetch() se bulata hai
echo ========================================
echo   Video Downloader - Server Start ho raha hai
echo   [Browser] HTML+CSS+JS  --  [Backend] server.js  --  [yt-dlp + ffmpeg]
echo   Koi login nahi chahiye!
echo ========================================
echo.
echo Browser me kholo: http://localhost:3000
echo Band karne ke liye: Ctrl+C dabao
echo.
npm start
