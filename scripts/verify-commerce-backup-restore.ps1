#requires -Version 7.5

[CmdletBinding()]
param(
  [string] $ServiceOrigin = 'https://desky-checkout-testnet.netlify.app',
  [string] $SecretPath = (Join-Path $env:LOCALAPPDATA 'Desky\commerce-pilot-secrets.dpapi'),
  [string] $ArchivePath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not [Uri]::IsWellFormedUriString($ServiceOrigin, [UriKind]::Absolute) `
  -or ([Uri] $ServiceOrigin).Scheme -ne 'https' `
  -or ([Uri] $ServiceOrigin).GetLeftPart([UriPartial]::Authority) -ne $ServiceOrigin) {
  throw 'The backup verifier requires an exact HTTPS service origin.'
}
if (-not (Test-Path -LiteralPath $SecretPath -PathType Leaf)) {
  throw 'The DPAPI-protected commerce operator state is unavailable.'
}

$temporary = if ($ArchivePath) {
  if (Test-Path -LiteralPath $ArchivePath) {
    throw 'The requested encrypted archive already exists; refusing to overwrite it.'
  }
  $archiveDirectory = Split-Path -Parent $ArchivePath
  if (-not (Test-Path -LiteralPath $archiveDirectory -PathType Container)) {
    $null = New-Item -ItemType Directory -Path $archiveDirectory
  }
  $ArchivePath
}
else {
  Join-Path ([IO.Path]::GetTempPath()) "desky-commerce-backup-$([Guid]::NewGuid().ToString('N')).bin"
}
$cipher = [IO.File]::ReadAllBytes($SecretPath)
[byte[]] $plain = [Security.Cryptography.ProtectedData]::Unprotect(
  $cipher,
  $null,
  [Security.Cryptography.DataProtectionScope]::CurrentUser
)
try {
  $secrets = [Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json -Depth 10 -DateKind String
  $response = Invoke-WebRequest `
    -Uri "$ServiceOrigin/v1/operations/backup" `
    -Method Get `
    -Headers @{ Accept = 'application/octet-stream'; Authorization = "Bearer $($secrets.operatorToken)" } `
    -MaximumRedirection 0 `
    -TimeoutSec 30 `
    -SkipHttpErrorCheck
  if ($response.StatusCode -ne 200) {
    throw "The encrypted commerce backup endpoint failed with status $($response.StatusCode)."
  }
  [byte[]] $bytes = if ($response.Content -is [byte[]]) {
    $response.Content
  }
  else {
    [Text.Encoding]::UTF8.GetBytes([string] $response.Content)
  }
  $archiveStream = [IO.File]::Open($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try { $archiveStream.Write($bytes, 0, $bytes.Length) } finally { $archiveStream.Dispose() }

  $repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
  $verifier = Join-Path $repositoryRoot 'services\commerce-hosted\scripts\run-commerce-backup-restore-drill.mjs'
  if (-not (Test-Path -LiteralPath $verifier -PathType Leaf)) {
    throw 'The commerce backup verifier entry point is unavailable.'
  }
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = 'node.exe'
  $start.WorkingDirectory = $repositoryRoot
  $start.UseShellExecute = $false
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $start.ArgumentList.Add($verifier)
  $start.ArgumentList.Add('--verify')
  $start.ArgumentList.Add($temporary)
  $start.Environment['DESKY_COMMERCE_BACKUP_KEY'] = [string] $secrets.backupKey
  $process = [Diagnostics.Process]::Start($start)
  if ($null -eq $process) { throw 'The isolated commerce restore process did not start.' }
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) {
    throw "The isolated commerce restore process failed: $($stderr.Trim())"
  }
  $evidence = ($stdout -split "`r?`n" | Where-Object { $_.StartsWith('{') } | Select-Object -Last 1)
  if (-not $evidence) { throw 'The isolated commerce restore process returned no evidence.' }
  $parsed = $evidence | ConvertFrom-Json -Depth 20 -DateKind String
  if ($parsed.restore -ne 'verified') { throw 'The isolated commerce restore was not verified.' }
  $evidence
}
finally {
  [Array]::Clear($plain, 0, $plain.Length)
  if (-not $ArchivePath -and (Test-Path -LiteralPath $temporary -PathType Leaf)) {
    Remove-Item -LiteralPath $temporary -Force
  }
}
