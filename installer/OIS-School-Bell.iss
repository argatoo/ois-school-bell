; OIS School Bell - Windows o'rnatuvchisi (Inno Setup 6)
;
; Natija: Output\OIS-School-Bell-Setup-<versiya>.exe - "Setup" oynasi (litsenziya, papka tanlash,
; Next/Back) bilan o'rnatiladigan dastur. Ichida Python va Node.js bor - o'rnatiladigan kompyuterda
; hech narsa oldindan o'rnatilgan bo'lishi shart emas.
;
; Yasash: installer\README.md ga qarang (qisqasi: stage_runtime.py, keyin ISCC OIS-School-Bell.iss).

#define AppName "OIS School Bell"
#define AppVersion "1.0.2"
#define AppPublisher "Oxford International School"

; ---- Maxfiy kalitlar (bell_web\.env) ----
; Odatda o'chiq: setup.exe ichida maxfiy kalit BO'LMAYDI, o'rnatish paytida .env faylini (masalan fleshkadan)
; tanlash sahifasi chiqadi. Quyidagi qatordagi ";" ni olib tashlasangiz, .env setup.exe ICHIGA joylanadi -
; unda setup.exe ni hech qachon maktabdan tashqariga bermang (undan bazaga to'liq kirish kalitini olish mumkin).
;#define IncludeSecrets

[Setup]
AppId={{8364EB0F-BB15-4EEB-B0F7-9A71BEBA162A}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
; Admin huquqi kerak emas: foydalanuvchi papkasiga o'rnatiladi (jadval/jurnal yozish ham shu sababli ishlaydi)
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
LicenseFile=files\LICENSE.txt
SetupIconFile=files\bell.ico
UninstallDisplayIcon={app}\bell.ico
UninstallDisplayName={#AppName}
OutputDir=Output
OutputBaseFilename=OIS-School-Bell-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=no

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
russian.DesktopIcon=Создать ярлык панели на рабочем столе
english.DesktopIcon=Create a desktop shortcut to the panel
russian.OpenPanel=Открыть панель управления
english.OpenPanel=Open the control panel
russian.PanelShortcut=Панель управления
english.PanelShortcut=Control panel
russian.EnvTitle=Ключи Supabase
english.EnvTitle=Supabase keys
russian.EnvSubtitle=Файл настроек .env (библиотека музыки и вход в панель)
english.EnvSubtitle=The .env settings file (music library and panel sign-in)
russian.EnvText=Выберите файл .env (например, с флешки). Без него звонки по расписанию будут работать, но вход в панель и библиотека музыки - нет. Если программа уже была установлена, оставьте поле пустым - старый файл сохранится. Файл можно выбрать и позже - прямо в панели.
english.EnvText=Select the .env file (for example, from a USB stick). Without it, scheduled bells still ring, but panel sign-in and the music library will not work. If the program was installed before, leave this empty to keep the existing file. You can also choose it later, right in the panel.
russian.EnvLabel=Файл .env:
english.EnvLabel=.env file:
russian.EnvMissing=Указанный файл .env не найден.
english.EnvMissing=The selected .env file was not found.

[Tasks]
Name: "desktopicon"; Description: "{cm:DesktopIcon}"

[Files]
; Ichki muhit: Python (+ jonli e'lon paketlari) va Node.js
Source: "build\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs createallsubdirs
; Qo'ng'iroq chaluvchi dastur
Source: "..\bell_system\bell_scheduler.py"; DestDir: "{app}\bell_system"; Flags: ignoreversion
Source: "..\bell_system\audio_engine.py"; DestDir: "{app}\bell_system"; Flags: ignoreversion
Source: "..\bell_system\live_announce.py"; DestDir: "{app}\bell_system"; Flags: ignoreversion
Source: "..\bell_system\bell_admin.py"; DestDir: "{app}\bell_system"; Flags: ignoreversion
Source: "..\bell_system\README.md"; DestDir: "{app}\bell_system"; Flags: ignoreversion
Source: "..\bell_system\audios\*"; Excludes: "library,_live"; DestDir: "{app}\bell_system\audios"; Flags: ignoreversion recursesubdirs createallsubdirs
; Jadval: faqat birinchi o'rnatishda (bo'sh) qo'yiladi; yangilashda va o'chirishda foydalanuvchi qo'ng'iroqlari saqlanib qoladi
Source: "files\schedule.default.json"; DestDir: "{app}\bell_system\config"; DestName: "schedule.json"; Flags: onlyifdoesntexist uninsneveruninstall
; Davlat bayramlari ro'yxati (yangi versiyada yangilanadi - hayit sanalari har yili o'zgaradi)
Source: "..\bell_system\config\uz_holidays.json"; DestDir: "{app}\bell_system\config"; Flags: ignoreversion
; Boshqaruv paneli
Source: "..\bell_web\server.js"; DestDir: "{app}\bell_web"; Flags: ignoreversion
Source: "..\bell_web\ai.js"; DestDir: "{app}\bell_web"; Flags: ignoreversion
Source: "..\bell_web\cloud_sync.js"; DestDir: "{app}\bell_web"; Flags: ignoreversion
Source: "..\bell_web\add_user.js"; DestDir: "{app}\bell_web"; Flags: ignoreversion
Source: "..\bell_web\package.json"; DestDir: "{app}\bell_web"; Flags: ignoreversion
Source: "..\bell_web\.env.example"; DestDir: "{app}\bell_web"; Flags: ignoreversion
Source: "..\bell_web\public\*"; DestDir: "{app}\bell_web\public"; Flags: ignoreversion recursesubdirs createallsubdirs
#ifdef IncludeSecrets
Source: "..\bell_web\.env"; DestDir: "{app}\bell_web"; Flags: ignoreversion
#else
; .env o'rnatish paytida tanlangan joydan (fleshkadan) nusxalanadi - setup.exe ichida bo'lmaydi
Source: "{code:EnvSource}"; DestDir: "{app}\bell_web"; DestName: ".env"; Flags: external ignoreversion; Check: EnvChosen
#endif
; Ishga tushirgichlar va icon
Source: "files\start_scheduler.vbs"; DestDir: "{app}"; Flags: ignoreversion
Source: "files\start_panel.vbs"; DestDir: "{app}"; Flags: ignoreversion
Source: "files\open_panel.vbs"; DestDir: "{app}"; Flags: ignoreversion
Source: "files\bell.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
; Panel alohida dastur oynasida ochiladi (Edge/Chrome "ilova" rejimi - manzil satrisiz)
Name: "{group}\{#AppName} - {cm:PanelShortcut}"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\open_panel.vbs"""; IconFilename: "{app}\bell.ico"
Name: "{group}\{cm:UninstallProgram,{#AppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\open_panel.vbs"""; IconFilename: "{app}\bell.ico"; Tasks: desktopicon
; Windows'ga har kirilganda o'zi ishga tushadi (hech kimning qo'lisiz)
Name: "{userstartup}\{#AppName} - qo'ng'iroqlar"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\start_scheduler.vbs"""; IconFilename: "{app}\bell.ico"
Name: "{userstartup}\{#AppName} - panel"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\start_panel.vbs"""; IconFilename: "{app}\bell.ico"

[InstallDelete]
; Eski usul (o'rnatish.bat) qoldirgan yorliq - aks holda qo'ng'iroqlar ikki marta chalinardi
Type: files; Name: "{userstartup}\OIS School Bell Scheduler.lnk"
; 1.0.0 dagi brauzer yorlig'i (endi panel o'z oynasida ochiladi)
Type: files; Name: "{app}\panel.url"

[Run]
; O'rnatish tugashi bilan darrov ishga tushadi (kompyuterni qayta yoqish shart emas)
Filename: "{sys}\wscript.exe"; Parameters: """{app}\start_scheduler.vbs"""; Flags: nowait runhidden
Filename: "{sys}\wscript.exe"; Parameters: """{app}\start_panel.vbs"""; Flags: nowait runhidden
Filename: "{sys}\wscript.exe"; Parameters: """{app}\open_panel.vbs"""; Description: "{cm:OpenPanel}"; Flags: postinstall nowait skipifsilent

[UninstallDelete]
; Qayta tiklanadigan fayllar (kesh). Jadval va jurnal (foydalanuvchi ma'lumotlari) saqlanib qoladi.
Type: filesandordirs; Name: "{app}\runtime"
Type: filesandordirs; Name: "{app}\bell_system\__pycache__"
Type: filesandordirs; Name: "{app}\bell_system\audios\library"
Type: filesandordirs; Name: "{app}\bell_system\audios\_live"
Type: filesandordirs; Name: "{app}\bell_web\.cache"
Type: files; Name: "{app}\panel.url"

[Code]
var
  EnvPage: TInputFileWizardPage;

{ Dastur jarayonlarini to'xtatadi (yangilash yoki o'chirishdan oldin fayllar band bo'lmasligi uchun).
  IncludeLegacy = True bo'lsa, eski usulda (o'rnatish.bat) ishga tushirilgan bell_scheduler.py ham to'xtatiladi -
  aks holda eski va yangi nusxa birga ishlab, qo'ng'iroq ikki marta chalinardi. }
procedure StopAppProcesses(IncludeLegacy: Boolean);
var
  AppPath, Cmd, Legacy: String;
  ResultCode: Integer;
begin
  AppPath := ExpandConstant('{app}');
  StringChangeEx(AppPath, '''', '''''', True);
  Legacy := '';
  if IncludeLegacy then
    Legacy := ' -or ($_.CommandLine -like ''*bell_scheduler.py*'')';
  Cmd := '-NoProfile -ExecutionPolicy Bypass -Command "$r = ''' + AppPath + '\runtime\''; ' +
         'Get-CimInstance Win32_Process | Where-Object { ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($r, [StringComparison]::OrdinalIgnoreCase))' + Legacy + ' } | ' +
         'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"';
  Exec('powershell.exe', Cmd, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

procedure InitializeWizard;
begin
#ifndef IncludeSecrets
  EnvPage := CreateInputFilePage(wpSelectTasks, CustomMessage('EnvTitle'), CustomMessage('EnvSubtitle'), CustomMessage('EnvText'));
  EnvPage.Add(CustomMessage('EnvLabel'), 'Supabase (.env)|*.env|*.*|*.*', '.env');
#endif
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (EnvPage <> nil) and (CurPageID = EnvPage.ID) and (EnvPage.Values[0] <> '') and not FileExists(EnvPage.Values[0]) then
  begin
    MsgBox(CustomMessage('EnvMissing'), mbError, MB_OK);
    Result := False;
  end;
end;

function EnvChosen: Boolean;
begin
  Result := (EnvPage <> nil) and (EnvPage.Values[0] <> '');
end;

function EnvSource(Param: String): String;
begin
  Result := EnvPage.Values[0];
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  StopAppProcesses(True);
  Result := '';
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    StopAppProcesses(False);
end;
