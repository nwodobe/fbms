# ============================================================
#  PJS Command Center - Installation
#  ------------------------------------------------------------
#  1. Cree l'espace de travail C:\PJS (15 dossiers)
#  2. Copie l'application dans C:\PJS\01 Dashboard\App
#  3. Cree le raccourci "PJS Command Center" sur le Bureau
#
#  Usage :
#    Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
#    .\Install-PJS-Command-Center.ps1
# ============================================================
param([string]$Workspace = 'C:\PJS')

$ErrorActionPreference = 'Stop'
$Src = $PSScriptRoot

Write-Host ''
Write-Host '=============================================='
Write-Host '   PJS COMMAND CENTER - INSTALLATION'
Write-Host '=============================================='
Write-Host ''

# ---- 1. Espace de travail -----------------------------------------
$folders = @(
  '01 Dashboard', '02 AI', '03 Projects', '04 ANAGROCI', '05 PJS Transport',
  '06 FBMS', '07 RCN Trace', '08 GitHub', '09 Supabase', '10 Documents',
  '11 Automations', '12 Templates', '13 Reports', '14 Archive', '15 Secrets'
)
foreach ($f in $folders) {
  $p = Join-Path $Workspace $f
  if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null }
}
Write-Host "[1/3] Espace de travail cree : $Workspace"

# ---- 2. Copie de l'application ------------------------------------
$AppDir = Join-Path $Workspace '01 Dashboard\App'
if (-not (Test-Path $AppDir)) { New-Item -ItemType Directory -Path $AppDir -Force | Out-Null }

# Arrete un eventuel bridge en cours d'execution afin que la
# prochaine ouverture utilise la version mise a jour.
$tokFile = Join-Path $AppDir '.pcc-token'
if (Test-Path $tokFile) {
  try {
    $tok = (Get-Content $tokFile -Raw).Trim()
    Invoke-WebRequest -Uri "http://localhost:7315/api/shutdown?token=$tok" -UseBasicParsing -TimeoutSec 2 | Out-Null
    Write-Host '      Ancien bridge arrete (mise a jour).'
  } catch {}
}
Copy-Item (Join-Path $Src 'index.html')    $AppDir -Force
Copy-Item (Join-Path $Src 'Start-PJS.ps1') $AppDir -Force
if (Test-Path (Join-Path $Src 'pjs.config.json')) {
  # Ne pas ecraser une configuration existante deja personnalisee
  if (-not (Test-Path (Join-Path $AppDir 'pjs.config.json'))) {
    Copy-Item (Join-Path $Src 'pjs.config.json') $AppDir -Force
  }
}
$BridgeDir = Join-Path $AppDir 'bridge'
if (-not (Test-Path $BridgeDir)) { New-Item -ItemType Directory -Path $BridgeDir -Force | Out-Null }
Copy-Item (Join-Path $Src 'bridge\PJS-Bridge.ps1') $BridgeDir -Force
$AutoSrc = Join-Path $Src 'automations'
if (Test-Path $AutoSrc) {
  Copy-Item (Join-Path $AutoSrc '*.ps1') (Join-Path $Workspace '11 Automations') -Force
  Get-ChildItem (Join-Path $Workspace '11 Automations') -File | Unblock-File -ErrorAction SilentlyContinue
}
Get-ChildItem $AppDir -Recurse -File | Unblock-File -ErrorAction SilentlyContinue
Write-Host "[2/3] Application installee : $AppDir"

# ---- 3. Raccourci Bureau ------------------------------------------
$Desktop = [Environment]::GetFolderPath('Desktop')
$lnkPath = Join-Path $Desktop 'PJS Command Center.lnk'
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($lnkPath)
$lnk.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$AppDir\Start-PJS.ps1`""
$lnk.WorkingDirectory = $AppDir
$edge = @(
  "$env:PROGRAMFILES\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($edge) { $lnk.IconLocation = "$edge,0" } else { $lnk.IconLocation = "$env:SystemRoot\System32\shell32.dll,21" }
$lnk.Description = 'PJS Command Center - One Workspace. Every Project. Every AI.'
$lnk.Save()
Write-Host "[3/3] Raccourci cree sur le Bureau : PJS Command Center"

Write-Host ''
Write-Host '=============================================='
Write-Host '   INSTALLATION TERMINEE'
Write-Host '=============================================='
Write-Host ''
Write-Host 'Double-cliquez sur le raccourci "PJS Command Center"'
Write-Host 'du Bureau pour ouvrir votre poste de commande.'
Write-Host ''

$rep = Read-Host 'Lancer PJS Command Center maintenant ? (O/N)'
if ($rep -match '^[oOyY]') {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $AppDir 'Start-PJS.ps1')
}
