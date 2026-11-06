$ErrorActionPreference = 'Stop'

function Out-Json($obj) {
  $json = $obj | ConvertTo-Json -Compress -Depth 6
  $target = $env:RODA_RESULT
  [System.IO.File]::WriteAllText($target, $json, (New-Object System.Text.UTF8Encoding $false))
}

trap {
  $msg = $_.Exception.Message
  if ($_.Exception.InnerException) { $msg = $_.Exception.InnerException.Message }
  if ($env:RODA_HOST -eq '1') { continue }
  try { Out-Json @{ ok = $false; error = [string]$msg } } catch {}
  exit 1
}

if (-not ('RodaNative' -as [type])) {
  Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class RodaNative {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@
}

$script:KnownExt = 'doc|docx|docm|pdf|xls|xlsx|xlsm|csv|ppt|pptx|ppsx|txt|rtf|html|htm|png|jpg|jpeg|webp|gif|bmp|svg|odt|mp3|wav|m4a|aac|flac|ogg|opus|wma|mp4|mkv|webm|mov|avi'

function Get-ActiveCom($progId) {
  try { return [Runtime.InteropServices.Marshal]::GetActiveObject($progId) }
  catch { return $null }
}

function New-Source($kind, $name, $path, $saved, $ext) {
  if (-not $ext) { $ext = '' }
  return @{
    kind = $kind
    name = [string]$name
    path = [string]$path
    saved = [bool]$saved
    ext = ([string]$ext).ToLower()
  }
}

function New-SourceFromPath($filePath) {
  $full = (Resolve-Path -LiteralPath $filePath).Path
  $name = [System.IO.Path]::GetFileName($full)
  $ext = [System.IO.Path]::GetExtension($full)
  return (New-Source 'file' $name $full $true $ext)
}

function Find-NamedFile($title) {
  if ([string]::IsNullOrWhiteSpace($title)) { return $null }
  $direct = Find-PathInText $title
  if ($direct) { return $direct }
  $match = [regex]::Match($title, "(?i)([^\\/:*?""<>|\r\n]+\.(?:$script:KnownExt))")
  if (-not $match.Success) { return $null }
  $name = $match.Groups[1].Value.Trim()
  $dirs = @(
    [Environment]::GetFolderPath('Desktop'),
    (Join-Path $env:USERPROFILE 'Downloads'),
    (Join-Path (Join-Path $env:USERPROFILE 'Downloads') 'Converts'),
    (Join-Path (Join-Path $env:USERPROFILE 'Downloads') 'Roda'),
    [Environment]::GetFolderPath('MyDocuments')
  )
  foreach ($dir in $dirs) {
    if (-not $dir) { continue }
    $candidate = Join-Path $dir $name
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }
  return $null
}

function Find-PathInText($text) {
  if ([string]::IsNullOrWhiteSpace($text)) { return $null }
  $pattern = "(?i)[A-Z]:\\(?:[^\\/:*?""<>|\r\n]+\\)*[^\\/:*?""<>|\r\n]+\.(?:$script:KnownExt)\b"
  $hits = [regex]::Matches($text, $pattern)
  foreach ($hit in $hits) {
    $candidate = $hit.Value.Trim().Trim('"').Trim("'")
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }
  return $null
}

function Get-ExplorerFile($hwnd) {
  try { $shell = New-Object -ComObject Shell.Application } catch { return $null }
  foreach ($window in @($shell.Windows())) {
    try {
      if ([int64]$window.HWND -ne [int64]$hwnd) { continue }
      $items = @($window.Document.SelectedItems())
      if ($items.Count -lt 1) { continue }
      $filePath = [string]$items[0].Path
      if ($filePath -and (Test-Path -LiteralPath $filePath -PathType Leaf)) { return $filePath }
    } catch {}
  }
  return $null
}

function Get-WordSource($word) {
  $doc = $word.ActiveDocument
  $name = [string]$doc.Name
  $folder = ''
  try { $folder = [string]$doc.Path } catch {}
  $full = ''
  if ($folder) {
    try { $full = [string]$doc.FullName } catch {}
  }
  $ext = [System.IO.Path]::GetExtension($name)
  if ([string]::IsNullOrWhiteSpace($ext)) { $ext = '.docx' }
  return (New-Source 'word-live' $name $full ([bool]$folder) $ext)
}

function Get-ExcelSource($excel) {
  $book = $excel.ActiveWorkbook
  $name = [string]$book.Name
  $folder = ''
  try { $folder = [string]$book.Path } catch {}
  $full = ''
  if ($folder) {
    try { $full = [string]$book.FullName } catch {}
  }
  $ext = [System.IO.Path]::GetExtension($name)
  if ([string]::IsNullOrWhiteSpace($ext)) { $ext = '.xlsx' }
  return (New-Source 'excel-live' $name $full ([bool]$folder) $ext)
}

function Get-PptSource($ppt) {
  $pres = $ppt.ActivePresentation
  $name = [string]$pres.Name
  $folder = ''
  try { $folder = [string]$pres.Path } catch {}
  $full = ''
  if ($folder) {
    try { $full = [string]$pres.FullName } catch {}
  }
  $ext = [System.IO.Path]::GetExtension($name)
  if ([string]::IsNullOrWhiteSpace($ext)) { $ext = '.pptx' }
  return (New-Source 'ppt-live' $name $full ([bool]$folder) $ext)
}

function Get-Probe {
  $hwnd = [RodaNative]::GetForegroundWindow()
  $titleBuilder = New-Object System.Text.StringBuilder 1024
  [void][RodaNative]::GetWindowText($hwnd, $titleBuilder, $titleBuilder.Capacity)
  $procId = [uint32]0
  [void][RodaNative]::GetWindowThreadProcessId($hwnd, [ref]$procId)
  $processName = ''
  try { $processName = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch {}
  $upper = $processName.ToUpperInvariant()

  if ($upper -eq 'WINWORD') {
    $word = Get-ActiveCom 'Word.Application'
    if ($word -and [int]$word.Documents.Count -gt 0) { return (Get-WordSource $word) }
  }
  if ($upper -eq 'EXCEL') {
    $excel = Get-ActiveCom 'Excel.Application'
    if ($excel -and [int]$excel.Workbooks.Count -gt 0) { return (Get-ExcelSource $excel) }
  }
  if ($upper -eq 'POWERPNT') {
    $ppt = Get-ActiveCom 'PowerPoint.Application'
    if ($ppt -and [int]$ppt.Presentations.Count -gt 0) { return (Get-PptSource $ppt) }
  }
  if ($upper -eq 'EXPLORER') {
    $selected = Get-ExplorerFile $hwnd
    if ($selected) { return (New-SourceFromPath $selected) }
  }

  $found = Find-NamedFile ($titleBuilder.ToString())
  if ($found) { return (New-SourceFromPath $found) }

  return (New-Source 'none' '' '' $false '')
}

function Ensure-Parent($dest) {
  $parent = Split-Path -Parent $dest
  if ($parent -and -not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }
}

function Write-TextFile($dest, $text) {
  if ($null -eq $text) { $text = '' }
  [System.IO.File]::WriteAllText($dest, [string]$text, (New-Object System.Text.UTF8Encoding $false))
}

function Get-SheetText($sheet) {
  $used = $sheet.UsedRange
  $vals = $used.Value2
  if ($null -eq $vals) { return '' }
  if ($vals -isnot [Array]) { return [string]$vals }
  if ($vals.Rank -lt 2) { return ((@($vals) | ForEach-Object { [string]$_ }) -join "`t") }
  $r0 = $vals.GetLowerBound(0)
  $r1 = [Math]::Min($vals.GetUpperBound(0), $r0 + 199)
  $c0 = $vals.GetLowerBound(1)
  $c1 = [Math]::Min($vals.GetUpperBound(1), $c0 + 19)
  $lines = New-Object System.Collections.Generic.List[string]
  for ($r = $r0; $r -le $r1; $r++) {
    $cells = New-Object System.Collections.Generic.List[string]
    $any = $false
    for ($c = $c0; $c -le $c1; $c++) {
      $value = $vals.GetValue($r, $c)
      $text = ''
      if ($null -ne $value) { $text = [string]$value; if ($text -ne '') { $any = $true } }
      $cells.Add($text)
    }
    if ($any) { $lines.Add(($cells -join "`t")) }
  }
  return ($lines -join "`r`n")
}

function Get-SheetHtml($sheet, $title) {
  $used = $sheet.UsedRange
  $vals = $used.Value2
  $body = ''
  if ($null -eq $vals) {
    $body = '<p></p>'
  } elseif ($vals -isnot [Array]) {
    $body = '<p>' + ([System.Net.WebUtility]::HtmlEncode([string]$vals)) + '</p>'
  } elseif ($vals.Rank -lt 2) {
    $body = '<p>' + ([System.Net.WebUtility]::HtmlEncode((@($vals) -join ' '))) + '</p>'
  } else {
    $r0 = $vals.GetLowerBound(0)
    $r1 = [Math]::Min($vals.GetUpperBound(0), $r0 + 199)
    $c0 = $vals.GetLowerBound(1)
    $c1 = [Math]::Min($vals.GetUpperBound(1), $c0 + 19)
    $rows = ''
    for ($r = $r0; $r -le $r1; $r++) {
      $tds = ''
      $any = $false
      for ($c = $c0; $c -le $c1; $c++) {
        $value = $vals.GetValue($r, $c)
        $text = ''
        if ($null -ne $value) { $text = [string]$value; if ($text -ne '') { $any = $true } }
        $tds += '<td>' + ([System.Net.WebUtility]::HtmlEncode($text)) + '</td>'
      }
      if ($any) { $rows += '<tr>' + $tds + '</tr>' }
    }
    $body = '<table>' + $rows + '</table>'
  }
  $safeTitle = [System.Net.WebUtility]::HtmlEncode($title)
  return "<!DOCTYPE html><html><head><meta charset=""utf-8""><title>$safeTitle</title><style>body{font-family:Calibri,sans-serif;margin:32px}table{border-collapse:collapse}td{border:1px solid #ccc;padding:6px 10px}</style></head><body><h1>$safeTitle</h1>$body</body></html>"
}

function Get-PptPlainText($pres) {
  $builder = New-Object System.Text.StringBuilder
  $count = [Math]::Min([int]$pres.Slides.Count, 40)
  for ($i = 1; $i -le $count; $i++) {
    [void]$builder.AppendLine("Slide $i")
    $slide = $pres.Slides.Item($i)
    foreach ($shape in @($slide.Shapes)) {
      try {
        if ($shape.HasTextFrame -eq -1 -and $shape.TextFrame.HasText -eq -1) {
          [void]$builder.AppendLine([string]$shape.TextFrame.TextRange.Text)
        }
      } catch {}
    }
    [void]$builder.AppendLine()
  }
  return $builder.ToString()
}

function Save-WordAs($word, $doc, $target, $dest, [bool]$live) {
  if ($target -eq 'pdf') {
    $doc.ExportAsFixedFormat($dest, 17) | Out-Null
    return
  }
  if ($target -eq 'text') {
    Write-TextFile $dest ([string]$doc.Content.Text)
    return
  }
  $format = switch ($target) {
    'docx' { 16 }
    'txt' { 7 }
    'html' { 10 }
    'rtf' { 6 }
    default { throw "BAD_TARGET" }
  }
  if (-not $live) {
    $doc.SaveAs2($dest, $format) | Out-Null
    return
  }
  if ($target -eq 'docx') {
    try {
      $doc.SaveCopyAs($dest) | Out-Null
      if (Test-Path -LiteralPath $dest) { return }
    } catch {}
  }
  $previous = $null
  try { $previous = $word.ActiveDocument } catch {}
  $screen = $true
  try { $screen = $word.ScreenUpdating } catch {}
  try { $word.ScreenUpdating = $false } catch {}
  $created = $null
  try {
    $created = $word.Documents.Add([Type]::Missing, $false, 0, $false)
    $created.Content.FormattedText = $doc.Content.FormattedText
    $created.SaveAs2($dest, $format) | Out-Null
    $created.Close($false) | Out-Null
    $created = $null
  } finally {
    if ($created) { try { $created.Close($false) | Out-Null } catch {} }
    try { $word.ScreenUpdating = $screen } catch {}
    if ($previous) { try { $previous.Activate() | Out-Null } catch {} }
  }
}

function Convert-WordLive($target, $dest) {
  $word = Get-ActiveCom 'Word.Application'
  if (-not $word -or [int]$word.Documents.Count -lt 1) { throw 'WORD_NOT_OPEN' }
  $doc = $word.ActiveDocument
  $alerts = 0
  try { $alerts = $word.DisplayAlerts } catch {}
  try { $word.DisplayAlerts = 0 } catch {}
  try {
    Save-WordAs $word $doc $target $dest $true
  } finally {
    try { $word.DisplayAlerts = $alerts } catch {}
  }
}

function Convert-WordFile($filePath, $target, $dest) {
  $word = $null
  $doc = $null
  try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    try { $word.AutomationSecurity = 3 } catch {}
    $readOnly = ($target -eq 'pdf' -or $target -eq 'text')
    $doc = $word.Documents.Open($filePath, $false, $readOnly, $false)
    try { $word.Visible = $false } catch {}
    Save-WordAs $word $doc $target $dest $false
  } finally {
    if ($doc) { try { $doc.Close($false) | Out-Null } catch {} }
    if ($word) { try { $word.Quit() | Out-Null } catch {} }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
  }
}

function Convert-ExcelLive($target, $dest) {
  $excel = Get-ActiveCom 'Excel.Application'
  if (-not $excel -or [int]$excel.Workbooks.Count -lt 1) { throw 'EXCEL_NOT_OPEN' }
  $book = $excel.ActiveWorkbook
  $sheet = $excel.ActiveSheet
  $alerts = $excel.DisplayAlerts
  $excel.DisplayAlerts = $false
  try {
    switch ($target) {
      'pdf' { $book.ExportAsFixedFormat(0, $dest) | Out-Null }
      'text' { Write-TextFile $dest (Get-SheetText $sheet) }
      'txt' { Write-TextFile $dest (Get-SheetText $sheet) }
      'html' { Write-TextFile $dest (Get-SheetHtml $sheet ([string]$book.Name)) }
      default { throw 'NEED_TEXT' }
    }
  } finally {
    $excel.DisplayAlerts = $alerts
  }
}

function Convert-ExcelFile($filePath, $target, $dest) {
  $excel = $null
  $book = $null
  try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.ScreenUpdating = $false
    $book = $excel.Workbooks.Open($filePath, 0, $true)
    switch ($target) {
      'pdf' { $book.ExportAsFixedFormat(0, $dest) | Out-Null }
      'text' { Write-TextFile $dest (Get-SheetText $book.ActiveSheet) }
      'txt' { Write-TextFile $dest (Get-SheetText $book.ActiveSheet) }
      'html' { Write-TextFile $dest (Get-SheetHtml $book.ActiveSheet ([System.IO.Path]::GetFileName($filePath))) }
      default { throw 'NEED_TEXT' }
    }
  } finally {
    if ($book) { try { $book.Close($false) | Out-Null } catch {} }
    if ($excel) { try { $excel.Quit() | Out-Null } catch {} }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
  }
}

