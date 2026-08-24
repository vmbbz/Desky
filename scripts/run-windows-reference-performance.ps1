param(
  [ValidateSet('idle', 'thinking')]
  [string]$State = 'idle',
  [int]$VisibleSamples = 60,
  [int]$HiddenSamples = 30,
  [int]$RecoveredSamples = 15,
  [string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$SeedProfile = (Join-Path (Split-Path -Parent $PSScriptRoot) 'artifacts\f4-7-adaptive-performance-profile')
)

$ErrorActionPreference = 'Stop'

foreach ($count in @($VisibleSamples, $HiddenSamples, $RecoveredSamples)) {
  if ($count -lt 1 -or $count -gt 300) {
    throw 'Each sample count must be between 1 and 300.'
  }
}

$packageExecutable = Join-Path $RepositoryRoot 'out\Desky-win32-x64\Desky.exe'
$seedCache = Join-Path $SeedProfile 'avatar-cache'
$seedDesktopState = Join-Path $SeedProfile 'desktop-state.json'
if (-not (Test-Path -LiteralPath $packageExecutable -PathType Leaf)) {
  throw "Packaged Desky executable is missing: $packageExecutable"
}
if (-not (Test-Path -LiteralPath $seedCache -PathType Container) -or -not (Test-Path -LiteralPath $seedDesktopState -PathType Leaf)) {
  throw "Verified seed profile is incomplete: $SeedProfile"
}

$runId = Get-Date -Format 'yyyyMMdd-HHmmss'
$artifactRoot = Join-Path $RepositoryRoot 'artifacts\reference-device'
$profileRoot = Join-Path $RepositoryRoot "out\reference-performance-$State-$runId"
$outputPath = Join-Path $artifactRoot "windows-performance-$State-$runId.png"
$jsonPath = "$outputPath.json"
New-Item -ItemType Directory -Force -Path $artifactRoot, $profileRoot | Out-Null
Copy-Item -LiteralPath $seedCache -Destination (Join-Path $profileRoot 'avatar-cache') -Recurse
Copy-Item -LiteralPath $seedDesktopState -Destination (Join-Path $profileRoot 'desktop-state.json')

$processStart = [System.Diagnostics.ProcessStartInfo]::new()
$processStart.FileName = $packageExecutable
$processStart.UseShellExecute = $false
$processStart.Environment['DESKY_VISUAL_TEST_PATH'] = $outputPath
$processStart.Environment['DESKY_VISUAL_TEST_EXERCISE'] = 'performance-lifecycle'
$processStart.Environment['DESKY_VISUAL_TEST_STATE'] = $State
$processStart.Environment['DESKY_VISUAL_TEST_MOTION_PREFERENCE'] = 'full'
$processStart.Environment['DESKY_VISUAL_TEST_USER_DATA'] = $profileRoot
$processStart.Environment['DESKY_VISUAL_TEST_DISABLE_NETWORK'] = '1'
$processStart.Environment['DESKY_PERFORMANCE_VISIBLE_SAMPLES'] = [string]$VisibleSamples
$processStart.Environment['DESKY_PERFORMANCE_HIDDEN_SAMPLES'] = [string]$HiddenSamples
$processStart.Environment['DESKY_PERFORMANCE_RECOVERED_SAMPLES'] = [string]$RecoveredSamples
$deskyProcess = [System.Diagnostics.Process]::Start($processStart)

$maximumWaitSeconds = $VisibleSamples + $HiddenSamples + $RecoveredSamples + 45
$complete = $false
for ($attempt = 0; $attempt -lt $maximumWaitSeconds * 4; $attempt += 1) {
  if (Test-Path -LiteralPath $jsonPath -PathType Leaf) {
    $complete = $true
    break
  }
  if ($deskyProcess.HasExited) {
    throw "Packaged Desky exited before performance diagnostics with code $($deskyProcess.ExitCode)."
  }
  Start-Sleep -Milliseconds 250
}
if (-not $complete) {
  $deskyProcess.CloseMainWindow() | Out-Null
  throw "Reference performance diagnostics did not complete within $maximumWaitSeconds seconds."
}

$diagnostic = Get-Content -LiteralPath $jsonPath -Raw | ConvertFrom-Json
if ($diagnostic.visualExerciseError) {
  throw "Reference performance exercise failed: $($diagnostic.visualExerciseError)"
}

[pscustomobject]@{
  diagnosticPath = $jsonPath
  state = $State
  avatarState = $diagnostic.avatarState
  documentFocused = $diagnostic.documentFocused
  renderTargetFps = $diagnostic.renderTargetFps
  performanceLifecycle = $diagnostic.performanceLifecycle
} | ConvertTo-Json -Depth 10
