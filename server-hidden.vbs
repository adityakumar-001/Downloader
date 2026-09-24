' Video Downloader — background launcher (no window opens)
' Runs on PC login via auto-start: install-local.bat creates the shortcut
Set fso = CreateObject("Scripting.FileSystemObject")
dirPath = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = dirPath
' node.exe must be in PATH (install LTS from nodejs.org)
sh.Run "node server.js", 0, False
