' OIS School Bell - qo'ng'iroq chaluvchi dasturni (bell_scheduler.py) konsol oynasisiz ishga tushiradi.
' O'rnatuvchi bu faylga Windows Startup papkasidan yorliq qo'yadi - kompyuterga har kirilganda o'zi ishlaydi.
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = appDir & "\bell_system"
sh.Run """" & appDir & "\runtime\python\pythonw.exe"" ""bell_scheduler.py""", 0, False
