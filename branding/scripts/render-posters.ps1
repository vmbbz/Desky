[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$brandingRoot = Split-Path -Parent $PSScriptRoot
$posterRoot = Join-Path $brandingRoot 'poster'
$fontPath = Join-Path $brandingRoot 'fonts\space-grotesk\SpaceGrotesk[wght].ttf'
$ffmpegFontPath = $fontPath.Replace('\', '/').Replace(':', '\:')

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
  throw 'FFmpeg is required to render the poster masters.'
}

if (-not (Test-Path -LiteralPath $fontPath)) {
  throw "Missing admitted display font: $fontPath"
}

function Render-Poster {
  param(
    [Parameter(Mandatory)] [string] $InputName,
    [Parameter(Mandatory)] [string] $OutputName,
    [Parameter(Mandatory)] [string] $Filter
  )

  $inputPath = Join-Path $posterRoot $InputName
  $outputPath = Join-Path $posterRoot $OutputName

  if (-not (Test-Path -LiteralPath $inputPath)) {
    throw "Missing poster background: $inputPath"
  }

  & ffmpeg -hide_banner -loglevel error -y -i $inputPath -vf $Filter -frames:v 1 $outputPath
  if ($LASTEXITCODE -ne 0) {
    throw "FFmpeg failed while rendering $OutputName"
  }
}

$throughScreenFilter = "drawtext=fontfile='$ffmpegFontPath':text='DESKY':fontcolor=0x0A0E17:fontsize=84:x=(w-text_w)/2:y=222,drawbox=x=(iw-64)/2:y=325:w=64:h=5:color=0x75E6D7:t=fill,drawtext=fontfile='$ffmpegFontPath':text='Give your agent somewhere to be.':fontcolor=0x111827:fontsize=31:x=(w-text_w)/2:y=358"
$schoolDeskFilter = "drawtext=fontfile='$ffmpegFontPath':text='DESKY':fontcolor=0x0A0E17:fontsize=104:x=142:y=310,drawbox=x=148:y=428:w=64:h=5:color=0x75E6D7:t=fill,drawtext=fontfile='$ffmpegFontPath':text='Give your agent somewhere to be.':fontcolor=0x111827:fontsize=34:x=148:y=465"
$firstSignalFilter = "drawtext=fontfile='$ffmpegFontPath':text='FIRST SIGNAL':fontcolor=0x75E6D7:fontsize=25:x=140:y=148,drawbox=x=140:y=194:w=54:h=5:color=0x75E6D7:t=fill,drawtext=fontfile='$ffmpegFontPath':text='DESKY':fontcolor=0xF5F8FF:fontsize=112:x=132:y=218,drawtext=fontfile='$ffmpegFontPath':text='Give your agent somewhere to be.':fontcolor=0xF5F8FF:fontsize=39:x=140:y=368"

Render-Poster -InputName 'desky-through-the-screen-background.png' -OutputName 'desky-through-the-screen-x.png' -Filter $throughScreenFilter
Render-Poster -InputName 'desky-school-desk-background.png' -OutputName 'desky-school-desk-x.png' -Filter $schoolDeskFilter
Render-Poster -InputName 'desky-first-signal-background.png' -OutputName 'desky-first-signal-x.png' -Filter $firstSignalFilter

Get-FileHash -Algorithm SHA256 -LiteralPath @(
  (Join-Path $posterRoot 'desky-through-the-screen-x.png'),
  (Join-Path $posterRoot 'desky-school-desk-x.png'),
  (Join-Path $posterRoot 'desky-first-signal-x.png')
)

