[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidateSet('windows-store-free', 'windows-direct')]
  [string]$ProfileId,

  [Parameter(Mandatory)]
  [string]$ArtifactPath,

  [Parameter(Mandatory)]
  [ValidateSet('development', 'production')]
  [string]$ReleaseMode,

  [Parameter(Mandatory)]
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$artifact = (Resolve-Path -LiteralPath $ArtifactPath).Path
$output = [System.IO.Path]::GetFullPath($OutputPath)
$temporaryBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$temporary = Join-Path $temporaryBase ("desky-artifact-verification-" + [guid]::NewGuid().ToString('N'))
$asarVerifier = Join-Path $PSScriptRoot 'verify-release-artifact.mjs'
$externalRuntimeVerifier = Join-Path $PSScriptRoot 'verify-external-runtime-payload.mjs'

function Assert-Equal {
  param([object]$Actual, [object]$Expected, [string]$Label)
  if ($Actual -ne $Expected) { throw "$Label mismatch. Expected '$Expected'; received '$Actual'." }
}

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

function Invoke-AsarPolicy {
  param([string]$AsarPath)
  & node $asarVerifier $ProfileId $AsarPath
  if ($LASTEXITCODE -ne 0) { throw "ASAR release policy failed for $ProfileId." }
}

function Assert-NoBundledExternalAgentOrSpeechRuntime {
  param([string]$PackageRoot)

  $json = & node $externalRuntimeVerifier $PackageRoot
  if ($LASTEXITCODE -ne 0) { throw 'External agent/speech runtime payload policy failed.' }
  $report = $json | ConvertFrom-Json
  Assert-True ($report.verified -eq $true) 'External runtime payload verifier did not return a verified result.'
  return [int]$report.signaturesAbsent
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $output) | Out-Null
New-Item -ItemType Directory -Path $temporary | Out-Null

