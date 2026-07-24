# ============================================================
#  PJS Command Center - Automatisation
#  Sync-RCN-Reports : bases de donnees des rapports e-mail
#  ------------------------------------------------------------
#  Parcourt la boite de reception Outlook (tous les comptes du
#  profil, sous-dossiers compris) et archive les pieces jointes
#  Excel/CSV des flux configures ci-dessous dans :
#      <Workspace>\13 Reports\<Flux>\<AAAA-MM>\
#  Chaque flux possede son index CSV (_index.csv) : c'est la
#  base de donnees exploitable (date, expediteur, objet,
#  fichier, mois).
#
#  Flux suivis :
#    - RCN Warehouse      : tout Excel de rcn.warehouse1@anagroci.com
#    - Consolidated Cashew: rapports CONSOLIDATED CASHEW de
#                           rcn.accounts@anagroci.com
#
#  Lecture seule : aucun e-mail n'est modifie, deplace ou envoye.
#
#  -InstallDaily : cree une tache planifiee Windows qui execute
#  cette synchronisation chaque jour a 07h45.
# ============================================================
param(
  [string]$Workspace = 'C:\PJS',
  [int]$Days = 120,
  [switch]$InstallDaily
)

$ErrorActionPreference = 'Stop'
$ReportsRoot = Join-Path $Workspace '13 Reports'
$Self = $MyInvocation.MyCommand.Path

# ---- Flux suivis ----------------------------------------------------
# Senders  : adresses e-mail surveillees (vide = tout expediteur)
# NameLike : filtre regex sur le nom de piece jointe OU l'objet
#            ('' = toutes les pieces jointes acceptees)
# Ext      : extensions acceptees (vide = Excel/CSV par defaut)
# Folder   : sous-dossier de "13 Reports" qui recoit la base
$Feeds = @(
  @{ Id = 'warehouse'; Label = 'RCN Warehouse'
     Senders = @('rcn.warehouse1@anagroci.com')
     NameLike = ''; Ext = @(); Folder = 'RCN Warehouse' },
  @{ Id = 'cashew'; Label = 'Consolidated Cashew'
     Senders = @('rcn.accounts@anagroci.com')
     NameLike = 'CONSOLIDATED|CASHEW'; Ext = @(); Folder = 'Consolidated Cashew' },
  # Exports WhatsApp du groupe Yamoussoukro RCN warehouse :
  # depuis le telephone, Exporter la discussion -> s'envoyer le
  # fichier par e-mail ; la synchronisation l'archive ici.
  @{ Id = 'whatsapp'; Label = 'WhatsApp Yakro RCN'
     Senders = @()
     NameLike = '(?=.*whatsapp)(?=.*(yamoussoukro|yakro))'
     Ext = @('.txt', '.zip'); Folder = 'WhatsApp Yakro RCN' }
)

# ---- Option : tache planifiee quotidienne --------------------------
if ($InstallDaily) {
  $arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Self`" -Workspace `"$Workspace`""
  $action  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg
  $trigger = New-ScheduledTaskTrigger -Daily -At '07:45'
  Register-ScheduledTask -TaskName 'PJS Sync RCN Reports' -Action $action -Trigger $trigger -Force | Out-Null
  return [pscustomobject]@{ ok = $true; daily = $true; time = '07:45' }
}

# ---- Preparation ----------------------------------------------------
$Extensions = @('.xls', '.xlsx', '.xlsm', '.xlsb', '.csv')
foreach ($feed in $Feeds) {
  $feed.Target = Join-Path $ReportsRoot $feed.Folder
  if (-not (Test-Path $feed.Target)) { New-Item -ItemType Directory -Path $feed.Target -Force | Out-Null }
  $feed.Index = Join-Path $feed.Target '_index.csv'
  if (-not (Test-Path $feed.Index)) {
    Set-Content -Path $feed.Index -Value 'date_reception;expediteur;objet;fichier;mois' -Encoding UTF8
  }
  $feed.SenderSet = @($feed.Senders | ForEach-Object { $_.ToLowerInvariant() })
  $feed.Saved = 0; $feed.Skipped = 0; $feed.Mails = 0
}

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

