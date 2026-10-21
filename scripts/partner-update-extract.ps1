param([Parameter(Mandatory=$true)][string]$Archive,[Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path -LiteralPath $Destination) { throw 'Destino de extração já existe.' }
$targetRoot=[IO.Path]::GetFullPath($Destination)
$zip=[IO.Compression.ZipFile]::OpenRead($Archive)
try {
    $seen=New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    [long]$total=0
    foreach($entry in $zip.Entries) {
        $name=$entry.FullName
        if ($name -notmatch '^Prospecta-AI/' -or $name -match '\\|:|(^|/)\.\.?(/|$)' -or $name -match '[. ](/|$)' -or $name -match '(^|/)(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|/|$)' -or -not $seen.Add($name)) { throw 'Entrada inválida no ZIP.' }
        $kind=($entry.ExternalAttributes -shr 16) -band 61440
        if($kind -ne 0 -and $kind -ne 32768 -and $kind -ne 16384) { throw 'Links não são aceitos.' }
        $total+=$entry.Length
        if($total -gt 157286400 -or $zip.Entries.Count -gt 3000) { throw 'ZIP excede os limites.' }
        $resolved=[IO.Path]::GetFullPath((Join-Path $targetRoot $name))
        if(-not $resolved.StartsWith($targetRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Entrada fora da pasta.' }
    }
    [IO.Directory]::CreateDirectory($targetRoot) | Out-Null
    foreach($entry in $zip.Entries) {
        $target=Join-Path $targetRoot $entry.FullName
        if($entry.FullName.EndsWith('/')) { [IO.Directory]::CreateDirectory($target) | Out-Null; continue }
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$target,$false)
    }
} finally { $zip.Dispose() }
