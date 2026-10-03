# install.ps1
# OIS School Bell - bell_scheduler.py ni SHU kompyuterda o'rnatadi.
# Natija: bu kompyuterga HAR SAFAR Windows'ga kirilganda, bell_scheduler.py
# o'zi, ko'rinmas (konsol oynasiz) holda, hech kimning qo'lisiz ishga tushadi.
#
# Ishga tushirish: bu faylni emas, yonidagi "o'rnatish.bat" faylini ikki marta bosing.
# (Admin huquqi SHART EMAS - oddiy foydalanuvchi sifatida ishlaydi.)

$ErrorActionPreference = "Stop"
$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$schedulerDir = Join-Path $baseDir "bell_system"
$vbsPath = Join-Path $schedulerDir "start_bell_scheduler.vbs"

Write-Host "OIS School Bell - o'rnatish boshlandi..." -ForegroundColor Cyan
Write-Host "Papka: $baseDir"

if (-not (Test-Path (Join-Path $schedulerDir "bell_scheduler.py"))) {
    Write-Host ""
    Write-Host "XATOLIK: '$schedulerDir' papkasida bell_scheduler.py topilmadi." -ForegroundColor Red
    Write-Host "Butun 'School Bell' papkasini (bell_system ichidagi hamma narsa bilan birga) ko'chirganingizga ishonch hosil qiling." -ForegroundColor Red
    exit 1
}

# pythonw.exe manzilini shu kompyuterning PATH'idan o'zi topadi (qo'lda yozish shart emas)
$pythonw = (Get-Command pythonw.exe -ErrorAction SilentlyContinue).Source
if (-not $pythonw) {
    Write-Host ""
    Write-Host "XATOLIK: Python topilmadi." -ForegroundColor Red
    Write-Host "1) https://python.org/downloads dan Python 3 ni yuklab o'rnating." -ForegroundColor Yellow
    Write-Host "2) O'rnatish oynasida pastdagi 'Add python.exe to PATH' katagini ALBATTA belgilang." -ForegroundColor Yellow
    Write-Host "3) O'rnatib bo'lgach, kompyuterni qayta ishga tushiring va shu faylni qayta ishga tushiring." -ForegroundColor Yellow
    exit 1
}
Write-Host "Python topildi: $pythonw"

# start_bell_scheduler.vbs ni SHU kompyuterdagi pythonw yo'liga moslab qayta yozamiz
$vbsContent = @"
' start_bell_scheduler.vbs - avtomatik yaratilgan, qo'lda o'zgartirmang
' (qayta yaratish uchun: o'rnatish.bat ni qaytadan ishga tushiring)
Set fso = CreateObject("Scripting.FileSystemObject")
baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = baseDir
WshShell.Run """$pythonw"" ""bell_scheduler.py""", 0, False
"@
Set-Content -Path $vbsPath -Value $vbsContent -Encoding ASCII
Write-Host "Ishga tushirish fayli tayyorlandi: $vbsPath"

# Windows Startup papkasiga yorliq qo'yamiz - shu kompyuterga HAR safar kirilganda
# (admin huquqisiz, Task Scheduler'siz ham ishlaydigan, eng ishonchli oddiy usul)
$startupDir = [Environment]::GetFolderPath('Startup')
$WshShell2 = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell2.CreateShortcut((Join-Path $startupDir "OIS School Bell Scheduler.lnk"))
$Shortcut.TargetPath = $vbsPath
$Shortcut.WorkingDirectory = $schedulerDir
$Shortcut.Description = "OIS School Bell - avtomatik qo'ng'iroq dasturi (kompyuterga kirilganda ishga tushadi)"
$Shortcut.Save()
Write-Host "Avtomatik ishga tushirish yoqildi: $startupDir"

# Eski nusxasi ishlab turgan bo'lsa to'xtatamiz, keyin yangisini hozirning o'zida ishga tushiramiz
Get-Process pythonw -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -eq $pythonw
} | ForEach-Object {
    try {
        $cmdline = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine
        if ($cmdline -and $cmdline -like "*bell_scheduler.py*") { Stop-Process -Id $_.Id -Force }
    } catch {}
}
$WshShell2.CurrentDirectory = $schedulerDir
$WshShell2.Run("""$pythonw"" ""bell_scheduler.py""", 0, $false)
Start-Sleep -Seconds 1

Write-Host ""
Write-Host "TAYYOR!" -ForegroundColor Green
Write-Host "Bell scheduler hozir ishga tushirildi va bundan buyon bu kompyuterga" -ForegroundColor Green
Write-Host "har safar kirilganda o'zi, hech kimning qo'lisiz, avtomatik ishlaydi." -ForegroundColor Green
Write-Host "Jurnal fayli: $schedulerDir\logs\bell_log.csv"
