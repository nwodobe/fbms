# ============================================================
#  PJS Command Center - Bridge local
#  ------------------------------------------------------------
#  Mini serveur HTTP sur 127.0.0.1 (jamais expose au reseau).
#  - Sert le tableau de bord (index.html)
#  - Detecte les applications installees (liste blanche)
#  - Lance les applications autorisees uniquement
#  - Ouvre uniquement les dossiers de l'espace C:\PJS
#  Toute requete (hors /ping) exige le jeton de session.
#  Aucune commande arbitraire n'est executee.
# ============================================================
param(
  [int]$Port = 7315,
  [string]$Token = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Web
$AppRoot = Split-Path -Parent $PSScriptRoot   # dossier contenant index.html

if (-not $Token) { $Token = [guid]::NewGuid().ToString('N') }
Set-Content -Path (Join-Path $AppRoot '.pcc-token') -Value $Token -Encoding ASCII

# ---- Configuration ------------------------------------------------
$Config = @{
  userName    = 'Monsieur KOUASSI'
  workspace   = 'C:\PJS'
  siteUrl     = 'https://nwodobe.github.io/fbms/'
  githubRepo  = 'https://github.com/nwodobe/fbms'
  supabaseUrl = 'https://supabase.com/dashboard'
}
$ConfigFile = Join-Path $AppRoot 'pjs.config.json'
if (Test-Path $ConfigFile) {
  try {
    $json = Get-Content $ConfigFile -Raw | ConvertFrom-Json
    foreach ($k in @($Config.Keys)) {
      if ($json.PSObject.Properties[$k] -and $json.$k) { $Config[$k] = [string]$json.$k }
    }
  } catch { Write-Warning "pjs.config.json illisible - configuration par defaut utilisee." }
}

# ---- Detection des applications -----------------------------------
function Get-AppPathExe([string]$exe) {
  foreach ($hive in 'HKCU:', 'HKLM:') {
    $key = "$hive\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$exe"
    if (Test-Path $key) {
      try {
        $p = (Get-ItemProperty $key).'(default)'
        if ($p) { $p = $p.Trim('"'); if (Test-Path $p) { return $p } }
      } catch {}
    }
  }
  return $null
}

# Liste blanche : seuls ces identifiants peuvent etre lances.
# Paths     : chemins candidats de l'executable
# AppPaths  : nom d'exe inscrit dans le registre Windows (App Paths)
# Protocol  : URI de protocole Windows (ex. ms-copilot:)
$Catalog = [ordered]@{
  chatgpt    = @{ Paths = @("$env:LOCALAPPDATA\Microsoft\WindowsApps\chatgpt.exe",
                            "$env:LOCALAPPDATA\Programs\ChatGPT\ChatGPT.exe") }
  claude     = @{ Paths = @("$env:LOCALAPPDATA\AnthropicClaude\claude.exe",
                            "$env:LOCALAPPDATA\Programs\Claude\Claude.exe") }
  copilot    = @{ Protocol = 'ms-copilot:' }
  excel      = @{ AppPaths = 'excel.exe' }
  word       = @{ AppPaths = 'winword.exe' }
  powerpoint = @{ AppPaths = 'powerpnt.exe' }
  outlook    = @{ AppPaths = 'outlook.exe' }
  acrobat    = @{ AppPaths = 'Acrobat.exe'
                  Paths = @("$env:PROGRAMFILES\Adobe\Acrobat DC\Acrobat\Acrobat.exe",
                            "${env:ProgramFiles(x86)}\Adobe\Acrobat Reader DC\Reader\AcroRd32.exe") }
  vscode     = @{ Paths = @("$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe",
                            "$env:PROGRAMFILES\Microsoft VS Code\Code.exe") }
  ghdesktop  = @{ Paths = @("$env:LOCALAPPDATA\GitHubDesktop\GitHubDesktop.exe") }
}

# Dossiers autorises de l'espace PJS (cle -> nom)
$Folders = [ordered]@{
  '01' = '01 Dashboard';   '02' = '02 AI';            '03' = '03 Projects'
  '04' = '04 ANAGROCI';    '05' = '05 PJS Transport'; '06' = '06 FBMS'
  '07' = '07 RCN Trace';   '08' = '08 GitHub';        '09' = '09 Supabase'
  '10' = '10 Documents';   '11' = '11 Automations';   '12' = '12 Templates'
  '13' = '13 Reports';     '14' = '14 Archive';       '15' = '15 Secrets'
}

function Resolve-App([string]$id) {
  $def = $Catalog[$id]
  if (-not $def) { return $null }
  if ($def.Paths) {
    foreach ($p in $def.Paths) { if ($p -and (Test-Path $p)) { return @{ Kind='exe'; Target=$p } } }
  }
  if ($def.AppPaths) {
    $p = Get-AppPathExe $def.AppPaths
    if ($p) { return @{ Kind='exe'; Target=$p } }
  }
  if ($def.Protocol) { return @{ Kind='protocol'; Target=$def.Protocol } }
  return $null
}

function Get-StatusPayload {
  $apps = @()
  foreach ($id in $Catalog.Keys) {
    $apps += @{ id = $id; installed = [bool](Resolve-App $id) }
  }
  return @{
    ok = $true; apps = $apps
    userName = $Config.userName; workspace = $Config.workspace
    siteUrl = $Config.siteUrl; githubRepo = $Config.githubRepo; supabaseUrl = $Config.supabaseUrl
  }
}

# ---- Serveur HTTP --------------------------------------------------
# "localhost" (et non 127.0.0.1) : seul prefixe autorise sans droits
# administrateur par HTTP.sys. Jamais accessible depuis le reseau.
$prefix = "http://localhost:$Port/"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Host "PJS Bridge actif sur $prefix (Ctrl+C pour arreter)"

function Send-Json($ctx, $obj, [int]$code = 200) {
  $bytes = [Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Depth 6 -Compress))
  $ctx.Response.StatusCode = $code
  $ctx.Response.ContentType = 'application/json; charset=utf-8'
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $ctx.Response.Close()
}
function Send-File($ctx, [string]$path, [string]$type) {
  if (-not (Test-Path $path)) { Send-Json $ctx @{ ok=$false; error='not-found' } 404; return }
  $bytes = [IO.File]::ReadAllBytes($path)
  $ctx.Response.ContentType = $type
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $ctx.Response.Close()
}

