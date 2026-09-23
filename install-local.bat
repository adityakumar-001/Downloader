@echo off
REM Video Downloader — LOCAL DEPLOY (install)
REM Startup me shortcut banata hai:
REM   - Har login par auto-start (bina window ke, background me)
REM   - Koi admin nahi chahiye
REM Band karne ke liye: uninstall-local.bat chalao
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js nahi mila. https://nodejs.org se LTS install karo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [1/2] npm install chal raha hai...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install fail. Internet check karo.
    pause
    exit /b 1
  )
) else (
  echo [1/2] Dependencies OK.
)

echo [2/2] Auto-start shortcut lag raha hai...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $lnk = $ws.CreateShortcut($env:APPDATA + '\Microsoft\Windows\Start Menu\Programs\Startup\VideoDownloader.lnk'); $lnk.TargetPath = 'wscript.exe'; $lnk.Arguments = '\"%~dp0server-hidden.vbs\"'; $lnk.WorkingDirectory = '%~dp0'; $lnk.Description = 'Video Downloader backend (localhost:3000)'; $lnk.Save()"
if errorlevel 1 (
  echo [ERROR] Shortcut nahi bana.
  pause
  exit /b 1
)

echo Abhi server start ho raha hai...
wscript.exe "%~dp0server-hidden.vbs"
echo.
echo ========================================
echo   Local backend DEPLOYED: http://localhost:3000
echo   Ab har login par khud chalega (background).
echo   Browser me kholo: http://localhost:3000
echo ========================================
timeout /t 3 /nobreak >nul
start "" http://localhost:3000
