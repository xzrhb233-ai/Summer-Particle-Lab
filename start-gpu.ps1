param([ValidateSet('cuda','vulkan')][string]$Arch='cuda',[ValidateRange(8765,8799)][int]$Port=8765)
$ErrorActionPreference='Stop'
$projectRoot=$PSScriptRoot
$pythonPath=Join-Path $projectRoot '.venv-gpu\Scripts\python.exe'
if(-not (Test-Path -LiteralPath $pythonPath)){
    Write-Host 'Creating the project GPU virtual environment...'
    py -3.12 -m venv (Join-Path $projectRoot '.venv-gpu')
    if($LASTEXITCODE -ne 0){throw 'Python 3.12 is required to create the GPU environment.'}
}
& $pythonPath -c 'import importlib.util,sys; sys.exit(0 if all(importlib.util.find_spec(x) for x in ["taichi","websockets","numpy"]) else 1)'
if($LASTEXITCODE -ne 0){
    & $pythonPath -m pip install -r (Join-Path $projectRoot 'gpu\requirements.txt')
    if($LASTEXITCODE -ne 0){throw 'Could not install GPU dependencies.'}
}
try{ $null=Invoke-WebRequest 'http://127.0.0.1:5173/3d.html' -TimeoutSec 2 }
catch{
    Start-Process -FilePath 'node' -ArgumentList 'server.mjs' -WorkingDirectory $projectRoot -WindowStyle Hidden
}
Write-Host "Open http://127.0.0.1:5173/3d.html?scene=empty&backend=gpu&gpuPort=$Port after GPU READY."
& $pythonPath (Join-Path $projectRoot 'gpu\server.py') --arch $Arch --port $Port
