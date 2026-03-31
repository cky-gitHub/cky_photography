param(
    [int]$Port = 4173,
    [string]$Root = (Join-Path $PSScriptRoot "..")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()

$contentTypes = @{
    ".css" = "text/css"
    ".html" = "text/html"
    ".jpg" = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".js" = "text/javascript"
    ".json" = "application/json"
    ".map" = "application/json"
    ".png" = "image/png"
    ".svg" = "image/svg+xml"
    ".txt" = "text/plain"
    ".webp" = "image/webp"
}

function Get-ContentType {
    param([string]$Path)
    $extension = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
    if ($contentTypes.ContainsKey($extension)) {
        return $contentTypes[$extension]
    }
    return "application/octet-stream"
}

function Resolve-RequestPath {
    param([string]$RawPath)

    $trimmed = $RawPath.TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($trimmed)) {
        $trimmed = "index.html"
    }

    $fullPath = Join-Path $Root $trimmed
    if ((Test-Path $fullPath) -and (Get-Item $fullPath).PSIsContainer) {
        $fullPath = Join-Path $fullPath "index.html"
    }

    return $fullPath
}

Write-Host "Serving $Root at http://localhost:$Port/"
Write-Host "Press Ctrl+C to stop."

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)

            $requestLine = $reader.ReadLine()
            if ([string]::IsNullOrWhiteSpace($requestLine)) {
                $client.Close()
                continue
            }

            while ($reader.ReadLine()) { }

            $parts = $requestLine.Split(' ')
            $method = $parts[0]
            $rawPath = if ($parts.Length -ge 2) { $parts[1] } else { "/" }
            $pathOnly = ($rawPath -split '\?')[0]
            $resolvedPath = Resolve-RequestPath -RawPath ([System.Uri]::UnescapeDataString($pathOnly))

            if ($method -ne "GET" -and $method -ne "HEAD") {
                $payload = [System.Text.Encoding]::UTF8.GetBytes("Method not allowed")
                $header = "HTTP/1.1 405 Method Not Allowed`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($payload.Length)`r`nConnection: close`r`n`r`n"
                $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
                $stream.Write($headerBytes, 0, $headerBytes.Length)
                $stream.Write($payload, 0, $payload.Length)
                continue
            }

            if (-not (Test-Path $resolvedPath)) {
                $payload = [System.Text.Encoding]::UTF8.GetBytes("Not found")
                $header = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($payload.Length)`r`nConnection: close`r`n`r`n"
                $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
                $stream.Write($headerBytes, 0, $headerBytes.Length)
                $stream.Write($payload, 0, $payload.Length)
                continue
            }

            $bytes = [System.IO.File]::ReadAllBytes($resolvedPath)
            $header = "HTTP/1.1 200 OK`r`nContent-Type: $(Get-ContentType -Path $resolvedPath)`r`nContent-Length: $($bytes.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
            $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
            $stream.Write($headerBytes, 0, $headerBytes.Length)
            if ($method -eq "GET") {
                $stream.Write($bytes, 0, $bytes.Length)
            }
        }
        finally {
            $client.Close()
        }
    }
}
finally {
    $listener.Stop()
}
