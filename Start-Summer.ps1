param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$taskUrl = 'http://127.0.0.1:5173/3d.html?scene=empty&backend=cpu&study=project&mbd=empty&v=0.71.0#geometry'

function Test-SummerPage {
    try {
        $page = Invoke-WebRequest -Uri 'http://127.0.0.1:5173/3d.html' -UseBasicParsing -TimeoutSec 2
        return ($page.StatusCode -eq 200 -and $page.Content.Contains('Summer 3D'))
    } catch { return $false }
}

try {
    if (-not (Test-SummerPage)) {
        # Reuse an existing server when possible. Never terminate another app.
        $taskClient = New-Object Net.Sockets.TcpClient
        try {
            $taskConnect = $taskClient.ConnectAsync('127.0.0.1', 5173)
            try { $null = $taskConnect.Wait(800) } catch {}
            if ($taskClient.Connected) { throw 'Port 5173 is occupied by another service. Close that service and try again.' }
        } finally { $taskClient.Dispose() }
        $taskNodeCommand = Get-Command node -ErrorAction SilentlyContinue
        if (-not $taskNodeCommand) { throw 'Node.js was not found on PATH. Install Node.js 22.10+ or 24, then install the project dependencies with pnpm install --frozen-lockfile.' }
        $taskNode = $taskNodeCommand.Source
        $taskLogDir = Join-Path $taskRoot 'artifacts'
        $null = New-Item -ItemType Directory -Path $taskLogDir -Force
        $taskOldPort = $env:PORT
        try {
            $env:PORT = '5173'
            $taskProcess = Start-Process -FilePath $taskNode -ArgumentList ('"' + (Join-Path $taskRoot 'server.mjs') + '"') -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskLogDir 'desktop-server.log') -RedirectStandardError (Join-Path $taskLogDir 'desktop-server-error.log') -PassThru
        } finally { $env:PORT = $taskOldPort }
        $taskReady = $false
        for ($taskAttempt = 0; $taskAttempt -lt 30; $taskAttempt++) {
            if (Test-SummerPage) { $taskReady = $true; break }
            if ($taskProcess.HasExited) { break }
            Start-Sleep -Milliseconds 300
        }
        if (-not $taskReady) { throw 'Summer could not start. See artifacts/desktop-server-error.log in the project folder.' }
    }
    if (-not $NoBrowser) { Start-Process $taskUrl }
    Write-Output $taskUrl
} catch {
    if (-not $NoBrowser) {
        Add-Type -AssemblyName System.Windows.Forms
        $null = [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Summer startup', 'OK', 'Error')
    }
    throw
}