$running = $true
while ($running -and $listener.IsListening) {
  try { $ctx = $listener.GetContext() } catch { break }
  try {
    $req  = $ctx.Request
    $path = $req.Url.AbsolutePath.TrimEnd('/')
    if ($path -eq '') { $path = '/' }
    $q = [System.Web.HttpUtility]::ParseQueryString($req.Url.Query)
    $tok = $q['token']

    if ($path -eq '/ping') { Send-Json $ctx @{ ok = $true; app = 'pjs-bridge' }; continue }

    if ($tok -ne $Token) { Send-Json $ctx @{ ok = $false; error = 'unauthorized' } 401; continue }

    switch -Regex ($path) {
      '^/(app)?$' {
        Send-File $ctx (Join-Path $AppRoot 'index.html') 'text/html; charset=utf-8'
      }
      '^/api/status$' {
        Send-Json $ctx (Get-StatusPayload)
      }
      '^/api/launch$' {
        $id = $q['app']
        $res = if ($id) { Resolve-App $id } else { $null }
        if (-not $Catalog.Contains([string]$id)) {
          Send-Json $ctx @{ ok = $false; error = 'app-inconnue' } 400
        } elseif (-not $res) {
          Send-Json $ctx @{ ok = $false; error = 'non-installee' } 404
        } else {
          Start-Process $res.Target | Out-Null
          Send-Json $ctx @{ ok = $true; launched = $id }
        }
      }
      '^/api/open$' {
        $key = [string]$q['key']
        if (-not $Folders.Contains($key)) {
          Send-Json $ctx @{ ok = $false; error = 'dossier-inconnu' } 400
        } else {
          $dir = Join-Path $Config.workspace $Folders[$key]
          if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
          Start-Process explorer.exe $dir | Out-Null
          Send-Json $ctx @{ ok = $true; opened = $Folders[$key] }
        }
      }
      '^/api/shutdown$' {
        Send-Json $ctx @{ ok = $true; bye = $true }
        $running = $false
        $listener.Stop()
      }
      default {
        Send-Json $ctx @{ ok = $false; error = 'route-inconnue' } 404
      }
    }
  } catch {
    try { Send-Json $ctx @{ ok = $false; error = 'erreur-interne' } 500 } catch {}
  }
}
try { $listener.Close() } catch {}
Write-Host 'PJS Bridge arrete.'
