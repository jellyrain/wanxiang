param([Parameter(Mandatory=$true)][string]$ProjectRoot)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression
$outputDirectory=Join-Path $ProjectRoot 'resources/skills'
[IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
$packages=@{
  api=@{
    'SKILL.md'='skills/wanxiang-workshop-api/SKILL.md'
    'references/content-model.md'='skills/wanxiang-workshop/references/content-model.md'
    'references/connection-troubleshooting.md'='skills/wanxiang-workshop/references/connection-troubleshooting.md'
    'references/catalogs.md'='skills/wanxiang-workshop/references/catalogs.md'
    'references/api.md'='skills/wanxiang-workshop/references/api.md'
    'references/history.md'='skills/wanxiang-workshop/references/history.md'
    'references/deletion.md'='skills/wanxiang-workshop/references/deletion.md'
    'references/transfer.md'='skills/wanxiang-workshop/references/transfer.md'
    'references/backups.md'='skills/wanxiang-workshop/references/backups.md'
    'scripts/invoke-workshop.ps1'='skills/wanxiang-workshop/scripts/invoke-workshop.ps1'
    'scripts/connection-errors.ps1'='skills/wanxiang-workshop/scripts/connection-errors.ps1'
  }
  mcp=@{
    'SKILL.md'='skills/wanxiang-workshop-mcp/SKILL.md'
    'references/content-model.md'='skills/wanxiang-workshop/references/content-model.md'
    'references/connection-troubleshooting.md'='skills/wanxiang-workshop/references/connection-troubleshooting.md'
    'references/catalogs.md'='skills/wanxiang-workshop/references/catalogs.md'
    'references/mcp.md'='skills/wanxiang-workshop/references/mcp.md'
    'references/history.md'='skills/wanxiang-workshop/references/history.md'
    'references/deletion.md'='skills/wanxiang-workshop/references/deletion.md'
    'references/transfer.md'='skills/wanxiang-workshop/references/transfer.md'
    'references/backups.md'='skills/wanxiang-workshop/references/backups.md'
  }
}
foreach($kind in @('api','mcp')){
  $folder='wanxiang-workshop-'+$kind
  $target=Join-Path $outputDirectory ($folder+'.zip')
  $temporary=$target+'.partial'
  $stream=[IO.File]::Open($temporary,[IO.FileMode]::Create,[IO.FileAccess]::Write)
  try {
    $archive=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create,$true)
    try {
      foreach($relative in ($packages[$kind].Keys | Sort-Object)){
        $source=Join-Path $ProjectRoot $packages[$kind][$relative]
        $bytes=[IO.File]::ReadAllBytes($source)
        $entry=$archive.CreateEntry($folder+'/'+$relative,[IO.Compression.CompressionLevel]::Optimal)
        $entryStream=$entry.Open()
        try {$entryStream.Write($bytes,0,$bytes.Length)} finally {$entryStream.Dispose()}
      }
    } finally {$archive.Dispose()}
  } finally {$stream.Dispose()}
  Move-Item -LiteralPath $temporary -Destination $target -Force
  Write-Output ('Skill package: '+$folder+'.zip')
}
