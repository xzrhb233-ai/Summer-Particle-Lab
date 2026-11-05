param([ValidateRange(8765,8799)][int]$Port=8795)
$ErrorActionPreference='Stop'
$mixedPython=Join-Path $PSScriptRoot '.venv-gpu\Scripts\python.exe'
if(-not (Test-Path -LiteralPath $mixedPython)){throw 'Run start-gpu.ps1 to install Taichi first.'}
Write-Host "After MIXED GPU READY: http://127.0.0.1:5173/3d.html?scene=empty&backend=cpu&study=project&mbd=mpm-fem-energy&mixedGpuPort=$Port#results"
Write-Host "Four-method GPU: http://127.0.0.1:5173/3d.html?scene=empty&backend=cpu&study=project&mbd=unified-gpu&mixedGpuPort=$Port#results"
& $mixedPython (Join-Path $PSScriptRoot 'gpu\mixed_server.py') --port $Port
