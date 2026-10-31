# Builds WilsonGatewayHost.exe from source with the .NET Framework's own C# compiler
# (present on every Windows 10 and 11; nothing downloaded, nothing third-party).
#   powershell -NoProfile -File gateway\windows\host\build.ps1 -Out <folder>
param([Parameter(Mandatory = $true)][string]$Out)
$ErrorActionPreference = 'Stop'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "csc.exe not found at $csc" }
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$src = Join-Path $PSScriptRoot 'WilsonGatewayHost.cs'
$exe = Join-Path $Out 'WilsonGatewayHost.exe'
& $csc /nologo /target:exe /optimize+ /platform:anycpu "/out:$exe" /reference:System.ServiceProcess.dll $src
if ($LASTEXITCODE -ne 0) { throw "csc failed ($LASTEXITCODE)" }
Write-Output $exe
