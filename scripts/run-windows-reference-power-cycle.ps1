param(
  [int]$WakeAfterMinutes = 2,
  [string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$SeedProfile = (Join-Path (Split-Path -Parent $PSScriptRoot) 'artifacts\f4-7-adaptive-performance-profile')
)

$ErrorActionPreference = 'Stop'

if ($WakeAfterMinutes -lt 1 -or $WakeAfterMinutes -gt 10) {
  throw 'WakeAfterMinutes must be between 1 and 10.'
}

$packageExecutable = Join-Path $RepositoryRoot 'out\Desky-win32-x64\Desky.exe'
if (-not (Test-Path -LiteralPath $packageExecutable -PathType Leaf)) {
  throw "Packaged Desky executable is missing: $packageExecutable"
}

$runId = Get-Date -Format 'yyyyMMdd-HHmmss'
$artifactRoot = Join-Path $RepositoryRoot 'artifacts\reference-device'
$profileRoot = Join-Path $RepositoryRoot "out\reference-device-profile-$runId"
$outputPath = Join-Path $artifactRoot "windows-real-power-lifecycle-$runId.png"
$readyPath = "$outputPath.ready.json"
$jsonPath = "$outputPath.json"
$taskName = "DeskyReferenceWake-$runId"

New-Item -ItemType Directory -Force -Path $artifactRoot, $profileRoot | Out-Null
$seedCache = Join-Path $SeedProfile 'avatar-cache'
$seedDesktopState = Join-Path $SeedProfile 'desktop-state.json'
if (-not (Test-Path -LiteralPath $seedCache -PathType Container) -or -not (Test-Path -LiteralPath $seedDesktopState -PathType Leaf)) {
  throw "Verified seed profile is incomplete: $SeedProfile"
}
Copy-Item -LiteralPath $seedCache -Destination (Join-Path $profileRoot 'avatar-cache') -Recurse
Copy-Item -LiteralPath $seedDesktopState -Destination (Join-Path $profileRoot 'desktop-state.json')

function Get-AcWakeTimerIndex {
  $query = powercfg /query SCHEME_CURRENT SUB_SLEEP RTCWAKE | Out-String
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not read the active Windows wake-timer policy.'
  }
  $match = [regex]::Match($query, 'Current AC Power Setting Index:\s+0x([0-9a-fA-F]+)')
  if (-not $match.Success) {
    throw 'Could not parse the active AC wake-timer policy.'
  }
  return [Convert]::ToInt32($match.Groups[1].Value, 16)
}

function Set-AcWakeTimerIndex([int]$Index) {
  powercfg /setacvalueindex SCHEME_CURRENT SUB_SLEEP RTCWAKE $Index | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Windows rejected AC wake-timer setting $Index."
  }
  powercfg /setactive SCHEME_CURRENT | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw 'Windows could not reactivate the current power scheme.'
  }
}

