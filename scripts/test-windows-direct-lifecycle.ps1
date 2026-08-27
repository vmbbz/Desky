[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string]$InstallerPath,
  [Parameter(Mandatory)] [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
$output = [System.IO.Path]::GetFullPath($OutputPath)
$installRoot = Join-Path $env:LOCALAPPDATA 'desky_development'
$temporaryBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$temporary = Join-Path $temporaryBase ("desky-direct-lifecycle-" + [guid]::NewGuid().ToString('N'))
$userData = Join-Path $temporary 'user-data'
$installedByTest = $false
$startedProcess = $null

if (Test-Path -LiteralPath $installRoot) {
  throw "$installRoot already exists; refusing to modify a direct installation not created by this test."
}
if (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -eq 'Desky Development' }) {
  throw 'Desky Development is already registered for uninstall; refusing to modify it.'
}

New-Item -ItemType Directory -Path $temporary | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $output) | Out-Null

try {
  $install = Start-Process -FilePath $installer -ArgumentList '--silent' -PassThru -Wait -WindowStyle Hidden
  if ($install.ExitCode -ne 0) { throw "Squirrel installer exited with code $($install.ExitCode)." }
  $installedByTest = $true

  $executable = Get-ChildItem -LiteralPath $installRoot -Recurse -Filter 'Desky.exe' |
    Where-Object { $_.Directory.Name -like 'app-*' } |
    Sort-Object FullName -Descending |
    Select-Object -First 1
  if (-not $executable) { throw 'Installed direct executable was not found.' }

  $startedProcess = Start-Process -FilePath $executable.FullName -ArgumentList "--user-data-dir=$userData" -PassThru
  Start-Sleep -Seconds 5
  $startedProcess.Refresh()
  if ($startedProcess.HasExited) { throw 'Installed direct executable exited during the startup smoke interval.' }

  $result = [ordered]@{
    schemaVersion = 1
    verified = $true
    installRoot = $installRoot
    executable = $executable.FullName
    startupProcessId = $startedProcess.Id
    startupAliveAfterSeconds = 5
    installerSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $installer).Hash.ToLowerInvariant()
    updateFeedBound = Test-Path -LiteralPath (Join-Path (Split-Path -Parent $installer) 'RELEASES')
    uninstallVerified = $false
    note = 'Squirrel RELEASES and full update payload were structurally verified; an applied version-advance update remains a signed-channel gate.'
  }
} finally {
  if ($startedProcess -and -not $startedProcess.HasExited) {
    Stop-Process -Id $startedProcess.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
  }
  if ($installedByTest -and (Test-Path -LiteralPath (Join-Path $installRoot 'Update.exe'))) {
    $uninstall = Start-Process -FilePath (Join-Path $installRoot 'Update.exe') -ArgumentList '--uninstall', '--silent' -PassThru -Wait -WindowStyle Hidden
    if ($uninstall.ExitCode -ne 0) { throw "Squirrel uninstall exited with code $($uninstall.ExitCode)." }
    Start-Sleep -Seconds 5
  }
  if ($null -ne $result) {
    $uninstallEntryRemaining = @(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -eq 'Desky Development' }).Count
    $tombstone = Join-Path $installRoot '.dead'
    $result.squirrelTombstoneObserved = Test-Path -LiteralPath $tombstone
    if ((Test-Path -LiteralPath $installRoot) -and
        $result.squirrelTombstoneObserved -and
        $uninstallEntryRemaining -eq 0 -and
        @(Get-Process -Name 'Desky', 'Update' -ErrorAction SilentlyContinue).Count -eq 0) {
      $resolvedInstallRoot = [System.IO.Path]::GetFullPath($installRoot)
      $expectedInstallRoot = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'desky_development'))
      if ($resolvedInstallRoot -ne $expectedInstallRoot) {
        throw "Refusing cleanup outside the exact development install root: $resolvedInstallRoot"
      }
      Remove-Item -LiteralPath $resolvedInstallRoot -Recurse -Force
    }
    $result.uninstallVerified = $uninstallEntryRemaining -eq 0 -and -not (Test-Path -LiteralPath $installRoot)
  }
  $resolvedTemporary = [System.IO.Path]::GetFullPath($temporary)
  if ($resolvedTemporary.StartsWith($temporaryBase, [System.StringComparison]::OrdinalIgnoreCase) -and
      (Split-Path -Leaf $resolvedTemporary).StartsWith('desky-direct-lifecycle-')) {
    Remove-Item -LiteralPath $resolvedTemporary -Recurse -Force -ErrorAction SilentlyContinue
  }
}

if (-not $result.uninstallVerified) { throw 'Development direct uninstall verification failed.' }
$json = $result | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText($output, $json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
Write-Output $json
