# build_installer.ps1 - OIS School Bell o'rnatuvchisini (setup.exe) yasaydi.
# Ishga tushirish:  powershell -ExecutionPolicy Bypass -File installer\build_installer.ps1
# Natija:           installer\Output\OIS-School-Bell-Setup-<versiya>.exe

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$iscc = @(
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
  "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) {
  # Boshqa diskka/papkaga o'rnatilgan bo'lsa - Windows'dagi o'rnatilgan dasturlar ro'yxatidan topamiz
  $keys = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
          'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
          'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
  $loc = (Get-ItemProperty $keys -ErrorAction SilentlyContinue |
          Where-Object { $_.DisplayName -like 'Inno Setup*' -and $_.InstallLocation } | Select-Object -First 1).InstallLocation
  if ($loc -and (Test-Path (Join-Path $loc "ISCC.exe"))) { $iscc = Join-Path $loc "ISCC.exe" }
}
if (-not $iscc) {
  Write-Host "Inno Setup 6 topilmadi. https://jrsoftware.org/isdl.php dan o'rnating va qayta ishga tushiring." -ForegroundColor Red
  exit 1
}

# Ichki muhit (Python + Node) hali yig'ilmagan bo'lsa - yig'amiz
if (-not (Test-Path "$here\build\runtime\python\pythonw.exe")) {
  if (-not (Test-Path "$here\build\downloads\python-3.14.0-embed-amd64.zip")) {
    Write-Host "installer\build\downloads\python-3.14.0-embed-amd64.zip topilmadi (README.md ga qarang)." -ForegroundColor Red
    exit 1
  }
  python "$here\stage_runtime.py"
  if ($LASTEXITCODE -ne 0) { exit 1 }
}

& $iscc "$here\OIS-School-Bell.iss"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host ""
Write-Host "Tayyor:" (Get-ChildItem "$here\Output\*.exe" | Sort-Object LastWriteTime | Select-Object -Last 1).FullName -ForegroundColor Green
