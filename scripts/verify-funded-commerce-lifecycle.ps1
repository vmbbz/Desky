#requires -Version 7.5

[CmdletBinding(DefaultParameterSetName = 'Refresh')]
param(
  [string] $ServiceOrigin = 'https://desky-checkout-testnet.netlify.app',
  [string] $StatePath = (Join-Path $env:LOCALAPPDATA 'Desky\commerce-pilot-app-user.dpapi'),
  [Parameter(ParameterSetName = 'RestoreCleanDevice', Mandatory)]
  [switch] $RestoreCleanDevice,
  [Parameter(ParameterSetName = 'RestoreCleanDevice')]
  [string] $RestoredStatePath = (Join-Path $env:LOCALAPPDATA 'Desky\commerce-pilot-restored-device.dpapi')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-DeskyPost {
  param(
    [Parameter(Mandatory)][string] $Path,
    [Parameter(Mandatory)][object] $Body
  )
  $response = Invoke-WebRequest `
    -Uri "$ServiceOrigin$Path" `
    -Method Post `
    -Headers @{
      Accept = 'application/json'
      'Cache-Control' = 'no-store'
      'Content-Type' = 'application/json'
      'X-Desky-Api-Version' = '1'
    } `
    -Body ($Body | ConvertTo-Json -Depth 20 -Compress) `
    -MaximumRedirection 0 `
    -TimeoutSec 30 `
    -SkipHttpErrorCheck
  $contentType = [string] ($response.Headers.'Content-Type' | Select-Object -First 1)
  if ($response.StatusCode -ne 200 -or -not $contentType.ToLowerInvariant().StartsWith('application/json')) {
    $errorCode = 'invalid-response'
    $correlationId = 'unavailable'
    if ($contentType.ToLowerInvariant().StartsWith('application/json')) {
      try {
        $failure = $response.Content | ConvertFrom-Json -Depth 5 -DateKind String
        if ($failure.error -match '^[a-z][a-z0-9-]{0,63}$') { $errorCode = $failure.error }
        if ($failure.correlationId -match '^[a-z0-9][a-z0-9._:-]{0,127}$') {
          $correlationId = $failure.correlationId
        }
      }
      catch { }
    }
    throw "Desky API $Path failed with status $($response.StatusCode), code $errorCode, correlation $correlationId."
  }
  return $response.Content | ConvertFrom-Json -Depth 30 -DateKind String
}

function Read-ProtectedState {
  param([Parameter(Mandatory)][string] $Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "The DPAPI-protected commerce state is unavailable at $Path."
  }
  $cipher = [IO.File]::ReadAllBytes($Path)
  [byte[]] $plain = [Security.Cryptography.ProtectedData]::Unprotect(
    $cipher,
    $null,
    [Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  try {
    return [Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json -Depth 40 -DateKind String
  }
  finally { [Array]::Clear($plain, 0, $plain.Length) }
}

function Save-ProtectedState {
  param(
    [Parameter(Mandatory)][string] $Path,
    [Parameter(Mandatory)][object] $State
  )
  $directory = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
    $null = New-Item -ItemType Directory -Path $directory
  }
  [byte[]] $plain = [Text.Encoding]::UTF8.GetBytes(($State | ConvertTo-Json -Depth 40 -Compress))
  try {
    [byte[]] $cipher = [Security.Cryptography.ProtectedData]::Protect(
      $plain,
      $null,
      [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    $temporary = "$Path.$([Guid]::NewGuid().ToString('N')).tmp"
    try {
      [IO.File]::WriteAllBytes($temporary, $cipher)
      Move-Item -LiteralPath $temporary -Destination $Path -Force
    }
    finally {
      if (Test-Path -LiteralPath $temporary -PathType Leaf) {
        Remove-Item -LiteralPath $temporary -Force
      }
      [Array]::Clear($cipher, 0, $cipher.Length)
    }
  }
  finally { [Array]::Clear($plain, 0, $plain.Length) }
}

function Assert-FundedSession {
  param(
    [Parameter(Mandatory)][object] $Session,
    [Parameter(Mandatory)][string] $ExpectedAccountId,
    [Parameter(Mandatory)][string] $ExpectedInstallationId
  )
  if ($Session.schemaVersion -ne 1 `
    -or $Session.accountId -ne $ExpectedAccountId `
    -or $Session.installationId -ne $ExpectedInstallationId `
    -or $Session.refreshGeneration -lt 1 `
    -or $Session.reconciliation.accountId -ne $ExpectedAccountId) {
    throw 'The restored commerce session crossed its admitted identity or installation.'
  }
  $toothpaste = @($Session.reconciliation.grants | Where-Object {
    $_.productId -eq 'avatar.toothpaste' -and $_.state -eq 'active'
  })
  if ($toothpaste.Count -ne 1 `
    -or $toothpaste[0].grantId -ne 'grant:x402:d236ef8863cec40a38686b434212e478') {
    throw 'The funded Toothpaste grant was not restored exactly once.'
  }
  return $toothpaste[0]
}

if (-not [Uri]::IsWellFormedUriString($ServiceOrigin, [UriKind]::Absolute) `
  -or ([Uri] $ServiceOrigin).Scheme -ne 'https' `
  -or ([Uri] $ServiceOrigin).GetLeftPart([UriPartial]::Authority) -ne $ServiceOrigin) {
  throw 'The commerce lifecycle verifier requires an exact HTTPS service origin.'
}