function Convert-PptLive($target, $dest) {
  $ppt = Get-ActiveCom 'PowerPoint.Application'
  if (-not $ppt -or [int]$ppt.Presentations.Count -lt 1) { throw 'PPT_NOT_OPEN' }
  $pres = $ppt.ActivePresentation
  switch ($target) {
    'pdf' { $pres.ExportAsFixedFormat($dest, 2) | Out-Null }
    'text' { Write-TextFile $dest (Get-PptPlainText $pres) }
    'txt' { Write-TextFile $dest (Get-PptPlainText $pres) }
    'html' {
      $safe = [System.Net.WebUtility]::HtmlEncode((Get-PptPlainText $pres))
      Write-TextFile $dest "<!DOCTYPE html><html><head><meta charset=""utf-8""></head><body><pre>$safe</pre></body></html>"
    }
    default { throw 'NEED_TEXT' }
  }
}

function Convert-PptFile($filePath, $target, $dest) {
  $ppt = $null
  $pres = $null
  try {
    $ppt = New-Object -ComObject PowerPoint.Application
    try { $ppt.Visible = $false } catch {}
    $pres = $ppt.Presentations.Open($filePath, $true, $false, $false)
    switch ($target) {
      'pdf' { $pres.ExportAsFixedFormat($dest, 2) | Out-Null }
      'text' { Write-TextFile $dest (Get-PptPlainText $pres) }
      'txt' { Write-TextFile $dest (Get-PptPlainText $pres) }
      'html' {
        $safe = [System.Net.WebUtility]::HtmlEncode((Get-PptPlainText $pres))
        Write-TextFile $dest "<!DOCTYPE html><html><head><meta charset=""utf-8""></head><body><pre>$safe</pre></body></html>"
      }
      default { throw 'NEED_TEXT' }
    }
  } finally {
    if ($pres) { try { $pres.Close() | Out-Null } catch {} }
    if ($ppt) { try { $ppt.Quit() | Out-Null } catch {} }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
  }
}

