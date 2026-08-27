[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string]$PackagePath,
  [Parameter(Mandatory)] [string]$ReportPath
)

$ErrorActionPreference = 'Stop'
$package = (Resolve-Path -LiteralPath $PackagePath).Path
$report = [System.IO.Path]::GetFullPath($ReportPath)
$appCert = "${env:ProgramFiles(x86)}\Windows Kits\10\App Certification Kit\appcert.exe"
$trustedPeopleAdded = $false
$signerThumbprint = $null
$testExitCode = $null

if (-not (Test-Path -LiteralPath $appCert)) {
  throw 'Windows App Certification Kit is not installed.'
}
if ([System.IO.Path]::GetExtension($package) -ne '.msix') {
  throw 'Windows App Certification Kit package-path testing requires an MSIX package.'
}

$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Windows App Certification Kit must run in an elevated active user session.'
}

$signature = Get-AuthenticodeSignature -LiteralPath $package
if (-not $signature.SignerCertificate) {
  throw 'The MSIX has no signer certificate.'
}
$signerThumbprint = $signature.SignerCertificate.Thumbprint
$developmentSigner = $signature.SignerCertificate.Subject -eq 'CN=Desky Development'
if ($developmentSigner -and -not (Test-Path -LiteralPath "Cert:\LocalMachine\TrustedPeople\$signerThumbprint")) {
  $certificatePath = Join-Path ([System.IO.Path]::GetTempPath()) "desky-wack-$signerThumbprint.cer"
  try {
    Export-Certificate -Cert $signature.SignerCertificate -FilePath $certificatePath | Out-Null
    Import-Certificate -FilePath $certificatePath -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null
    $trustedPeopleAdded = $true
  } finally {
    Remove-Item -LiteralPath $certificatePath -Force -ErrorAction SilentlyContinue
  }
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $report) | Out-Null
Remove-Item -LiteralPath $report -Force -ErrorAction SilentlyContinue

try {
  & $appCert reset
  if ($LASTEXITCODE -ne 0) { throw "Windows App Certification Kit reset failed with exit code $LASTEXITCODE." }

  & $appCert test -appxpackagepath $package -reportoutputpath $report
  $testExitCode = $LASTEXITCODE
  if (-not (Test-Path -LiteralPath $report)) {
    throw "Windows App Certification Kit produced no report (exit code $testExitCode)."
  }
} finally {
  if ($trustedPeopleAdded) {
    $certificate = Get-ChildItem Cert:\LocalMachine\TrustedPeople |
      Where-Object Thumbprint -eq $signerThumbprint
    if ($certificate -and $certificate.Subject -eq 'CN=Desky Development') {
      Remove-Item -LiteralPath "Cert:\LocalMachine\TrustedPeople\$signerThumbprint" -DeleteKey -ErrorAction SilentlyContinue
    }
  }
  if ($developmentSigner) {
    $privateCertificate = Get-ChildItem Cert:\CurrentUser\My |
      Where-Object Thumbprint -eq $signerThumbprint
    if ($privateCertificate -and $privateCertificate.Subject -eq 'CN=Desky Development' -and
        $privateCertificate.FriendlyName -in @(
          'ELECTRON WINDOWS MSIX Dev Cert (CN=Desky Development)',
          'ELECTRON WINDOWS MSIX Dev Cert ($subjectName)'
        )) {
      Remove-Item -LiteralPath "Cert:\CurrentUser\My\$signerThumbprint" -DeleteKey -ErrorAction SilentlyContinue
    }
  }
}

[xml]$reportXml = Get-Content -LiteralPath $report -Raw
$overallResult = [string]$reportXml.REPORT.OVERALL_RESULT
$failedTests = @($reportXml.SelectNodes('//TEST[RESULT="FAIL"]') | ForEach-Object {
  [ordered]@{
    index = [int]$_.INDEX
    name = [string]$_.NAME
    optional = [string]$_.OPTIONAL -eq 'TRUE'
    messages = @($_.MESSAGES.MESSAGE | ForEach-Object { [string]$_.TEXT })
  }
})
$result = [ordered]@{
  schemaVersion = 1
  package = $package
  packageSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $package).Hash.ToLowerInvariant()
  report = $report
  appCertExitCode = $testExitCode
  overallResult = $overallResult
  failedTestCount = $failedTests.Count
  requiredFailedTestCount = @($failedTests | Where-Object { -not $_.optional }).Count
  failedTests = $failedTests
  developmentSigner = $developmentSigner
  signerThumbprint = $signerThumbprint
  temporaryTrustRemoved = -not (Test-Path -LiteralPath "Cert:\LocalMachine\TrustedPeople\$signerThumbprint")
  developmentPrivateKeyRemoved = -not (Test-Path -LiteralPath "Cert:\CurrentUser\My\$signerThumbprint")
}
$summaryPath = [System.IO.Path]::ChangeExtension($report, '.summary.json')
[System.IO.File]::WriteAllText(
  $summaryPath,
  (($result | ConvertTo-Json -Depth 4) + [Environment]::NewLine),
  [System.Text.UTF8Encoding]::new($false)
)
$result | ConvertTo-Json -Depth 4

if ($testExitCode -ne 0 -or $overallResult -ne 'PASS' -or $result.requiredFailedTestCount -ne 0) {
  throw "Windows App Certification Kit did not pass. Review $report."
}
