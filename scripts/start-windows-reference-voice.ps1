param(
  [ValidateRange(30, 180)]
  [int]$ObservationSeconds = 150,
  [switch]$CloseExisting,
  [string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'

$packageMetadata = Get-Content -LiteralPath (Join-Path $RepositoryRoot 'package.json') -Raw | ConvertFrom-Json
$packageExecutable = Join-Path $RepositoryRoot "out\$($packageMetadata.productName)-win32-x64\Desky.exe"
if (-not (Test-Path -LiteralPath $packageExecutable -PathType Leaf)) {
  throw "Packaged Deskiii executable is missing: $packageExecutable"
}
$resolvedExecutable = (Resolve-Path -LiteralPath $packageExecutable).Path

function Get-PackagedDeskiiiProcesses {
  @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and [string]::Equals(
      $_.ExecutablePath,
      $resolvedExecutable,
      [StringComparison]::OrdinalIgnoreCase
    )
  })
}

$existing = Get-PackagedDeskiiiProcesses
if ($existing.Count -gt 0 -and -not $CloseExisting) {
  $processIds = ($existing.ProcessId | Sort-Object) -join ', '
  throw "A packaged Deskiii process is already running ($processIds). Re-run with -CloseExisting to replace only that exact packaged process tree."
}
if ($existing.Count -gt 0) {
  $existingIds = @($existing.ProcessId)
  $mainProcesses = @($existing | Where-Object { $existingIds -notcontains $_.ParentProcessId })
  foreach ($candidate in $mainProcesses) {
    try {
      (Get-Process -Id $candidate.ProcessId -ErrorAction Stop).CloseMainWindow() | Out-Null
    }
    catch {
      # The exact executable-path check below remains the authority before force-closing.
    }
  }
  Start-Sleep -Milliseconds 750
  foreach ($candidate in (Get-PackagedDeskiiiProcesses)) {
    Stop-Process -Id $candidate.ProcessId -Force -ErrorAction Stop
  }
  $closeDeadline = [DateTimeOffset]::UtcNow.AddSeconds(10)
  while ((Get-PackagedDeskiiiProcesses).Count -gt 0 -and [DateTimeOffset]::UtcNow -lt $closeDeadline) {
    Start-Sleep -Milliseconds 100
  }
  if ((Get-PackagedDeskiiiProcesses).Count -gt 0) {
    throw 'The previous packaged Deskiii process did not close cleanly.'
  }
}

$runId = Get-Date -Format 'yyyyMMdd-HHmmss'
$artifactRoot = Join-Path $RepositoryRoot 'artifacts\reference-device'
$outputPath = Join-Path $artifactRoot "windows-voice-$runId.png"
$diagnosticPath = "$outputPath.json"
New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null

$exerciseEnvironment = @{
  DESKY_VISUAL_TEST_PATH = $outputPath
  DESKY_VISUAL_TEST_SURFACE = 'ambient'
  DESKY_VISUAL_TEST_EXERCISE = 'voice-observation'
  DESKY_VISUAL_TEST_STATE = 'composer'
  DESKY_VISUAL_TEST_WAIT_MS = [string]($ObservationSeconds * 1000)
  DESKY_VISUAL_TEST_MOTION_PREFERENCE = 'full'
}
# Start-Process gives the packaged GUI process independent standard handles.
# The previous ProcessStartInfo launch inherited this short-lived script's
# output pipe, so later Electron diagnostics could crash with EPIPE.
$deskiiiProcess = Start-Process `
  -FilePath $resolvedExecutable `
  -Environment $exerciseEnvironment `
  -PassThru

[pscustomobject]@{
  schemaVersion = 1
  launched = $true
  processId = $deskiiiProcess.Id
  observationSeconds = $ObservationSeconds
  capturePath = $outputPath
  diagnosticPath = $diagnosticPath
  expectedCompletionAt = [DateTimeOffset]::Now.AddSeconds($ObservationSeconds).ToString('o')
  privacy = 'Metadata only: event order, roles, lengths, byte counts, formats, and UI phases. No transcript text, audio content, token, or credential is written.'
  instructions = @(
    'Click the headset button to enter voice conversation mode.',
    'Say: Check your available skills and name three.',
    'After audible speech begins, speak naturally over it: Stop. Name only one skill.',
    'Leave the voice session open until Deskiii captures and closes automatically.'
  )
} | ConvertTo-Json -Depth 5
