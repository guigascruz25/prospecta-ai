$ErrorActionPreference = 'Stop'
$appRoot = Split-Path $PSScriptRoot -Parent
$brandDirectory = Join-Path $appRoot 'public\brand'
$iconPath = Join-Path $brandDirectory 'prospecta-ai.ico'
Add-Type -AssemblyName System.Drawing
$original = [System.Drawing.Image]::FromFile((Join-Path $brandDirectory 'prospecta-ai-monogram.png'))
try {
    $images = @()
    foreach ($size in @(16,32,48,64,128,256)) {
        $bitmap = New-Object System.Drawing.Bitmap($size,$size)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $stream = New-Object System.IO.MemoryStream
        try {
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.DrawImage($original,0,0,$size,$size)
            $bitmap.Save($stream,[System.Drawing.Imaging.ImageFormat]::Png)
            $images += ,@{ Size=$size; Data=$stream.ToArray() }
        } finally { $graphics.Dispose(); $bitmap.Dispose(); $stream.Dispose() }
    }
    $output = [System.IO.File]::Create($iconPath)
    $writer = New-Object System.IO.BinaryWriter($output)
    try {
        $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$images.Count)
        $offset = 6 + 16 * $images.Count
        foreach ($image in $images) {
            $dimension = if ($image.Size -eq 256) { 0 } else { $image.Size }
            $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
            $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([uint16]1); $writer.Write([uint16]32)
            $writer.Write([uint32]$image.Data.Length); $writer.Write([uint32]$offset)
            $offset += $image.Data.Length
        }
        foreach ($image in $images) { $writer.Write([byte[]]$image.Data) }
    } finally { $writer.Dispose(); $output.Dispose() }
} finally { $original.Dispose() }
$shell = New-Object -ComObject WScript.Shell
$destinations = @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs'))
foreach ($directory in $destinations) {
    $shortcutPath = Join-Path $directory 'Prospecta AI.lnk'
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $PSScriptRoot 'open.ps1') + '"'
    $shortcut.WorkingDirectory = $appRoot
    $shortcut.IconLocation = "$iconPath,0"
    $shortcut.Description = 'Inicia o Prospecta AI e abre o painel no navegador.'
    $shortcut.WindowStyle = 7
    $shortcut.Save()
    Write-Output "Atalho criado: $shortcutPath"
}
