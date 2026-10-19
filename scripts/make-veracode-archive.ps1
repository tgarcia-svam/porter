# Builds a clean Veracode static-scan archive from the working tree and verifies it
# contains the current logger/apiFetch fixes before you upload it.
# Usage: powershell -File scripts/make-veracode-archive.ps1 [-IncludeNodeModules]
param([switch]$IncludeNodeModules)
$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path "$PSScriptRoot\..")
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$exclude = @(
  '^\.claude/', '^coverage/', '^playwright-report/', '^test-results/', '^tests/',
  '/__tests__/', '^functions/upload-worker/dist/', '^functions/upload-worker/staging/',
  '^functions/upload-worker/function\.zip$', '\.tsbuildinfo$', '(^|/)\.env', '^porter_archive.*\.zip$',
  '^AGENTS\.md$', '^CLAUDE\.md$'
)
$files = git ls-files | Where-Object { $f = $_; -not ($exclude | Where-Object { $f -match $_ }) } |
  Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }

$hash = (git rev-parse --short HEAD).Trim()
$dirty = if (git status --porcelain --untracked-files=no) { "-wip" } else { "" }
$out = Join-Path (Get-Location) "porter_archive_$hash$dirty.zip"
if (Test-Path $out) { Remove-Item $out }

$zip = [System.IO.Compression.ZipFile]::Open($out, 'Create')
try {
  foreach ($f in $files) {
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Resolve-Path -LiteralPath $f).Path, $f.Replace([string][char]92, '/'))
  }
  if ($IncludeNodeModules -and (Test-Path node_modules)) {
    Get-ChildItem node_modules -Recurse -File | ForEach-Object {
      $rel = $_.FullName.Substring((Get-Location).Path.Length + 1).Replace([string][char]92, '/')
      [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel)
    }
  }
} finally { $zip.Dispose() }

# Verify the archive carries the current fixes
$z = [System.IO.Compression.ZipFile]::OpenRead($out)
try {
  function Read-Entry($name) {
    $e = $z.GetEntry($name); if (-not $e) { throw "missing $name in archive" }
    $r = New-Object System.IO.StreamReader($e.Open()); try { $r.ReadToEnd() } finally { $r.Dispose() }
  }
  if ((Read-Entry 'src/lib/logger.ts') -notmatch 'function emit\(') { throw "archive has a stale logger.ts" }
  if ((Read-Entry 'src/lib/apiFetch.ts') -notmatch 'API_PATH') { throw "archive has a stale apiFetch.ts" }
  $bad = $z.Entries | Where-Object { $_.FullName -match 'dist/|^coverage/|^\.claude/|__tests__' }
  if ($bad) { throw "archive still contains excluded paths: $($bad[0].FullName)" }
} finally { $z.Dispose() }

Write-Host "OK: $out ($($files.Count) source files, $([math]::Round((Get-Item $out).Length/1KB)) KB)"