try {
  $signature = Get-AuthenticodeSignature -LiteralPath $artifact
  $details = [ordered]@{
    schemaVersion = 1
    verified = $true
    profileId = $ProfileId
    releaseMode = $ReleaseMode
    artifact = $artifact
    artifactBytes = (Get-Item -LiteralPath $artifact).Length
    artifactSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $artifact).Hash.ToLowerInvariant()
    signatureStatus = [string]$signature.Status
    signerSubject = $signature.SignerCertificate.Subject
  }

  if ($ProfileId -eq 'windows-store-free') {
    $makeAppx = Get-ChildItem -LiteralPath "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Recurse -Filter 'makeappx.exe' |
      Where-Object { $_.DirectoryName -like '*\x64' } |
      Sort-Object FullName -Descending |
      Select-Object -First 1
    if (-not $makeAppx) { throw 'Windows SDK MakeAppx.exe was not found.' }

    & $makeAppx.FullName unpack /p $artifact /d $temporary /o | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'MSIX extraction failed.' }

    [xml]$manifest = Get-Content -Raw -LiteralPath (Join-Path $temporary 'AppxManifest.xml')
    $identity = $manifest.Package.Identity
    $application = $manifest.Package.Applications.Application
    $targetFamily = $manifest.Package.Dependencies.TargetDeviceFamily
    $expectedIdentity = if ($ReleaseMode -eq 'development') { 'Desky.Companion.Development' } else { $env:DESKY_STORE_PACKAGE_IDENTITY }
    $expectedPublisher = if ($ReleaseMode -eq 'development') { 'CN=Desky Development' } else { $env:DESKY_STORE_PUBLISHER }

    Assert-True (-not [string]::IsNullOrWhiteSpace($expectedIdentity)) 'The production Store identity is unavailable to the verifier.'
    Assert-True (-not [string]::IsNullOrWhiteSpace($expectedPublisher)) 'The production Store publisher is unavailable to the verifier.'
    Assert-Equal $identity.Name $expectedIdentity 'MSIX identity'
    Assert-Equal $identity.Publisher $expectedPublisher 'MSIX publisher'
    Assert-Equal $identity.ProcessorArchitecture 'x64' 'MSIX architecture'
    Assert-Equal $targetFamily.Name 'Windows.Desktop' 'MSIX target device family'
    Assert-Equal $application.Executable 'app\Desky.exe' 'MSIX executable'

    $sourceAssets = Join-Path $repositoryRoot 'branding\logo\platform\windows'
    foreach ($assetName in @(
      'icon.png',
      'LockScreenLogo.scale-200.png',
      'SplashScreen.scale-200.png',
      'Square150x150Logo.png',
      'Square150x150Logo.scale-200.png',
      'Square44x44Logo.png',
      'Square44x44Logo.scale-200.png',
      'Square44x44Logo.targetsize-24_altform-unplated.png',
      'Wide310x150Logo.scale-200.png'
    )) {
      $sourceAsset = Join-Path $sourceAssets $assetName
      $packageAsset = Join-Path $temporary "assets\$assetName"
      Assert-True (Test-Path -LiteralPath $packageAsset) "MSIX is missing official asset $assetName."
      Assert-Equal (Get-FileHash -Algorithm SHA256 -LiteralPath $packageAsset).Hash (Get-FileHash -Algorithm SHA256 -LiteralPath $sourceAsset).Hash "MSIX asset $assetName"
    }

    Invoke-AsarPolicy (Join-Path $temporary 'app\resources\app.asar')
    $details.externalRuntimePayloadSignaturesAbsent = Assert-NoBundledExternalAgentOrSpeechRuntime (Join-Path $temporary 'app')

    if ($ReleaseMode -eq 'development') {
      Assert-Equal $signature.SignerCertificate.Subject 'CN=Desky Development' 'Development MSIX signer'
      Assert-True ($signature.Status -in @('Valid', 'UnknownError')) 'Development MSIX is unsigned or has an invalid payload signature.'
      $details.signingStage = 'development-self-signed-untrusted-root'
    } else {
      Assert-Equal $signature.Status 'NotSigned' 'Pre-Partner-Center Store package signature state'
      $details.signingStage = 'partner-center-pending'
    }

    $details.packageIdentity = [string]$identity.Name
    $details.publisher = [string]$identity.Publisher
    $details.packageVersion = [string]$identity.Version
    $details.targetDeviceFamily = [string]$targetFamily.Name
    $details.officialAssetsVerified = 9
  } else {
    $packageDirectory = Split-Path -Parent $artifact
    $nupkg = Get-ChildItem -LiteralPath $packageDirectory -Filter '*-full.nupkg' | Select-Object -First 1
    $releasesFile = Join-Path $packageDirectory 'RELEASES'
    Assert-True ($null -ne $nupkg) 'Direct installer is missing the full Squirrel update package.'
    Assert-True (Test-Path -LiteralPath $releasesFile) 'Direct installer is missing the Squirrel RELEASES manifest.'

    $zipPath = Join-Path $temporary 'package.zip'
    Copy-Item -LiteralPath $nupkg.FullName -Destination $zipPath
    Expand-Archive -LiteralPath $zipPath -DestinationPath (Join-Path $temporary 'nupkg')
    $asar = Get-ChildItem -LiteralPath (Join-Path $temporary 'nupkg') -Recurse -Filter 'app.asar' | Select-Object -First 1
    $packagedExecutable = Get-ChildItem -LiteralPath (Join-Path $temporary 'nupkg') -Recurse -Filter 'Desky.exe' |
      Where-Object { $_.FullName -match '[\\/]lib[\\/]net[^\\/]+[\\/]' } |
      Select-Object -First 1
    Assert-True ($null -ne $asar) 'Direct update package is missing app.asar.'
    Assert-True ($null -ne $packagedExecutable) 'Direct update package is missing Desky.exe.'
    Invoke-AsarPolicy $asar.FullName
    $details.externalRuntimePayloadSignaturesAbsent = Assert-NoBundledExternalAgentOrSpeechRuntime (Join-Path $temporary 'nupkg')
    $applicationSignature = Get-AuthenticodeSignature -LiteralPath $packagedExecutable.FullName

    $releases = Get-Content -Raw -LiteralPath $releasesFile
    Assert-True ($releases.Contains($nupkg.Name)) 'Squirrel RELEASES does not bind the full update package.'
    Assert-True ($releases.Contains([string]$nupkg.Length)) 'Squirrel RELEASES does not bind the update package byte size.'

    if ($ReleaseMode -eq 'development') {
      Assert-Equal $signature.Status 'NotSigned' 'Development direct installer signature state'
      Assert-Equal $applicationSignature.Status 'NotSigned' 'Development direct application signature state'
      $details.signingStage = 'development-unsigned'
    } else {
      Assert-Equal $signature.Status 'Valid' 'Production direct installer signature'
      Assert-True ($null -ne $signature.SignerCertificate) 'Production direct installer has no Authenticode signer.'
      Assert-Equal $applicationSignature.Status 'Valid' 'Production direct application signature'
      Assert-True ($null -ne $applicationSignature.SignerCertificate) 'Production direct application has no Authenticode signer.'
      Assert-Equal $applicationSignature.SignerCertificate.Thumbprint $signature.SignerCertificate.Thumbprint 'Direct installer/application signer'
      $details.signingStage = 'authenticode-valid'
    }

    $details.updatePackage = $nupkg.FullName
    $details.updatePackageBytes = $nupkg.Length
    $details.updatePackageSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $nupkg.FullName).Hash.ToLowerInvariant()
    $details.applicationExecutable = [System.IO.Path]::GetRelativePath((Join-Path $temporary 'nupkg'), $packagedExecutable.FullName).Replace('\\', '/')
    $details.applicationSignatureStatus = [string]$applicationSignature.Status
    $details.applicationSignerSubject = $applicationSignature.SignerCertificate.Subject
    $details.releasesManifest = $releasesFile
  }

  $json = $details | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText($output, $json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
  Write-Output $json
} finally {
  $resolvedTemporary = [System.IO.Path]::GetFullPath($temporary)
  if ($resolvedTemporary.StartsWith($temporaryBase, [System.StringComparison]::OrdinalIgnoreCase) -and
      (Split-Path -Leaf $resolvedTemporary).StartsWith('desky-artifact-verification-')) {
    Remove-Item -LiteralPath $resolvedTemporary -Recurse -Force -ErrorAction SilentlyContinue
  }
}
