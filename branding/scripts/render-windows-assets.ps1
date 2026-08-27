[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$brandingRoot = Split-Path -Parent $PSScriptRoot
$logoRoot = Join-Path $brandingRoot 'logo'
$source = Join-Path $logoRoot 'desky-app-icon-512.png'
$windowsRoot = Join-Path $logoRoot 'platform\windows'

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) { throw 'FFmpeg is required to render Windows assets.' }
if (-not (Get-Command ffprobe -ErrorAction SilentlyContinue)) { throw 'FFprobe is required to verify Windows assets.' }
if (-not (Test-Path -LiteralPath $source)) { throw "Missing official app icon source: $source" }

New-Item -ItemType Directory -Force -Path $windowsRoot | Out-Null

function Invoke-IconRender {
  param(
    [Parameter(Mandatory)] [string]$Output,
    [Parameter(Mandatory)] [string]$Filter
  )

  & ffmpeg -hide_banner -loglevel error -y -i $source -vf $Filter -frames:v 1 $Output
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $Output)) {
    throw "Windows asset render failed: $Output"
  }
}

Invoke-IconRender (Join-Path $windowsRoot 'icon.png') 'scale=50:50:flags=lanczos,format=rgba'
Invoke-IconRender (Join-Path $windowsRoot 'LockScreenLogo.scale-200.png') 'scale=48:48:flags=lanczos,format=rgba'
Invoke-IconRender (Join-Path $windowsRoot 'Square150x150Logo.png') 'scale=150:150:flags=lanczos,format=rgba'
Invoke-IconRender (Join-Path $windowsRoot 'Square150x150Logo.scale-200.png') 'scale=300:300:flags=lanczos,format=rgba'
Invoke-IconRender (Join-Path $windowsRoot 'Square44x44Logo.png') 'scale=44:44:flags=lanczos,format=rgba'
Invoke-IconRender (Join-Path $windowsRoot 'Square44x44Logo.scale-200.png') 'scale=88:88:flags=lanczos,format=rgba'
Invoke-IconRender (Join-Path $windowsRoot 'Square44x44Logo.targetsize-24_altform-unplated.png') 'scale=24:24:flags=lanczos,format=rgba'
Invoke-IconRender (Join-Path $windowsRoot 'Wide310x150Logo.scale-200.png') 'scale=220:220:flags=lanczos,pad=620:300:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba'
Invoke-IconRender (Join-Path $windowsRoot 'SplashScreen.scale-200.png') 'scale=300:300:flags=lanczos,pad=1240:600:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba'

& ffmpeg -hide_banner -loglevel error -y -i $source -vf 'scale=256:256:flags=lanczos' -frames:v 1 (Join-Path $windowsRoot 'desky.ico')
if ($LASTEXITCODE -ne 0) { throw 'Windows ICO render failed.' }

$expected = [ordered]@{
  'icon.png' = '50x50'
  'LockScreenLogo.scale-200.png' = '48x48'
  'SplashScreen.scale-200.png' = '1240x600'
  'Square150x150Logo.png' = '150x150'
  'Square150x150Logo.scale-200.png' = '300x300'
  'Square44x44Logo.png' = '44x44'
  'Square44x44Logo.scale-200.png' = '88x88'
  'Square44x44Logo.targetsize-24_altform-unplated.png' = '24x24'
  'Wide310x150Logo.scale-200.png' = '620x300'
}

foreach ($entry in $expected.GetEnumerator()) {
  $path = Join-Path $windowsRoot $entry.Key
  $dimensions = & ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 $path
  if ($LASTEXITCODE -ne 0 -or $dimensions.Trim() -ne $entry.Value) {
    throw "Unexpected dimensions for $($entry.Key): $dimensions"
  }
}

Get-FileHash -Algorithm SHA256 -LiteralPath (Get-ChildItem -LiteralPath $windowsRoot -File).FullName
