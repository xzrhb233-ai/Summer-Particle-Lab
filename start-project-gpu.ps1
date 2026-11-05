param([ValidateSet('cuda','vulkan')][string]$Arch='cuda',[ValidateRange(8765,8799)][int]$Port=8769)
$ErrorActionPreference='Stop'
$projectRoot=$PSScriptRoot
$pythonPath=Join-Path $projectRoot '.venv-gpu\Scripts\python.exe'
if(-not (Test-Path -LiteralPath $pythonPath)){throw 'Run start-gpu.ps1 once to install the project Taichi environment.'}
try{$null=Invoke-WebRequest 'http://127.0.0.1:5173/3d.html' -TimeoutSec 2}
catch{Start-Process -FilePath 'node' -ArgumentList 'server.mjs' -WorkingDirectory $projectRoot -WindowStyle Hidden}
Write-Host "After GPU PROJECT READY: http://127.0.0.1:5173/3d.html?scene=empty&backend=cpu&study=project&mbd=mpm-part-thermal&projectBackend=gpu&projectGpuPort=$Port#solver"
& $pythonPath (Join-Path $projectRoot 'gpu\project_server.py') --arch $Arch --port $Port