$originalWakeTimerIndex = Get-AcWakeTimerIndex
$wakeSettingChanged = $false
$registeredTask = $null
$deskyProcess = $null
$service = New-Object -ComObject 'Schedule.Service'
$service.Connect()
$taskRoot = $service.GetFolder('\')

try {
  $processStart = [System.Diagnostics.ProcessStartInfo]::new()
  $processStart.FileName = $packageExecutable
  $processStart.UseShellExecute = $false
  $processStart.Environment['DESKY_VISUAL_TEST_PATH'] = $outputPath
  $processStart.Environment['DESKY_VISUAL_TEST_EXERCISE'] = 'real-power-lifecycle'
  $processStart.Environment['DESKY_VISUAL_TEST_STATE'] = 'idle'
  $processStart.Environment['DESKY_VISUAL_TEST_MOTION_PREFERENCE'] = 'full'
  $processStart.Environment['DESKY_VISUAL_TEST_USER_DATA'] = $profileRoot
  $processStart.Environment['DESKY_VISUAL_TEST_DISABLE_NETWORK'] = '1'
  $deskyProcess = [System.Diagnostics.Process]::Start($processStart)

  $ready = $false
  for ($attempt = 0; $attempt -lt 120; $attempt += 1) {
    if (Test-Path -LiteralPath $readyPath -PathType Leaf) {
      $ready = $true
      break
    }
    if ($deskyProcess.HasExited) {
      throw "Packaged Desky exited before lifecycle readiness with code $($deskyProcess.ExitCode)."
    }
    Start-Sleep -Milliseconds 250
  }
  if (-not $ready) {
    throw 'Packaged Desky did not publish lifecycle readiness within 30 seconds.'
  }

  $task = $service.NewTask(0)
  $task.RegistrationInfo.Description = 'Temporary one-shot wake for Desky reference lifecycle verification'
  $task.Settings.Enabled = $true
  $task.Settings.WakeToRun = $true
  $task.Settings.StartWhenAvailable = $true
  $task.Settings.DisallowStartIfOnBatteries = $false
  $task.Settings.StopIfGoingOnBatteries = $false
  $trigger = $task.Triggers.Create(1)
  $trigger.StartBoundary = (Get-Date).AddMinutes($WakeAfterMinutes).ToString('s')
  $trigger.Enabled = $true
  $action = $task.Actions.Create(0)
  $action.Path = "$env:SystemRoot\System32\cmd.exe"
  $action.Arguments = '/c exit 0'
  $registeredTask = $taskRoot.RegisterTaskDefinition($taskName, $task, 6, $null, $null, 3, $null)
  if ($registeredTask.Xml -notmatch '<WakeToRun>true</WakeToRun>') {
    throw 'The temporary scheduled task did not retain WakeToRun=true.'
  }

  if ($originalWakeTimerIndex -ne 1) {
    Set-AcWakeTimerIndex 1
    $wakeSettingChanged = $true
  }
  if ((Get-AcWakeTimerIndex) -ne 1) {
    throw 'AC wake timers were not enabled, so the machine will not be suspended.'
  }

  Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class DeskyReferencePower {
  [DllImport("powrprof.dll", SetLastError = true)]
  public static extern bool SetSuspendState(bool hibernate, bool forceCritical, bool disableWakeEvent);
}
'@

  $suspendReturned = [DeskyReferencePower]::SetSuspendState($false, $false, $false)
  if (-not $suspendReturned) {
    $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    throw "SetSuspendState failed with Win32 error $code."
  }

  $complete = $false
  for ($attempt = 0; $attempt -lt 480; $attempt += 1) {
    if (Test-Path -LiteralPath $jsonPath -PathType Leaf) {
      $complete = $true
      break
    }
    if ($deskyProcess.HasExited) {
      throw "Packaged Desky exited after resume without diagnostics, code $($deskyProcess.ExitCode)."
    }
    Start-Sleep -Milliseconds 250
  }
  if (-not $complete) {
    throw 'Real power lifecycle diagnostics did not complete within two minutes after resume.'
  }

  [pscustomobject]@{
    diagnosticPath = $jsonPath
    lifecycle = (Get-Content -LiteralPath $jsonPath -Raw | ConvertFrom-Json).realPowerLifecycle
    originalAcWakeTimerIndex = $originalWakeTimerIndex
    temporaryWakeTask = $taskName
  } | ConvertTo-Json -Depth 8
}
finally {
  if ($registeredTask) {
    try {
      $taskRoot.DeleteTask($taskName, 0)
    }
    catch {
      Write-Warning "Could not delete temporary wake task $taskName`: $($_.Exception.Message)"
    }
  }
  if ($deskyProcess -and -not $deskyProcess.HasExited) {
    $deskyProcess.CloseMainWindow() | Out-Null
  }
  if ($wakeSettingChanged) {
    Set-AcWakeTimerIndex $originalWakeTimerIndex
  }
}
