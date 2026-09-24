@echo off
REM Video Downloader — LOCAL DEPLOY (install)
REM Creates a startup shortcut:
REM   - Auto-start on every login (no window, runs in background)
REM   - No admin rights needed
REM To stop: run uninstall-local.bat
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install LTS from https://nodejs.org.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [1/2] Running npm install...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed. Check your internet connection.
    pause
    exit /b 1
  )
) else (
  echo [1/2] Dependencies OK.
)

echo [2/2] Creating auto-start shortcut...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $lnk = $ws.CreateShortcut($env:APPDATA + '\Microsoft\Windows\Start Menu\Programs\Startup\VideoDownloader.lnk'); $lnk.TargetPath = 'wscript.exe'; $lnk.Arguments = '\"%~dp0server-hidden.vbs\"'; $lnk.WorkingDirectory = '%~dp0'; $lnk.Description = 'Video Downloader backend (localhost:3000)'; $lnk.Save()"
if errorlevel 1 (
  echo [ERROR] Could not create the shortcut.
  pause
  exit /b 1
)

echo Starting the server now...
wscript.exe "%~dp0server-hidden.vbs"
echo.
echo ========================================
echo   Local backend DEPLOYED: http://localhost:3000
echo   It will now start automatically on every login (background).
echo   Open in your browser: http://localhost:3000
echo ========================================
timeout /t 3 /nobreak >nul
start "" http://localhost:3000
