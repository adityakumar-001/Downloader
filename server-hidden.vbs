' Video Downloader — background launcher (koi window nahi khulegi)
' Task Scheduler se chalta hai: PC on / login par auto-start
Set fso = CreateObject("Scripting.FileSystemObject")
dirPath = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = dirPath
' node.exe PATH me hona chahiye (nodejs.org se LTS install karo)
sh.Run "node server.js", 0, False
