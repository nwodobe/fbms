# ============================================================
#  PJS Command Center - Automatisation
#  Sync-RCN-Reports : rapports Excel de RCN Warehouse
#  ------------------------------------------------------------
#  Parcourt la boite de reception Outlook (tous les comptes du
#  profil), repere les e-mails des expediteurs autorises et
#  enregistre leurs pieces jointes Excel/CSV dans :
#      <Workspace>\13 Reports\RCN Warehouse\<AAAA-MM>\
#  Un index CSV (_index.csv) journalise chaque fichier archive :
#  c'est la base de donnees exploitable (date, expediteur,
#  objet, fichier, mois).
#
#  Lecture seule : aucun e-mail n'est modifie, deplace ou envoye.
#
#  -InstallDaily : cree une tache planifiee Windows qui execute
#  cette synchronisation chaque jour a 07h45.
# ============================================================
param(
  [string]$Workspace = 'C:\PJS',
  [string[]]$Senders = @('rcn.warehouse1@anagroci.com'),
  [int]$Days = 120,
  [switch]$InstallDaily
)

$ErrorActionPreference = 'Stop'
$Target = Join-Path $Workspace '13 Reports\RCN Warehouse'
$Self = $MyInvocation.MyCommand.Path

# ---- Option : tache planifiee quotidienne --------------------------
if ($InstallDaily) {
  $arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Self`" -Workspace `"$Workspace`""
  $action  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg
  $trigger = New-ScheduledTaskTrigger -Daily -At '07:45'
  Register-ScheduledTask -TaskName 'PJS Sync RCN Reports' -Action $action -Trigger $trigger -Force | Out-Null
  return [pscustomobject]@{ ok = $true; daily = $true; time = '07:45' }
}

# ---- Preparation ----------------------------------------------------
if (-not (Test-Path $Target)) { New-Item -ItemType Directory -Path $Target -Force | Out-Null }
$Index = Join-Path $Target '_index.csv'
if (-not (Test-Path $Index)) {
  Set-Content -Path $Index -Value 'date_reception;expediteur;objet;fichier;mois' -Encoding UTF8
}

$Extensions = @('.xls', '.xlsx', '.xlsm', '.xlsb', '.csv')
$SenderSet = @($Senders | ForEach-Object { $_.ToLowerInvariant() })

# ---- Adresse SMTP reelle de l'expediteur ----------------------------
# (les comptes Exchange renvoient une adresse interne X500 sinon)
function Get-SmtpSender($mail) {
  try {
    if ($mail.SenderEmailType -eq 'EX') {
      $exu = $mail.Sender.GetExchangeUser()
      if ($exu -and $exu.PrimarySmtpAddress) { return [string]$exu.PrimarySmtpAddress }
      return [string]$mail.PropertyAccessor.GetProperty('http://schemas.microsoft.com/mapi/proptag/0x5D01001F')
    }
    return [string]$mail.SenderEmailAddress
  } catch {
    try { return [string]$mail.SenderEmailAddress } catch { return '' }
  }
}

# ---- Parcours d'Outlook ---------------------------------------------
$outlook = New-Object -ComObject Outlook.Application
$ns = $outlook.GetNamespace('MAPI')

$since = (Get-Date).AddDays(-$Days)
$filter = "[ReceivedTime] >= '" + $since.ToString('MM/dd/yyyy hh:mm tt', [Globalization.CultureInfo]::InvariantCulture) + "'"

$saved = 0; $skipped = 0; $mails = 0

foreach ($store in @($ns.Stores)) {
  $inbox = $null
  try { $inbox = $store.GetDefaultFolder(6) } catch { continue }   # 6 = boite de reception
  if (-not $inbox) { continue }

  $items = $inbox.Items.Restrict($filter)
  foreach ($mail in @($items)) {
    if ($mail.Class -ne 43) { continue }                            # 43 = e-mail
    $smtp = Get-SmtpSender $mail
    if (-not $smtp) { continue }
    if ($SenderSet -notcontains $smtp.ToLowerInvariant()) { continue }
    $mails++

    foreach ($att in @($mail.Attachments)) {
      $e = [IO.Path]::GetExtension([string]$att.FileName)
      if (-not $e -or ($Extensions -notcontains $e.ToLowerInvariant())) { continue }

      $month = $mail.ReceivedTime.ToString('yyyy-MM')
      $dir = Join-Path $Target $month
      if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

      $name = $mail.ReceivedTime.ToString('yyyyMMdd_HHmm') + '_' + [string]$att.FileName
      foreach ($c in [IO.Path]::GetInvalidFileNameChars()) { $name = $name.Replace([string]$c, '_') }

      $dest = Join-Path $dir $name
      if (Test-Path $dest) { $skipped++; continue }

      $att.SaveAsFile($dest)
      $saved++
      $subject = ([string]$mail.Subject) -replace ';', ','
      Add-Content -Path $Index -Encoding UTF8 -Value (
        $mail.ReceivedTime.ToString('yyyy-MM-dd HH:mm') + ';' + $smtp + ';' + $subject + ';' + $name + ';' + $month)
    }
  }
}

[pscustomobject]@{ ok = $true; saved = $saved; skipped = $skipped; mails = $mails; target = $Target }
