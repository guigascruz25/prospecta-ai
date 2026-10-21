param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$appRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $appRoot
Add-Type -AssemblyName System.Windows.Forms
try {
    $appPort = 3100
    if (Test-Path -LiteralPath '.env') {
        foreach ($line in Get-Content -LiteralPath '.env') {
            if ($line -match '^\s*APP_PORT\s*=\s*["'']?(\d+)["'']?\s*$') { $appPort = [int]$Matches[1] }
        }
    }
    $origin = "http://127.0.0.1:$appPort"
    $pathForId = $appRoot.Replace('\','/').TrimEnd('/').ToLowerInvariant()
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $expectedId = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($pathForId)))).Replace('-','').ToLowerInvariant().Substring(0,20) } finally { $sha.Dispose() }
    function Read-AppStatus {
        try { return Invoke-RestMethod -Uri "$origin/api/status" -TimeoutSec 3 } catch { return $null }
    }
    $status = Read-AppStatus
    if (-not $status) {
        if (-not (Test-Path -LiteralPath '.next\BUILD_ID')) { throw 'Instalação incompleta. A compilação do Prospecta AI não foi encontrada.' }
        $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
        $startOutput = & $nodePath (Join-Path $PSScriptRoot 'partner-service.mjs') start 2>&1
        if ($LASTEXITCODE -ne 0) { throw "Não foi possível iniciar o Prospecta AI. $startOutput" }
        $deadline = (Get-Date).AddSeconds(45)
        do {
            Start-Sleep -Milliseconds 750
            $status = Read-AppStatus
        } while (-not $status -and (Get-Date) -lt $deadline)
        if (-not $status) { throw 'O painel não respondeu. Consulte logs\app-error.log nesta instalação.' }
    }
    if ($status.installationId -ne $expectedId) { throw "A porta $appPort pertence a outra instalação. Nenhum processo foi encerrado." }
    if (-not $NoBrowser) {
        Start-Process -FilePath "$origin/#overview"
    }
    Write-Output "Prospecta AI disponível: $origin/#overview"
} catch {
    if (-not $NoBrowser) { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'Prospecta AI',[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null }
    Write-Error $_
    exit 1
}
