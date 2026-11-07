$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'scripts/setup.mjs') @args
exit $LASTEXITCODE
