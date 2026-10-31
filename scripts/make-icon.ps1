param([Parameter(Mandatory=$true)][string]$Source,[Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$sourceImage=[Drawing.Image]::FromFile([IO.Path]::GetFullPath($Source))
$bitmap=New-Object Drawing.Bitmap(256,256)
$graphics=[Drawing.Graphics]::FromImage($bitmap)
$png=New-Object IO.MemoryStream
try {
  $graphics.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.DrawImage($sourceImage,0,0,256,256)
  $bitmap.Save($png,[Drawing.Imaging.ImageFormat]::Png)
  $bytes=$png.ToArray()
  $output=[IO.File]::Create([IO.Path]::GetFullPath($Destination))
  $writer=New-Object IO.BinaryWriter($output)
  try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
    $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
    $writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$bytes.Length); $writer.Write([uint32]22); $writer.Write($bytes)
  } finally { $writer.Dispose(); $output.Dispose() }
} finally { $png.Dispose(); $graphics.Dispose(); $bitmap.Dispose(); $sourceImage.Dispose() }