# Boite de reception + tous ses sous-dossiers (regles de classement)
function Get-MailFolders($root) {
  $list = @($root)
  try { foreach ($f in @($root.Folders)) { $list += Get-MailFolders $f } } catch {}
  return $list
}

$inboxes = @()

foreach ($store in @($ns.Stores)) {
  $inbox = $null
  try { $inbox = $store.GetDefaultFolder(6) } catch { continue }   # 6 = boite de reception
  if (-not $inbox) { continue }
  $inboxes += $inbox

  foreach ($folder in (Get-MailFolders $inbox)) {
    $items = $null
    try { $items = $folder.Items.Restrict($filter) } catch { continue }
    foreach ($mail in @($items)) {
      if ($mail.Class -ne 43) { continue }                          # 43 = e-mail
      $smtp = Get-SmtpSender $mail
      if (-not $smtp) { continue }
      $smtpLow = $smtp.ToLowerInvariant()

      foreach ($feed in $Feeds) {
        if ($feed.SenderSet.Count -gt 0 -and $feed.SenderSet -notcontains $smtpLow) { continue }
        $matched = $false

        foreach ($att in @($mail.Attachments)) {
          $fname = [string]$att.FileName
          $e = [IO.Path]::GetExtension($fname)
          $allowed = if ($feed.Ext.Count -gt 0) { $feed.Ext } else { $Extensions }
          if (-not $e -or ($allowed -notcontains $e.ToLowerInvariant())) { continue }
          if ($feed.NameLike -and
              ($fname -notmatch $feed.NameLike) -and
              (([string]$mail.Subject) -notmatch $feed.NameLike)) { continue }
          $matched = $true

          $month = $mail.ReceivedTime.ToString('yyyy-MM')
          $dir = Join-Path $feed.Target $month
          if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

          $name = $mail.ReceivedTime.ToString('yyyyMMdd_HHmm') + '_' + $fname
          foreach ($c in [IO.Path]::GetInvalidFileNameChars()) { $name = $name.Replace([string]$c, '_') }

          $dest = Join-Path $dir $name
          if (Test-Path $dest) { $feed.Skipped++; continue }

          $att.SaveAsFile($dest)
          $feed.Saved++
          $subject = ([string]$mail.Subject) -replace ';', ','
          Add-Content -Path $feed.Index -Encoding UTF8 -Value (
            $mail.ReceivedTime.ToString('yyyy-MM-dd HH:mm') + ';' + $smtp + ';' + $subject + ';' + $name + ';' + $month)
        }
        if ($matched) { $feed.Mails++ }
      }
    }
  }
}

# ---- Diagnostic : aucun e-mail correspondant ------------------------
# On liste les expediteurs recents pour reperer la vraie adresse
# d'envoi des rapports (affiche dans le tableau de bord).
$totalMails = 0
foreach ($feed in $Feeds) { $totalMails += $feed.Mails }
$hint = ''
if ($totalMails -eq 0 -and $inboxes.Count -gt 0) {
  $recent = "[ReceivedTime] >= '" + (Get-Date).AddDays(-30).ToString('MM/dd/yyyy hh:mm tt', [Globalization.CultureInfo]::InvariantCulture) + "'"
  $counts = @{}
  foreach ($inbox in $inboxes) {
    $items = $null
    try { $items = $inbox.Items.Restrict($recent); $items.Sort('[ReceivedTime]', $true) } catch { continue }
    $n = 0
    foreach ($mail in @($items)) {
      if ($n -ge 300) { break }
      if ($mail.Class -ne 43) { continue }
      $n++
      $s = (Get-SmtpSender $mail)
      if ($s) { $s = $s.ToLowerInvariant(); if ($counts.ContainsKey($s)) { $counts[$s]++ } else { $counts[$s] = 1 } }
    }
  }
  $top = $counts.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 8 | ForEach-Object { $_.Key }
  if ($top) { $hint = ($top -join ' | ') }
}

$result = @()
foreach ($feed in $Feeds) {
  $result += @{ id = $feed.Id; label = $feed.Label; saved = $feed.Saved; skipped = $feed.Skipped; mails = $feed.Mails }
}
[pscustomobject]@{ ok = $true; feeds = $result; totalMails = $totalMails; hint = $hint; target = $ReportsRoot }