$ready = Invoke-WebRequest `
  -Uri "$ServiceOrigin/readyz" `
  -Method Get `
  -Headers @{ Accept = 'application/json'; 'Cache-Control' = 'no-store' } `
  -MaximumRedirection 0 `
  -TimeoutSec 20 `
  -SkipHttpErrorCheck
if ($ready.StatusCode -ne 200) { throw 'The commerce payment dependency gate is closed.' }

$state = Read-ProtectedState -Path $StatePath
if (-not ($state.PSObject.Properties.Name -contains 'commerceSession')) {
  throw 'The protected state does not contain a commerce session.'
}

if ($RestoreCleanDevice) {
  if (Test-Path -LiteralPath $RestoredStatePath -PathType Leaf) {
    throw 'The isolated restored-device state already exists; refusing to overwrite lifecycle evidence.'
  }
  if (-not ($state.PSObject.Properties.Name -contains 'commerceRecoveryCode') `
    -or -not ($state.PSObject.Properties.Name -contains 'proofKeyVerifier')) {
    throw 'The source state does not contain clean-device recovery material.'
  }
  [byte[]] $installationRandom = New-Object byte[] 12
  [Security.Cryptography.RandomNumberGenerator]::Fill($installationRandom)
  $installationSuffix = [Convert]::ToHexString($installationRandom).ToLowerInvariant()
  [Array]::Clear($installationRandom, 0, $installationRandom.Length)
  $installationId = "installation:restored:$installationSuffix"
  $idempotencyKey = "restore:funded:$installationSuffix"
  $restored = Invoke-DeskyPost -Path '/v1/session/restore' -Body ([ordered]@{
    schemaVersion = 1
    installationId = $installationId
    recoveryCode = $state.commerceRecoveryCode
    proofKeyVerifier = $state.proofKeyVerifier
    idempotencyKey = $idempotencyKey
  })
  $grant = Assert-FundedSession `
    -Session $restored `
    -ExpectedAccountId $state.commerceSession.accountId `
    -ExpectedInstallationId $installationId
  Save-ProtectedState -Path $RestoredStatePath -State ([ordered]@{
    schemaVersion = 1
    restoredAt = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    restorationIdempotencyKey = $idempotencyKey
    commerceSession = $restored
  })
  [pscustomobject]@{
    schemaVersion = 1
    operation = 'clean-device-restored'
    accountId = $restored.accountId
    installationId = $restored.installationId
    sessionId = $restored.sessionId
    refreshGeneration = $restored.refreshGeneration
    reconciliationCursor = $restored.reconciliation.cursor
    productId = $grant.productId
    grantId = $grant.grantId
    grantState = $grant.state
    protectedState = $RestoredStatePath
  } | ConvertTo-Json -Compress
  return
}

$current = $state.commerceSession
$rotationId = if ($state.PSObject.Properties.Name -contains 'pendingLifecycleRotationId') {
  [string] $state.pendingLifecycleRotationId
}
else {
  "rotate:lifecycle:$([Guid]::NewGuid().ToString('N'))"
}
if ($rotationId -notmatch '^rotate:lifecycle:[a-f0-9]{32}$') {
  throw 'The protected pending lifecycle rotation ID is invalid.'
}
if ($state.PSObject.Properties.Name -contains 'pendingLifecycleRotationId') {
  $state.pendingLifecycleRotationId = $rotationId
}
else {
  $state | Add-Member -NotePropertyName pendingLifecycleRotationId -NotePropertyValue $rotationId
}
Save-ProtectedState -Path $StatePath -State $state

$fresh = Invoke-DeskyPost -Path '/v1/session/refresh' -Body ([ordered]@{
  schemaVersion = 1
  sessionId = $current.sessionId
  installationId = $current.installationId
  refreshCredential = $current.refreshCredential
  refreshGeneration = [int] $current.refreshGeneration
  rotationId = $rotationId
  reconciliationCursor = $current.reconciliation.cursor
})
$grant = Assert-FundedSession `
  -Session $fresh `
  -ExpectedAccountId $current.accountId `
  -ExpectedInstallationId $current.installationId
$state.commerceSession = $fresh
$state.PSObject.Properties.Remove('pendingLifecycleRotationId')
$verifiedAt = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
if ($state.PSObject.Properties.Name -contains 'lastLifecycleVerificationAt') {
  $state.lastLifecycleVerificationAt = $verifiedAt
}
else {
  $state | Add-Member -NotePropertyName lastLifecycleVerificationAt -NotePropertyValue $verifiedAt
}
Save-ProtectedState -Path $StatePath -State $state

[pscustomobject]@{
  schemaVersion = 1
  operation = 'session-refreshed'
  accountId = $fresh.accountId
  installationId = $fresh.installationId
  sessionId = $fresh.sessionId
  refreshGeneration = $fresh.refreshGeneration
  reconciliationCursor = $fresh.reconciliation.cursor
  productId = $grant.productId
  grantId = $grant.grantId
  grantState = $grant.state
  protectedState = $StatePath
} | ConvertTo-Json -Compress
