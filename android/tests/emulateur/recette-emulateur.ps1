<#
  Recette de la mise à jour Web automatique sur un ÉMULATEUR Android (Windows, SDK Android installé).
  PRÉPARÉ, NON EXÉCUTÉ au 25/10/2026 (accès au dossier de l'ordinateur non accordé).

  N'utilise AUCUN téléphone réel : l'émulateur « fbms_maj_test » est créé à part (image android-35),
  l'APK de TEST (ci.anagroci.fieldbuying.debug, canal « test ») s'installe dans l'émulateur seulement.
  Aucune connexion à un compte réel ; opérations locales SYNTHÉTIQUES injectées dans la file du téléphone virtuel.

  Phases (à lancer dans l'ordre ; la publication des versions se fait entre deux phases avec
  android/scripts/publish-web-update.mjs --channel test) :
    .\recette-emulateur.ps1 -Phase demarrer   -Apk <chemin APK de test>
    .\recette-emulateur.ps1 -Phase file        # injecte 3 opérations synthétiques en attente, relève l'état
    .\recette-emulateur.ps1 -Phase etat        # état du moteur de mise à jour (state.json) + file
    .\recette-emulateur.ps1 -Phase hors-ligne  # mode avion
    .\recette-emulateur.ps1 -Phase en-ligne
    .\recette-emulateur.ps1 -Phase relancer    # arrêt forcé + relance (déclenche activation et vérification)
    .\recette-emulateur.ps1 -Phase arreter
  Chaque phase écrit un fichier horodaté dans .\resultats\ (preuves).
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet('demarrer', 'file', 'etat', 'hors-ligne', 'en-ligne', 'relancer', 'arreter')][string]$Phase,
  [string]$Apk = '',
  [string]$Sdk = 'C:\Dev\tools\android-sdk',
  [string]$Avd = 'fbms_maj_test'
)
$ErrorActionPreference = 'Stop'
$adb = Join-Path $Sdk 'platform-tools\adb.exe'
$emu = Join-Path $Sdk 'emulator\emulator.exe'
$pkg = 'ci.anagroci.fieldbuying.debug'
$out = Join-Path $PSScriptRoot 'resultats'; New-Item -ItemType Directory -Force -Path $out | Out-Null
function Log($name, $text) { $f = Join-Path $out ("{0:yyyyMMdd-HHmmss}-{1}.txt" -f (Get-Date), $name); $text | Out-File -Encoding utf8 $f; Write-Host "== $name -> $f"; $text }
function Serial { (& $adb devices | Select-String '^emulator-\d+\s+device' | ForEach-Object { ($_ -split '\s+')[0] } | Select-Object -First 1) }
function A { param([string[]]$a) $s = Serial; if (-not $s) { throw 'Aucun émulateur démarré (phase demarrer).' }; & $adb -s $s @a }

switch ($Phase) {
  'demarrer' {
    if (-not (Test-Path $Apk)) { throw "APK introuvable : $Apk" }
    $avds = & $emu -list-avds
    if ($avds -notcontains $Avd) {
      $mgr = Get-ChildItem -Recurse (Join-Path $Sdk 'cmdline-tools') -Filter avdmanager.bat | Select-Object -First 1
      'no' | & $mgr.FullName create avd -n $Avd -k 'system-images;android-35;google_apis;x86_64' -d pixel_5 | Out-Null
    }
    Start-Process -FilePath $emu -ArgumentList @('-avd', $Avd, '-no-snapshot', '-no-audio', '-no-boot-anim') -WindowStyle Minimized
    $t0 = Get-Date
    while (-not ((Serial) -and ((A shell getprop sys.boot_completed) -match '1'))) { if (((Get-Date) - $t0).TotalSeconds -gt 300) { throw 'Démarrage émulateur > 5 min' }; Start-Sleep 5 }
    A install -r $Apk | Out-Null
    A shell am start -n "$pkg/ci.anagroci.fieldbuying.MainActivity" | Out-Null
    Start-Sleep 25
    Log 'demarrer' ((A shell dumpsys package $pkg | Select-String 'versionCode|versionName|firstInstallTime|lastUpdateTime') -join "`n")
  }
  'file' {
    # Opérations SYNTHÉTIQUES dans la vraie file IndexedDB de la WebView, via le débogage WebView (APK debug uniquement).
    $pid_ = (A shell pidof $pkg).Trim()
    A forward tcp:9333 "localabstract:webview_devtools_remote_$pid_" | Out-Null
    node (Join-Path $PSScriptRoot 'cdp-file.mjs') 9333 injecter | Tee-Object -Variable r | Out-Null
    Log 'file' ($r -join "`n")
  }
  'etat' {
    $st = A shell run-as $pkg cat files/web-updates/state.json
    $pid_ = (A shell pidof $pkg).Trim()
    $q = ''
    if ($pid_) { A forward tcp:9333 "localabstract:webview_devtools_remote_$pid_" | Out-Null; $q = (node (Join-Path $PSScriptRoot 'cdp-file.mjs') 9333 lire) -join "`n" }
    Log 'etat' ("STATE.JSON`n$($st -join "`n")`n`nFILE LOCALE ET PAGE`n$q")
  }
  'hors-ligne' { A shell cmd connectivity airplane-mode enable | Out-Null; Start-Sleep 3; Log 'hors-ligne' ((A shell dumpsys connectivity | Select-String 'Active default network' ) -join "`n") }
  'en-ligne' { A shell cmd connectivity airplane-mode disable | Out-Null; Start-Sleep 8; Log 'en-ligne' ((A shell dumpsys connectivity | Select-String 'Active default network') -join "`n") }
  'relancer' {
    A shell am force-stop $pkg | Out-Null; Start-Sleep 2
    A shell am start -n "$pkg/ci.anagroci.fieldbuying.MainActivity" | Out-Null
    Start-Sleep 30   # la vérification automatique part 15 s après l'ouverture
    Log 'relancer' ((A shell run-as $pkg cat files/web-updates/state.json) -join "`n")
  }
  'arreter' { A emu kill | Out-Null; Log 'arreter' 'émulateur arrêté' }
}
