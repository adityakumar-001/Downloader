@echo off
REM Video Downloader — LOCAL DEPLOY (uninstall)
REM Disable auto-start + stop the background server
cd /d "%~dp0"
echo Removing auto-start...
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\VideoDownloader.lnk" 2>nul
echo Stopping background server...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*server.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo Done. To run again, use install-local.bat or start.bat.
pause
