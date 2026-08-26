#requires -Version 7.5

[CmdletBinding()]
param(
  [string] $ServiceOrigin = 'https://desky-checkout-testnet.netlify.app',
  [string] $SecretPath = (Join-Path $env:LOCALAPPDATA 'Desky\commerce-pilot-secrets.dpapi')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function ConvertFrom-Base64Url {
  param([Parameter(Mandatory)][string] $Value)
  $padded = $Value.Replace('-', '+').Replace('_', '/')
  $padded += '=' * ((4 - ($padded.Length % 4)) % 4)
  return [Convert]::FromBase64String($padded)
}

if (-not (Test-Path -LiteralPath $SecretPath -PathType Leaf)) {
  throw 'The DPAPI-protected commerce operator state is unavailable.'
}
if (-not [Uri]::IsWellFormedUriString($ServiceOrigin, [UriKind]::Absolute) `
  -or ([Uri]$ServiceOrigin).Scheme -ne 'https' `
  -or ([Uri]$ServiceOrigin).GetLeftPart([UriPartial]::Authority) -ne $ServiceOrigin) {
  throw 'The commerce pilot requires an exact HTTPS service origin.'
}

$cipher = [IO.File]::ReadAllBytes($SecretPath)
$secretPlain = [Security.Cryptography.ProtectedData]::Unprotect(
  $cipher,
  $null,
  [Security.Cryptography.DataProtectionScope]::CurrentUser
)
try {
  $secrets = [Text.Encoding]::UTF8.GetString($secretPlain) | ConvertFrom-Json -Depth 10 -DateKind String
  $response = Invoke-WebRequest `
    -Uri "$ServiceOrigin/v1/operations/backup" `
    -Method Get `
    -Headers @{ Accept = 'application/octet-stream'; Authorization = "Bearer $($secrets.operatorToken)" } `
    -MaximumRedirection 0 `
    -TimeoutSec 30 `
    -SkipHttpErrorCheck
  if ($response.StatusCode -ne 200) {
    throw "The encrypted commerce backup endpoint failed with status $($response.StatusCode)."
  }
  [byte[]] $envelopeBytes = if ($response.Content -is [byte[]]) {
    $response.Content
  }
  else {
    [Text.Encoding]::UTF8.GetBytes([string] $response.Content)
  }
  $envelope = [Text.Encoding]::UTF8.GetString($envelopeBytes) | ConvertFrom-Json -Depth 5 -DateKind String
  if ($envelope.format -ne 'desky-commerce-backup+a256gcm' -or $envelope.version -ne 1) {
    throw 'The encrypted commerce backup envelope is invalid.'
  }
  $key = ConvertFrom-Base64Url -Value $secrets.backupKey
  $iv = ConvertFrom-Base64Url -Value $envelope.iv
  $tag = ConvertFrom-Base64Url -Value $envelope.tag
  $encryptedPayload = ConvertFrom-Base64Url -Value $envelope.ciphertext
  [byte[]] $backupPlain = New-Object byte[] $encryptedPayload.Length
  try {
    $aes = [Security.Cryptography.AesGcm]::new($key, $tag.Length)
    try { $aes.Decrypt($iv, $encryptedPayload, $tag, $backupPlain) } finally { $aes.Dispose() }
    $backup = [Text.Encoding]::UTF8.GetString($backupPlain) | ConvertFrom-Json -Depth 40 -DateKind String
    $ordersTable = $backup.tables | Where-Object table -eq 'commerce_orders'
    $sessionsTable = $backup.tables | Where-Object table -eq 'commerce_checkout_sessions'
    if (-not $ordersTable -or -not $sessionsTable) { throw 'The commerce backup tables are incomplete.' }
    $orderPayloadIndex = [Array]::IndexOf([string[]] $ordersTable.columns, 'payload_text')
    $sessionPayloadIndex = [Array]::IndexOf([string[]] $sessionsTable.columns, 'payload_text')
    if ($orderPayloadIndex -lt 0 -or $sessionPayloadIndex -lt 0) {
      throw 'The commerce backup payload columns are unavailable.'
    }
    $orders = @($ordersTable.rows | ForEach-Object {
      ([string] $_[$orderPayloadIndex]) | ConvertFrom-Json -Depth 10 -DateKind String
    })
    $sessions = @($sessionsTable.rows | ForEach-Object {
      $record = ([string] $_[$sessionPayloadIndex]) | ConvertFrom-Json -Depth 15 -DateKind String
      $record.session
    })
    [pscustomobject]@{
      schemaVersion = 1
      backupCreatedAt = $backup.createdAt
      orderStates = @($orders | Group-Object state | Sort-Object Name | ForEach-Object {
        [pscustomobject]@{ state = $_.Name; count = $_.Count }
      })
      checkoutStates = @($sessions | Group-Object state | Sort-Object Name | ForEach-Object {
        [pscustomobject]@{ state = $_.Name; count = $_.Count }
      })
      latestOrders = @($orders | Sort-Object createdAt -Descending | Select-Object -First 5 `
        orderId, state, createdAt, updatedAt)
    } | ConvertTo-Json -Depth 8 -Compress
  }
  finally {
    [Array]::Clear($key, 0, $key.Length)
    [Array]::Clear($backupPlain, 0, $backupPlain.Length)
  }
}
finally {
  [Array]::Clear($secretPlain, 0, $secretPlain.Length)
}
