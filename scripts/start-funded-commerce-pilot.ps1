#requires -Version 7.5

[CmdletBinding()]
param(
  [string] $ServiceOrigin = 'https://desky-checkout-testnet.netlify.app',
  [string] $StatePath = (Join-Path $env:LOCALAPPDATA 'Desky\commerce-pilot-app-user.dpapi'),
  [string] $BrowserPath = 'C:\Program Files\Mozilla Firefox\firefox.exe',
  [ValidatePattern('^$|^rotate:funded:[0-9]{14}$')]
  [string] $RefreshRotationId = '',
  [switch] $DoNotLaunch
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$expectedOffer = 'offer.avatar.toothpaste.base-sepolia-pilot'
$expectedAsset = '0x036cbd53842c5426634e7929541ec2318f3dcf7e'
$expectedRecipient = '0x4f9c8ea2a0e77338d41d5438f319617e2e95d7c3'

function ConvertTo-Base64Url {
  param([Parameter(Mandatory)][byte[]] $Bytes)
  return [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Get-Sha256Base64Url {
  param([Parameter(Mandatory)][string] $Value)
  $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
  try {
    return ConvertTo-Base64Url -Bytes ([Security.Cryptography.SHA256]::HashData($bytes))
  }
  finally {
    [Array]::Clear($bytes, 0, $bytes.Length)
  }
}

function Invoke-DeskyPost {
  param(
    [Parameter(Mandatory)][string] $Path,
    [Parameter(Mandatory)][object] $Body,
    [string] $Bearer = ''
  )
  $headers = @{
    Accept = 'application/json'
    'Cache-Control' = 'no-store'
    'Content-Type' = 'application/json'
    'X-Desky-Api-Version' = '1'
  }
  if ($Bearer) { $headers.Authorization = "Bearer $Bearer" }
  $response = Invoke-WebRequest `
    -Uri "$ServiceOrigin$Path" `
    -Method Post `
    -Headers $headers `
    -Body ($Body | ConvertTo-Json -Depth 20 -Compress) `
    -MaximumRedirection 0 `
    -TimeoutSec 20 `
    -SkipHttpErrorCheck
  $contentType = [string] ($response.Headers.'Content-Type' | Select-Object -First 1)
  $contentType = $contentType.ToLowerInvariant()
  if ($response.StatusCode -ne 200 -or -not $contentType.StartsWith('application/json')) {
    $errorCode = 'invalid-response'
    $correlationId = 'unavailable'
    if ($contentType.StartsWith('application/json')) {
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
  return $response.Content | ConvertFrom-Json -Depth 20 -DateKind String
}

function Save-PilotState {
  param([Parameter(Mandatory)][object] $State)
  $nextPlain = [Text.Encoding]::UTF8.GetBytes(($State | ConvertTo-Json -Depth 30 -Compress))
  try {
    $nextCipher = [Security.Cryptography.ProtectedData]::Protect(
      $nextPlain,
      $null,
      [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    [IO.File]::WriteAllBytes($StatePath, $nextCipher)
  }
  finally {
    [Array]::Clear($nextPlain, 0, $nextPlain.Length)
  }
}

if (-not [Uri]::IsWellFormedUriString($ServiceOrigin, [UriKind]::Absolute) `
  -or ([Uri]$ServiceOrigin).Scheme -ne 'https' `
  -or ([Uri]$ServiceOrigin).GetLeftPart([UriPartial]::Authority) -ne $ServiceOrigin) {
  throw 'The commerce pilot requires an exact HTTPS service origin.'
}
if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) {
  throw 'The DPAPI-protected commerce pilot state is unavailable.'
}
if (-not $DoNotLaunch -and -not (Test-Path -LiteralPath $BrowserPath -PathType Leaf)) {
  throw 'The requested browser executable is unavailable.'
}

$ready = Invoke-WebRequest `
  -Uri "$ServiceOrigin/readyz" `
  -Method Get `
  -Headers @{ Accept = 'application/json'; 'Cache-Control' = 'no-store' } `
  -MaximumRedirection 0 `
  -TimeoutSec 20 `
  -SkipHttpErrorCheck
if ($ready.StatusCode -ne 200) { throw 'The commerce payment dependency gate is closed.' }

$cipher = [IO.File]::ReadAllBytes($StatePath)
$plain = [Security.Cryptography.ProtectedData]::Unprotect(
  $cipher,
  $null,
  [Security.Cryptography.DataProtectionScope]::CurrentUser
)
try {
  $state = [Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json -Depth 20 -DateKind String
  $pendingRotation = if ($state.PSObject.Properties.Name -contains 'pendingRefreshRotationId') {
    [string] $state.pendingRefreshRotationId
  }
  else { '' }
  $rotationId = if ($RefreshRotationId) { $RefreshRotationId } elseif ($pendingRotation) {
    $pendingRotation
  }
  else { "rotate:funded:$([DateTime]::UtcNow.ToString('yyyyMMddHHmmss').ToLowerInvariant())" }
  if ($rotationId -notmatch '^rotate:funded:([0-9]{14})$') {
    throw 'The pending refresh rotation identifier is invalid.'
  }
  $runTag = $Matches[1]
  if ($state.PSObject.Properties.Name -contains 'pendingRefreshRotationId') {
    $state.pendingRefreshRotationId = $rotationId
  }
  else {
    $state | Add-Member -NotePropertyName pendingRefreshRotationId -NotePropertyValue $rotationId
  }
  Save-PilotState -State $state
  $current = $state.commerceSession

  $fresh = Invoke-DeskyPost -Path '/v1/session/refresh' -Body ([ordered]@{
    schemaVersion = 1
    sessionId = $current.sessionId
    installationId = $current.installationId
    refreshCredential = $current.refreshCredential
    refreshGeneration = [int] $current.refreshGeneration
    rotationId = $rotationId
    reconciliationCursor = $current.reconciliation.cursor
  })
  $state.commerceSession = $fresh
  $state.lastSessionRefreshAt = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  $state.PSObject.Properties.Remove('pendingRefreshRotationId')
  Save-PilotState -State $state

  $quoteResponse = Invoke-DeskyPost -Path '/v1/quote' -Bearer $fresh.accessToken -Body ([ordered]@{
    schemaVersion = 1
    installationId = $fresh.installationId
    offerId = $expectedOffer
    region = 'ZA'
    idempotencyKey = "quote:funded:$runTag"
  })
  $quote = $quoteResponse.quote
  $order = $quoteResponse.order
  if ($quote.offerId -ne $expectedOffer `
    -or $quote.productId -ne 'avatar.toothpaste' `
    -or $quote.amountAtomic -ne '100000' `
    -or $quote.currency -ne 'USDC' `
    -or $quote.network -ne 'eip155:84532' `
    -or $quote.asset.ToLowerInvariant() -ne $expectedAsset `
    -or $quote.recipient.ToLowerInvariant() -ne $expectedRecipient `
    -or $order.state -ne 'created') {
    throw 'The fresh quote did not match the exact admitted pilot.'
  }

  $canonicalTerms = [ordered]@{
    quoteId = $quote.quoteId
    orderId = $order.orderId
    accountId = $quote.accountId
    offerId = $quote.offerId
    offerRevision = [int] $quote.offerRevision
    productId = $quote.productId
    productRevision = [int] $quote.productRevision
    avatarRevisionIds = @($quote.avatarRevisionIds)
    catalogVersion = $quote.catalogVersion
    releaseProfile = $quote.releaseProfile
    region = $quote.region
    provider = $quote.provider
    currency = $quote.currency
    amountAtomic = $quote.amountAtomic
    network = $quote.network
    asset = $quote.asset
    recipient = $quote.recipient
    quoteExpiresAt = $quote.expiresAt
  }
  $termsDigest = Get-Sha256Base64Url -Value (
    $canonicalTerms | ConvertTo-Json -Depth 10 -Compress
  )

  [byte[]] $verifierBytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Fill($verifierBytes)
  $bindingVerifier = ConvertTo-Base64Url -Bytes $verifierBytes
  [Array]::Clear($verifierBytes, 0, $verifierBytes.Length)

  $approvedAt = [DateTime]::UtcNow
  $quoteExpiry = [DateTimeOffset]::Parse($quote.expiresAt).UtcDateTime
  # Keep one full second below the protocol maximum so cross-runtime timestamp
  # precision cannot turn an exact-boundary approval into a rejected lifetime.
  $approvalExpiry = $approvedAt.AddSeconds(119)
  if ($approvalExpiry -gt $quoteExpiry) { $approvalExpiry = $quoteExpiry }
  $approvedAtText = $approvedAt.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  $approvalExpiryText = $approvalExpiry.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  $approvalLifetimeMilliseconds = [DateTimeOffset]::Parse($approvalExpiryText).ToUnixTimeMilliseconds() `
    - [DateTimeOffset]::Parse($approvedAtText).ToUnixTimeMilliseconds()
  if ($approvalLifetimeMilliseconds -lt 1 -or $approvalLifetimeMilliseconds -gt 119000) {
    throw "The locally serialized checkout approval lifetime is invalid ($approvalLifetimeMilliseconds ms; approved $approvedAtText; expires $approvalExpiryText; quote $($quoteExpiry.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')))."
  }
  $checkout = Invoke-DeskyPost -Path '/v1/checkout/session' -Bearer $fresh.accessToken -Body ([ordered]@{
    schemaVersion = 1
    approvalId = "approval:funded:$runTag"
    accountId = $quote.accountId
    installationId = $fresh.installationId
    orderId = $order.orderId
    quoteId = $quote.quoteId
    termsDigest = $termsDigest
    approvedAt = $approvedAtText
    approvalExpiresAt = $approvalExpiryText
    idempotencyKey = "checkout:funded:$runTag"
    browserBindingChallenge = Get-Sha256Base64Url -Value $bindingVerifier
  })
  if ($checkout.state -ne 'ready' `
    -or $checkout.quoteId -ne $quote.quoteId `
    -or $checkout.orderId -ne $order.orderId `
    -or -not $checkout.checkoutUrl.StartsWith("$ServiceOrigin/checkout/")) {
    throw 'The created checkout crossed the admitted quote.'
  }

  $pilot = [ordered]@{
    schemaVersion = 1
    createdAt = $approvedAt.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    quote = $quote
    order = $order
    session = $checkout
    browserBindingVerifier = $bindingVerifier
    browserOpenedAt = $null
  }
  if ($state.PSObject.Properties.Name -contains 'activeFundedPilot') {
    $state.activeFundedPilot = $pilot
  }
  else {
    $state | Add-Member -NotePropertyName activeFundedPilot -NotePropertyValue $pilot
  }

  Save-PilotState -State $state

  if (-not $DoNotLaunch) {
    $boundUrl = "$($checkout.checkoutUrl)#handoff=$bindingVerifier"
    Start-Process -FilePath $BrowserPath -ArgumentList @('-new-tab', $boundUrl)
    $state.activeFundedPilot.browserOpenedAt = [DateTime]::UtcNow.ToString(
      'yyyy-MM-ddTHH:mm:ss.fffZ'
    )
    Save-PilotState -State $state
  }

  [pscustomobject]@{
    schemaVersion = 1
    launched = -not $DoNotLaunch
    product = $quote.productId
    amount = '0.10 test USDC'
    network = 'Base Sepolia'
    asset = $quote.asset
    recipient = $quote.recipient
    checkoutState = $checkout.state
    checkoutExpiresAt = $checkout.expiresAt
    refreshGeneration = $fresh.refreshGeneration
  } | ConvertTo-Json -Compress
}
finally {
  [Array]::Clear($plain, 0, $plain.Length)
}
