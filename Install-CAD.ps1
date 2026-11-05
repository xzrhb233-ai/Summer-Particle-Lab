$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath '.venv-cad\Scripts\python.exe')) {
    py -3.12 -m venv .venv-cad
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 is required.' }
}
& .\.venv-cad\Scripts\python.exe -m pip install -r cad/requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'SMLib installation failed.' }
& .\.venv-cad\Scripts\python.exe -c "import usd_brep; import meshpy.tet; import numpy; print('SMLib and TetGen volume mesher ready')"
if ($LASTEXITCODE -ne 0) { throw 'SMLib import failed.' }
