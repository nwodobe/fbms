# ============================================================
#  PJS Command Center - Installation en une commande
#  ------------------------------------------------------------
#  Telecharge la derniere version depuis GitHub, puis lance
#  l'installateur (espace C:\PJS + raccourci Bureau).
#
#  Usage (PowerShell) :
#    irm https://raw.githubusercontent.com/nwodobe/fbms/claude/pjs-command-center-ix4i0c/pjs-command-center/get-pjs.ps1 | iex
# ============================================================
$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

Write-Host ''
Write-Host '  PJS COMMAND CENTER - Telechargement en cours...'
Write-Host ''

$branch = 'claude/pjs-command-center-ix4i0c'
$urls = @(
  "https://github.com/nwodobe/fbms/archive/refs/heads/$branch.zip",
  'https://github.com/nwodobe/fbms/archive/refs/heads/main.zip'
)

$tmp = Join-Path $env:TEMP 'pjs-install'
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory -Path $tmp | Out-Null
$zip = Join-Path $tmp 'pjs.zip'

$ok = $false
foreach ($u in $urls) {
  try {
    Invoke-WebRequest -Uri $u -OutFile $zip -UseBasicParsing
    $ok = $true; break
  } catch { }
}
if (-not $ok) {
  Write-Warning 'Telechargement impossible. Verifiez la connexion internet puis reessayez.'
  return
}

Expand-Archive -Path $zip -DestinationPath $tmp -Force
$src = Get-ChildItem $tmp -Directory | Where-Object { $_.Name -like 'fbms-*' } | Select-Object -First 1
$app = Join-Path $src.FullName 'pjs-command-center'
if (-not (Test-Path (Join-Path $app 'Install-PJS-Command-Center.ps1'))) {
  Write-Warning 'Dossier pjs-command-center introuvable dans l''archive.'
  return
}
Get-ChildItem $app -Recurse -File | Unblock-File -ErrorAction SilentlyContinue

# Lance l'installateur en contournant la politique d'execution
# pour cette seule execution (aucun reglage systeme modifie).
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $app 'Install-PJS-Command-Center.ps1')
