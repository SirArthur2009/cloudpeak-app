$ErrorActionPreference = 'Stop'
$destination = Join-Path $PSScriptRoot '../database-service/bin'
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$archive = Join-Path $destination 'postgrest.zip'
Invoke-WebRequest -Uri 'https://github.com/PostgREST/postgrest/releases/download/v16.4/postgrest-v16.4-windows-x86-64.zip' -OutFile $archive
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne '29a5b56e5a09b7168bb552ef14aa7ade40bf0a81dd0687cffa86610187b89d78') { throw 'Official PostgREST archive checksum mismatch.' }
Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force
$wheel = (Invoke-RestMethod -Uri 'https://pypi.org/pypi/psycopg-binary/3.3.6/json').urls | Where-Object filename -EQ 'psycopg_binary-3.3.6-cp312-cp312-win_amd64.whl'
$wheelPath = Join-Path $destination $wheel.filename
Invoke-WebRequest -Uri $wheel.url -OutFile $wheelPath
if ((Get-FileHash -LiteralPath $wheelPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $wheel.digests.sha256) { throw 'libpq wheel checksum mismatch.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($wheelPath)
try {
  foreach ($entry in $zip.Entries) {
    if ($entry.Name.EndsWith('.dll')) {
      $target = Join-Path $destination $entry.Name
      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
      if ($entry.Name.StartsWith('libpq-')) { Copy-Item -LiteralPath $target -Destination (Join-Path $destination 'libpq.dll') -Force }
    }
  }
} finally { $zip.Dispose() }
Write-Output 'Installed checksum-verified official PostgREST 16.4 in database-service/bin.'
