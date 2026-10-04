' OIS School Bell - boshqaruv panelini alohida dastur oynasida ochadi (manzil satri va brauzer tugmalarisiz).
' Panel serveri ishlamayotgan bo'lsa, avval uni ishga tushiradi.
Option Explicit
Const PANEL_URL = "http://localhost:3000"

Dim fso, sh, appDir
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)

Function PanelUp()
  Dim http
  PanelUp = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.setTimeouts 1000, 1000, 1000, 1000
  http.open "GET", PANEL_URL & "/api/config", False
  http.send
  If Err.Number = 0 Then PanelUp = (http.status = 200)
  On Error GoTo 0
End Function

If Not PanelUp() Then
  sh.Run "wscript.exe """ & appDir & "\start_panel.vbs""", 0, False
  Dim i
  For i = 1 To 30
    WScript.Sleep 500
    If PanelUp() Then Exit For
  Next
End If

' Brauzerni "ilova" rejimida ochamiz: Edge (Windows 10/11 da doim bor), bo'lmasa Chrome, bo'lmasa oddiy brauzer
Function FindBrowser()
  Dim candidates, c, regPath
  FindBrowser = ""
  On Error Resume Next
  For Each regPath In Array( _
      "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe\", _
      "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe\", _
      "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe\", _
      "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe\")
    c = ""
    c = sh.RegRead(regPath)
    If c <> "" And fso.FileExists(c) Then FindBrowser = c : Exit Function
  Next
  On Error GoTo 0
  candidates = Array( _
    sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe", _
    sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Microsoft\Edge\Application\msedge.exe", _
    sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Google\Chrome\Application\chrome.exe", _
    sh.ExpandEnvironmentStrings("%LocalAppData%") & "\Google\Chrome\Application\chrome.exe")
  For Each c In candidates
    If fso.FileExists(c) Then FindBrowser = c : Exit Function
  Next
End Function

Dim browser
browser = FindBrowser()
If browser <> "" Then
  sh.Run """" & browser & """ --app=" & PANEL_URL & " --window-size=1280,860", 1, False
Else
  sh.Run PANEL_URL, 1, False
End If
