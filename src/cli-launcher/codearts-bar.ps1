$ErrorActionPreference = 'Stop'
$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$electron = Join-Path $appDir 'CodeArts Bar.exe'
$cli = Join-Path $appDir 'resources\cli\src\cli.js'
if (-not (Test-Path -LiteralPath $electron)) { $electron = Join-Path $appDir 'CodeArts Bar' }
if (-not (Test-Path -LiteralPath $cli)) {
  [Console]::Error.WriteLine("CodeArts Bar CLI not found: $cli")
  exit 1
}
$env:ELECTRON_RUN_AS_NODE = '1'
try {
  & $electron $cli @args
  exit $LASTEXITCODE
} finally {
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
}
