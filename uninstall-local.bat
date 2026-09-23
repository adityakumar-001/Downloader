@echo off
REM Video Downloader — LOCAL DEPLOY (uninstall)
REM Auto-start band karo + background server roko
cd /d "%~dp0"
echo Auto-start hata raha hai...
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\VideoDownloader.lnk" 2>nul
echo Background server rok raha hai...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*server.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo Ho gaya. Dobara chalane ke liye install-local.bat ya start.bat chalao.
pause