function Invoke-Convert {
  $kind = [string]$env:RODA_KIND
  $target = [string]$env:RODA_TARGET
  $dest = [string]$env:RODA_DEST
  $src = [string]$env:RODA_PATH
  $ext = ([string]$env:RODA_EXT).ToLower()
  Ensure-Parent $dest

  if ($kind -eq 'word-live') { Convert-WordLive $target $dest; return }
  if ($kind -eq 'excel-live') { Convert-ExcelLive $target $dest; return }
  if ($kind -eq 'ppt-live') { Convert-PptLive $target $dest; return }

  if ($ext -match '^\.(doc|docx|docm|rtf|odt|txt|html|htm|pdf)$') {
    Convert-WordFile $src $target $dest
    return
  }
  if ($ext -match '^\.(xls|xlsx|xlsm|csv)$') {
    Convert-ExcelFile $src $target $dest
    return
  }
  if ($ext -match '^\.(ppt|pptx|ppsx)$') {
    Convert-PptFile $src $target $dest
    return
  }
  throw 'NO_OFFICE'
}

if ($env:RODA_HOST -eq '1') {
  [Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
  [Console]::Out.WriteLine('{"ok":true,"ready":true}')
  [Console]::Out.Flush()
  while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    $line = $line.Trim()
    if ($line -eq '') { continue }
    if ($line -eq 'exit') { break }
    $script:HostId = 0
    try {
      $req = $line | ConvertFrom-Json
      $script:HostId = [int]$req.id
      if ($req.vars) {
        foreach ($p in $req.vars.PSObject.Properties) {
          Set-Item -Path "Env:$($p.Name)" -Value ([string]$p.Value)
        }
      }
      if ([string]$req.action -eq 'probe') {
        $payload = @{ id = $script:HostId; ok = $true; source = (Get-Probe) }
      } else {
        Invoke-Convert
        $dest = [string]$env:RODA_DEST
        if (-not (Test-Path -LiteralPath $dest)) { throw 'EMPTY_OUTPUT' }
        $payload = @{ id = $script:HostId; ok = $true; path = $dest }
      }
      [Console]::Out.WriteLine(($payload | ConvertTo-Json -Compress -Depth 6))
      [Console]::Out.Flush()
    } catch {
      $msg = $_.Exception.Message
      if ($_.Exception.InnerException) { $msg = $_.Exception.InnerException.Message }
      [Console]::Out.WriteLine((@{ id = $script:HostId; ok = $false; error = [string]$msg } | ConvertTo-Json -Compress))
      [Console]::Out.Flush()
    }
  }
  exit 0
}

if ($env:RODA_ACTION -eq 'probe') {
  Out-Json @{ ok = $true; source = (Get-Probe) }
} else {
  Invoke-Convert
  $dest = [string]$env:RODA_DEST
  if (-not (Test-Path -LiteralPath $dest)) { throw 'EMPTY_OUTPUT' }
  Out-Json @{ ok = $true; path = $dest }
}
exit 0
