# build_app.ps1 - panelning alohida dasturini (OISSchoolBell.exe) yig'adi: installer\build\app\
# Kerak: Windows'dagi .NET Framework 4.x (csc.exe) va Microsoft WebView2 SDK (nuget.org, rasmiy paket).
# Ishga tushirish:  powershell -ExecutionPolicy Bypass -File installer\build_app.ps1

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$sdkVersion = "1.0.4258.31"
$downloads = "$here\build\downloads"
$sdk = "$downloads\webview2"
$out = "$here\build\app"

if (-not (Test-Path "$sdk\lib\net462\Microsoft.Web.WebView2.WinForms.dll")) {
  New-Item -ItemType Directory -Force $downloads | Out-Null
  $pkg = "$downloads\webview2.nupkg"
  if (-not (Test-Path $pkg)) {
    Invoke-WebRequest "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$sdkVersion/microsoft.web.webview2.$sdkVersion.nupkg" -OutFile $pkg
  }
  if (Test-Path $sdk) { Remove-Item -Recurse -Force $sdk }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($pkg, $sdk)
}

# Faqat Microsoft imzolagan DLL lar ishlatiladi
foreach ($dll in "$sdk\lib\net462\Microsoft.Web.WebView2.Core.dll", "$sdk\lib\net462\Microsoft.Web.WebView2.WinForms.dll", "$sdk\runtimes\win-x64\native\WebView2Loader.dll") {
  $sig = Get-AuthenticodeSignature $dll
  if ($sig.Status -ne "Valid" -or $sig.SignerCertificate.Subject -notlike "CN=Microsoft Corporation*") {
    Write-Host "Imzo noto'g'ri: $dll" -ForegroundColor Red
    exit 1
  }
}

$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { Write-Host "csc.exe topilmadi (.NET Framework 4.x kerak)" -ForegroundColor Red; exit 1 }

if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item "$sdk\lib\net462\Microsoft.Web.WebView2.Core.dll", "$sdk\lib\net462\Microsoft.Web.WebView2.WinForms.dll", "$sdk\runtimes\win-x64\native\WebView2Loader.dll" $out

& $csc /nologo /target:winexe /platform:x64 /optimize+ `
  "/win32icon:$here\files\bell.ico" `
  "/out:$out\OISSchoolBell.exe" `
  "/reference:$out\Microsoft.Web.WebView2.Core.dll" `
  "/reference:$out\Microsoft.Web.WebView2.WinForms.dll" `
  /reference:System.Windows.Forms.dll /reference:System.Drawing.dll `
  "$here\app\OISSchoolBell.cs"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Dastur tayyor: $out\OISSchoolBell.exe" -ForegroundColor Green
