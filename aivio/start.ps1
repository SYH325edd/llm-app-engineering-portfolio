param(
    [int]$PreferredPort = 8787
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

function Test-RelayHealth {
    param([int]$Port)
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 2
        return ($response.StatusCode -eq 200)
    }
    catch {
        return $false
    }
}

function Test-PortOpen {
    param([int]$Port)
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(300, $false)) { return $false }
        $client.EndConnect($async)
        return $true
    }
    catch {
        return $false
    }
    finally {
        $client.Close()
    }
}

function Get-FreePort {
    param([int]$StartPort)
    for ($port = $StartPort; $port -lt ($StartPort + 30); $port++) {
        if (Test-RelayHealth $port) { return @{ Port = $port; AlreadyRunning = $true } }
        if (-not (Test-PortOpen $port)) { return @{ Port = $port; AlreadyRunning = $false } }
    }
    throw "No free port found."
}

try {
    $choice = Get-FreePort $PreferredPort
    $url = "http://127.0.0.1:$($choice.Port)"

    if ($choice.AlreadyRunning) {
        Write-Host "API Relay Console is already running:" -ForegroundColor Green
        Write-Host $url -ForegroundColor Cyan
        Start-Process $url
        Read-Host "Press Enter to close this window"
        exit 0
    }

    Write-Host "Starting API Relay Console:" -ForegroundColor Green
    Write-Host $url -ForegroundColor Cyan
    Start-Process $url
    & "$scriptDir\server.ps1" -Port $choice.Port
}
catch {
    Write-Host ""
    Write-Host "Startup failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "If http://127.0.0.1:8787 is already open in your browser, the service is already running."
    Read-Host "Press Enter to close this window"
}
