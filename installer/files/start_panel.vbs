' OIS School Bell - boshqaruv paneli serverini (bell_web/server.js) konsol oynasisiz ishga tushiradi.
' Panel brauzerda http://localhost:3000 manzilida ochiladi.
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = appDir & "\bell_web"
sh.Run """" & appDir & "\runtime\node\node.exe"" ""server.js""", 0, False
