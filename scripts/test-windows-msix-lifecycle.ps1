[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string]$InstallPackagePath,
  [Parameter(Mandatory)] [string]$UpdatePackagePath,
  [Parameter(Mandatory)] [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$identityName = 'Desky.Companion.Development'
$installPackage = (Resolve-Path -LiteralPath $InstallPackagePath).Path
$updatePackage = (Resolve-Path -LiteralPath $UpdatePackagePath).Path
$output = [System.IO.Path]::GetFullPath($OutputPath)
$temporaryBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$temporary = Join-Path $temporaryBase ("desky-msix-lifecycle-" + [guid]::NewGuid().ToString('N'))
$installedByTest = $false
$startedProcess = $null
$machineTrustedPeopleAdded = @()
$developmentSignerThumbprints = @()

function Get-DeskyPackage {
  Get-AppxPackage -Name $identityName -ErrorAction SilentlyContinue | Select-Object -First 1
}

New-Item -ItemType Directory -Path $temporary | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $output) | Out-Null

try {
  $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'The self-signed MSIX lifecycle test must run elevated to use LocalMachine TrustedPeople.'
  }
  if (Get-DeskyPackage) {
    throw "$identityName is already installed; refusing to modify a package not installed by this test."
  }

  foreach ($candidate in @($installPackage, $updatePackage)) {
    $signature = Get-AuthenticodeSignature -LiteralPath $candidate
    if (-not $signature.SignerCertificate -or $signature.SignerCertificate.Subject -ne 'CN=Desky Development') {
      throw "$candidate is not signed by the isolated Desky development identity."
    }
    $thumbprint = $signature.SignerCertificate.Thumbprint
    $developmentSignerThumbprints += $thumbprint
    $certificatePath = Join-Path $temporary "$thumbprint.cer"
    Export-Certificate -Cert $signature.SignerCertificate -FilePath $certificatePath | Out-Null
    if (-not (Test-Path -LiteralPath "Cert:\LocalMachine\TrustedPeople\$thumbprint")) {
      Import-Certificate -FilePath $certificatePath -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null
      $machineTrustedPeopleAdded += $thumbprint
    }
  }

  Add-AppxPackage -Path $installPackage
  $installedByTest = $true
  $installed = Get-DeskyPackage
  if (-not $installed) { throw 'Development MSIX did not appear after installation.' }
  $installVersion = [version]$installed.Version

  Add-AppxPackage -Path $updatePackage
  $updated = Get-DeskyPackage
  if (-not $updated) { throw 'Development MSIX disappeared during update.' }
  $updateVersion = [version]$updated.Version
  if ($updateVersion -le $installVersion) {
    throw "MSIX update did not advance the version ($installVersion -> $updateVersion)."
  }

  $processesBefore = @(Get-Process -Name 'Desky' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
  & explorer.exe "shell:AppsFolder\$($updated.PackageFamilyName)!App"
  $deadline = (Get-Date).AddSeconds(15)
  do {
    Start-Sleep -Milliseconds 500
    $startedProcess = Get-Process -Name 'Desky' -ErrorAction SilentlyContinue |
      Where-Object { $_.Id -notin $processesBefore } |
      Select-Object -First 1
  } while (-not $startedProcess -and (Get-Date) -lt $deadline)
  if (-not $startedProcess) { throw 'Updated MSIX did not stay alive for the startup smoke interval.' }
  Start-Sleep -Seconds 4
  $startedProcess.Refresh()
  if ($startedProcess.HasExited) { throw 'Updated MSIX exited during the startup smoke interval.' }

  $result = [ordered]@{
    schemaVersion = 1
    verified = $true
    identity = $identityName
    installVersion = [string]$installVersion
    updateVersion = [string]$updateVersion
    startupProcessId = $startedProcess.Id
    startupAliveAfterSeconds = 4
    installSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $installPackage).Hash.ToLowerInvariant()
    updateSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $updatePackage).Hash.ToLowerInvariant()
    uninstallVerified = $false
    developmentSignerThumbprints = @($developmentSignerThumbprints | Select-Object -Unique)
  }
} finally {
  if ($startedProcess -and -not $startedProcess.HasExited) {
    Stop-Process -Id $startedProcess.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
  }
  if ($installedByTest) {
    $package = Get-DeskyPackage
    if ($package) { Remove-AppxPackage -Package $package.PackageFullName }
  }
  $packageAfter = Get-DeskyPackage
  if ($null -ne $result) { $result.uninstallVerified = $null -eq $packageAfter }
  foreach ($thumbprint in ($machineTrustedPeopleAdded | Select-Object -Unique)) {
    $trustedCertificate = Get-ChildItem Cert:\LocalMachine\TrustedPeople | Where-Object Thumbprint -eq $thumbprint
    if ($trustedCertificate -and $trustedCertificate.Subject -eq 'CN=Desky Development') {
      Remove-Item -LiteralPath "Cert:\LocalMachine\TrustedPeople\$thumbprint" -DeleteKey -ErrorAction SilentlyContinue
    }
  }
  foreach ($thumbprint in ($developmentSignerThumbprints | Select-Object -Unique)) {
    $privateCertificate = Get-ChildItem Cert:\CurrentUser\My | Where-Object Thumbprint -eq $thumbprint
    if ($privateCertificate -and
        $privateCertificate.Subject -eq 'CN=Desky Development' -and
        $privateCertificate.FriendlyName -in @(
          'ELECTRON WINDOWS MSIX Dev Cert (CN=Desky Development)',
          'ELECTRON WINDOWS MSIX Dev Cert ($subjectName)'
        )) {
      Remove-Item -LiteralPath "Cert:\CurrentUser\My\$thumbprint" -DeleteKey -ErrorAction SilentlyContinue
    }
  }
  $resolvedTemporary = [System.IO.Path]::GetFullPath($temporary)
  if ($resolvedTemporary.StartsWith($temporaryBase, [System.StringComparison]::OrdinalIgnoreCase) -and
      (Split-Path -Leaf $resolvedTemporary).StartsWith('desky-msix-lifecycle-')) {
    Remove-Item -LiteralPath $resolvedTemporary -Recurse -Force -ErrorAction SilentlyContinue
  }
}

if (-not $result.uninstallVerified) { throw 'Development MSIX uninstall verification failed.' }
$json = $result | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText($output, $json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
Write-Output $json
