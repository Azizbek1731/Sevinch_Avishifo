# Builds SevinchAvishifo.exe (WinForms launcher for clinic LAN clients)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Resolve-Path (Join-Path $here '..\..')
$outDir = Join-Path $root 'dist\client-launcher'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) {
  $csc = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path $csc)) { throw 'csc.exe topilmadi (.NET Framework 4.x kerak)' }

$exe = Join-Path $outDir 'SevinchAvishifo.exe'
$src = Join-Path $here 'SevinchAvishifo.cs'
$refDir = Split-Path $csc

& $csc /nologo /target:winexe /optimize+ /platform:anycpu `
  /out:$exe `
  /reference:"System.dll" `
  /reference:"System.Drawing.dll" `
  /reference:"System.Windows.Forms.dll" `
  /reference:"System.Core.dll" `
  $src

if ($LASTEXITCODE -ne 0) { throw "csc exit $LASTEXITCODE" }

Copy-Item (Join-Path $here 'SevinchAvishifo.ini') (Join-Path $outDir 'SevinchAvishifo.ini') -Force
Copy-Item (Join-Path $here 'OQNALMA.txt') (Join-Path $outDir 'OQNALMA.txt') -Force -ErrorAction SilentlyContinue

# Also drop a copy into Downloads for easy USB transfer
$dl = Join-Path $env:USERPROFILE 'Downloads\SevinchAvishifo-Klient'
New-Item -ItemType Directory -Force -Path $dl | Out-Null
Copy-Item $exe (Join-Path $dl 'SevinchAvishifo.exe') -Force
Copy-Item (Join-Path $outDir 'SevinchAvishifo.ini') (Join-Path $dl 'SevinchAvishifo.ini') -Force
if (Test-Path (Join-Path $outDir 'OQNALMA.txt')) {
  Copy-Item (Join-Path $outDir 'OQNALMA.txt') (Join-Path $dl 'OQNALMA.txt') -Force
}

Write-Output "OK $exe"
Write-Output "OK $dl"
