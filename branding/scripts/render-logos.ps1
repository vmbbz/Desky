[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$brandingRoot = Split-Path -Parent $PSScriptRoot
$logoRoot = Join-Path $brandingRoot 'logo'
$rasterRoot = Join-Path $logoRoot 'raster'
$appIconSource = Join-Path $logoRoot 'desky-app-icon.svg'
$traySource = Join-Path $logoRoot 'desky-tray-glyph.svg'

$edgeCandidates = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$edge = $edgeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $edge) { throw 'Microsoft Edge is required for deterministic SVG rasterization on Windows.' }
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) { throw 'FFmpeg is required to render icon sizes.' }
if (-not (Test-Path -LiteralPath $appIconSource)) { throw "Missing app icon source: $appIconSource" }
if (-not (Test-Path -LiteralPath $traySource)) { throw "Missing tray glyph source: $traySource" }

New-Item -ItemType Directory -Force -Path $rasterRoot | Out-Null

$appIcon512 = Join-Path $logoRoot 'desky-app-icon-512.png'
$appIconUri = [System.Uri]::new($appIconSource).AbsoluteUri
& $edge --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 --window-size=512,512 "--screenshot=$appIcon512" $appIconUri 2>$null | Out-Null
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $appIcon512)) { throw 'App icon rasterization failed.' }

foreach ($size in 256, 128, 64, 48, 32, 16) {
  $output = Join-Path $rasterRoot "desky-app-icon-$size.png"
  & ffmpeg -hide_banner -loglevel error -y -i $appIcon512 -vf "scale=$size`:$size`:flags=lanczos" -frames:v 1 $output
  if ($LASTEXITCODE -ne 0) { throw "App icon $size px render failed." }
}

$tray64 = Join-Path $rasterRoot 'desky-tray-template-64.png'
$tray32 = Join-Path $rasterRoot 'desky-tray-template-32.png'
$trayUri = [System.Uri]::new($traySource).AbsoluteUri
& $edge --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --default-background-color=00000000 --window-size=64,64 "--screenshot=$tray64" $trayUri 2>$null | Out-Null
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $tray64)) { throw 'Tray glyph rasterization failed.' }
& ffmpeg -hide_banner -loglevel error -y -i $tray64 -vf 'scale=32:32:flags=lanczos' -frames:v 1 $tray32
if ($LASTEXITCODE -ne 0) { throw 'Tray glyph 32 px render failed.' }

Get-FileHash -Algorithm SHA256 -LiteralPath @(
  $appIcon512,
  (Join-Path $rasterRoot 'desky-app-icon-48.png'),
  (Join-Path $rasterRoot 'desky-app-icon-32.png'),
  (Join-Path $rasterRoot 'desky-app-icon-16.png'),
  $tray32
)
