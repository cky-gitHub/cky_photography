param(
    [string]$SourceDir = (Join-Path $PSScriptRoot "..\\Photos"),
    [string]$OutputDir = (Join-Path $PSScriptRoot "..\\assets\\photos"),
    [string]$ManifestFile = (Join-Path $PSScriptRoot "..\\src\\generated\\photos.js"),
    [int]$SmallMaxEdge = 1400,
    [int]$LargeMaxEdge = 2200,
    [int]$JpegQuality = 86
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

function Save-ResizedJpeg {
    param(
        [System.Drawing.Image]$Image,
        [string]$DestinationPath,
        [int]$MaxEdge,
        [int]$Quality
    )

    $ratio = [Math]::Min($MaxEdge / $Image.Width, $MaxEdge / $Image.Height)
    if ($ratio -gt 1) {
        $ratio = 1
    }

    $targetWidth = [Math]::Max(1, [int][Math]::Round($Image.Width * $ratio))
    $targetHeight = [Math]::Max(1, [int][Math]::Round($Image.Height * $ratio))

    $bitmap = New-Object System.Drawing.Bitmap($targetWidth, $targetHeight)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.DrawImage($Image, 0, 0, $targetWidth, $targetHeight)

    $encoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageDecoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
    $encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$Quality)

    $parent = Split-Path -Parent $DestinationPath
    if (-not (Test-Path $parent)) {
        New-Item -ItemType Directory -Path $parent | Out-Null
    }

    $bitmap.Save($DestinationPath, $encoder, $encoderParams)
    $graphics.Dispose()
    $bitmap.Dispose()
}

function Convert-ToSlug {
    param([string]$Name)
    $base = [System.IO.Path]::GetFileNameWithoutExtension($Name).ToLowerInvariant()
    $slug = $base -replace "[^a-z0-9]+", "-"
    return $slug.Trim("-")
}

function Convert-ToTitle {
    param(
        [int]$Index,
        [string]$Orientation
    )
    $type = if ($Orientation -eq "landscape") { "Horizon" } else { "Portrait" }
    return "Frame {0:00} - {1}" -f ($Index + 1), $type
}

$smallDir = Join-Path $OutputDir "small"
$largeDir = Join-Path $OutputDir "large"

foreach ($dir in @($smallDir, $largeDir, (Split-Path -Parent $ManifestFile))) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir | Out-Null
    }
}

$files = Get-ChildItem -Path $SourceDir -File | Sort-Object Name
$manifest = [System.Collections.Generic.List[object]]::new()

for ($index = 0; $index -lt $files.Count; $index += 1) {
    $file = $files[$index]
    $slug = Convert-ToSlug -Name $file.Name
    $smallName = "{0}.jpg" -f $slug
    $largeName = "{0}-large.jpg" -f $slug

    $image = [System.Drawing.Image]::FromFile($file.FullName)
    try {
        Save-ResizedJpeg -Image $image -DestinationPath (Join-Path $smallDir $smallName) -MaxEdge $SmallMaxEdge -Quality $JpegQuality
        Save-ResizedJpeg -Image $image -DestinationPath (Join-Path $largeDir $largeName) -MaxEdge $LargeMaxEdge -Quality $JpegQuality

        $orientation = if ($image.Width -ge $image.Height) { "landscape" } else { "portrait" }

        $altText = "Photograph {0:00}, {1} composition from the Project Photography collection." -f ($index + 1), $orientation

        $manifest.Add([ordered]@{
            id = $slug
            order = $index
            src = "./assets/photos/small/$smallName"
            srcLarge = "./assets/photos/large/$largeName"
            width = $image.Width
            height = $image.Height
            aspect = [Math]::Round($image.Width / $image.Height, 4)
            orientation = $orientation
            alt = $altText
            label = Convert-ToTitle -Index $index -Orientation $orientation
        }) | Out-Null
    }
    finally {
        $image.Dispose()
    }
}

$json = $manifest | ConvertTo-Json -Depth 4
$output = @"
/** @typedef {{ id: string, order: number, src: string, srcLarge: string, width: number, height: number, aspect: number, orientation: "portrait" | "landscape", alt: string, label: string }} PhotoAsset */

/** @type {PhotoAsset[]} */
export const photoManifest = $json;
"@

Set-Content -Path $ManifestFile -Value $output -Encoding UTF8
Write-Host "Prepared $($manifest.Count) photos into $OutputDir and updated $ManifestFile"
