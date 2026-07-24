# ============================================================
#  PJS Command Center - Lanceur
#  ------------------------------------------------------------
#  1. Demarre le bridge local (s'il ne tourne pas deja)
#  2. Ouvre le tableau de bord dans une fenetre application Edge
# ============================================================
param([int]$Port = 7315)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$TokenFile = Join-Path $Root '.pcc-token'

function Test-Bridge {
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:$Port/ping" -UseBasicParsing -TimeoutSec 1
    return ($r.StatusCode -eq 200)
  } catch { return $false }
}

# ---- 1. Bridge -----------------------------------------------------
if (Test-Bridge) {
  # Bridge deja actif : on reutilise son jeton de session.
  $Token = (Get-Content $TokenFile -Raw -ErrorAction SilentlyContinue)
  if ($Token) { $Token = $Token.Trim() }
  if (-not $Token) {
    Write-Warning "Bridge actif mais jeton introuvable. Fermez-le puis relancez."
    exit 1
  }
  Write-Host "Bridge deja actif sur le port $Port."
} else {
  $Token = [guid]::NewGuid().ToString('N')
  $bridge = Join-Path $Root 'bridge\PJS-Bridge.ps1'
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', "`"$bridge`"", '-Port', $Port, '-Token', $Token
  ) | Out-Null

  $ok = $false
  foreach ($i in 1..24) {
    Start-Sleep -Milliseconds 250
    if (Test-Bridge) { $ok = $true; break }
  }
  if (-not $ok) {
    Write-Warning "Le bridge n'a pas demarre. Lancez manuellement :"
    Write-Warning "  powershell -ExecutionPolicy Bypass -File `"$bridge`""
    exit 1
  }
  Write-Host "Bridge demarre sur le port $Port."
}

# ---- 2. Tableau de bord -------------------------------------------
$url = "http://localhost:$Port/app?token=$Token"

$edge = @(
  "$env:PROGRAMFILES\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($edge) {
  Start-Process $edge -ArgumentList "--app=$url", '--window-size=1440,900' | Out-Null
} else {
  Start-Process $url | Out-Null   # navigateur par defaut
}
Write-Host 'PJS Command Center ouvert. Bonne journee, Monsieur KOUASSI.'
