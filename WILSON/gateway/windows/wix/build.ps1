# Builds "WILSON Gateway Setup.msi" (unsigned until D14; GW4 signs it).
#   powershell -NoProfile -File gateway\windows\wix\build.ps1 -Out <folder> [-NodeZip <path>]
# Steps: the service host from source (csc.exe); node.exe from the official zip,
# whose SHA-256 must equal gateway\windows\node.json's pin; the app's own files
# (package.json, src\, updater\; no tests); WiX 5.0.2 as a dotnet LOCAL tool.
# It installs nothing on the computer that builds it.
param(
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$NodeZip = ''
)
$ErrorActionPreference = 'Stop'
$gateway = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$pin = Get-Content (Join-Path $gateway 'windows\node.json') -Raw | ConvertFrom-Json
$pkg = Get-Content (Join-Path $gateway 'package.json') -Raw | ConvertFrom-Json
$version = $pkg.version
$stage = Join-Path $Out 'stage'
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

# 1. The host.
& (Join-Path $gateway 'windows\host\build.ps1') -Out (Join-Path $stage 'host') | Out-Null

# 2. node.exe, by the pinned hash.
if (-not $NodeZip) {
  $NodeZip = Join-Path $Out $pin.zip
  if (-not (Test-Path $NodeZip)) { Invoke-WebRequest -UseBasicParsing -Uri $pin.url -OutFile $NodeZip }
}
$hash = (Get-FileHash -Algorithm SHA256 $NodeZip).Hash.ToLowerInvariant()
if ($hash -ne $pin.sha256) { throw "node zip hash $hash is not the pinned $($pin.sha256)" }
$nodeDir = Join-Path $Out 'node'
if (Test-Path $nodeDir) { Remove-Item -Recurse -Force $nodeDir }
Expand-Archive -Path $NodeZip -DestinationPath $nodeDir
$nodeExe = Get-ChildItem -Path $nodeDir -Recurse -Filter node.exe | Select-Object -First 1

# 3. The app, twice (current\ for the gateway, updater\ for the updater).
foreach ($slot in @('current', 'updater')) {
  $app = Join-Path $stage "$slot\app"
  New-Item -ItemType Directory -Force -Path $app | Out-Null
  Copy-Item $nodeExe.FullName (Join-Path $stage "$slot\node.exe")
  Copy-Item (Join-Path $gateway 'package.json') $app
  Copy-Item -Recurse (Join-Path $gateway 'src') (Join-Path $app 'src')
  Copy-Item -Recurse (Join-Path $gateway 'updater') (Join-Path $app 'updater')
}
Set-Content -Path (Join-Path $stage 'wilson-gateway.cmd') -Encoding ASCII -Value '@"%~dp0current\node.exe" "%~dp0current\app\src\cli.mjs" %*'
$rtf = '{\rtf1\ansi\deff0{\fonttbl{\f0 Segoe UI;}}\f0\fs18 WILSON Gateway ' + $version + ', Petal Studios. For use with a WILSON workspace under its terms. It reads the footage share you give it, read-only, and serves clips to the WILSON web app over HTTPS: on your office network, and from outside only while your workspace''s switch is on. Node.js is included under its MIT licence.\par}'
Set-Content -Path (Join-Path $stage 'license.rtf') -Encoding ASCII -Value $rtf

# 4. WiX 5.0.2, a local tool; its three extensions in this folder's .wix cache.
Push-Location $gateway
try {
  dotnet tool restore | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'dotnet tool restore failed' }
  foreach ($ext in @('WixToolset.Util.wixext/5.0.2', 'WixToolset.UI.wixext/5.0.2', 'WixToolset.Firewall.wixext/5.0.2')) {
    dotnet wix extension add $ext | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "wix extension add $ext failed" }
  }
  $msi = Join-Path $Out 'WILSON Gateway Setup.msi'
  dotnet wix build (Join-Path $gateway 'windows\wix\Package.wxs') -arch x64 `
    -ext WixToolset.Util.wixext -ext WixToolset.UI.wixext -ext WixToolset.Firewall.wixext `
    -define "Stage=$stage" -define "Version=$version" -o $msi
  if ($LASTEXITCODE -ne 0) { throw 'wix build failed' }
  Write-Output $msi
} finally {
  Pop-Location
}
