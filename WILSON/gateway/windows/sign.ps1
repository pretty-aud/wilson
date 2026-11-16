# Authenticode-signs the files named, with the certificate the release workflow's
# secrets hold (GATEWAY_AUTHENTICODE_PFX: the .pfx as base64; GATEWAY_AUTHENTICODE_PASSWORD),
# SHA-256 with an RFC 3161 timestamp, then verifies each signature.
#   powershell -NoProfile -File gateway\windows\sign.ps1 -Files <file>, <file>
# D14, her ruling of 2026-10-11: the gateway ships UNSIGNED for now. The workflow
# runs this step only when the certificate secret is set; until then it is
# skipped and says so, and the install story says SmartScreen warns. Petal never
# says the gateway is signed until it is. (Azure Trusted Signing would replace
# the two signtool lines below with its own action; nothing else changes.)
param([Parameter(Mandatory = $true)][string[]]$Files)
$ErrorActionPreference = 'Stop'
if (-not $env:PFX_B64) { throw 'no Authenticode certificate is set (GATEWAY_AUTHENTICODE_PFX)' }
$pfx = Join-Path $env:RUNNER_TEMP ('authenticode-' + [guid]::NewGuid().ToString('N') + '.pfx')
[IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($env:PFX_B64))
try {
  $kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
  $signtool = Get-ChildItem $kits -Recurse -Filter signtool.exe | Where-Object { $_.FullName -match '\\x64\\' } | Sort-Object FullName -Descending | Select-Object -First 1
  if (-not $signtool) { throw "signtool.exe not found under $kits" }
  foreach ($f in $Files) {
    & $signtool.FullName sign /fd SHA256 /td SHA256 /tr 'http://timestamp.digicert.com' /f $pfx /p $env:PFX_PASSWORD $f
    if ($LASTEXITCODE -ne 0) { throw "signtool could not sign $f" }
    & $signtool.FullName verify /pa $f | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "the signature on $f does not verify" }
    Write-Output "::notice title=Authenticode::signed and verified $(Split-Path $f -Leaf)"
  }
} finally {
  Remove-Item -Force $pfx -ErrorAction SilentlyContinue
}
