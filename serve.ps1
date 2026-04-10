$ErrorActionPreference = "Stop"

$port = 8123
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:$port/")
$listener.Start()

Write-Host "Serving $root at http://127.0.0.1:$port/"
Write-Host "Press Ctrl+C to stop."

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $relativePath = $context.Request.Url.AbsolutePath.TrimStart("/")
    if ([string]::IsNullOrWhiteSpace($relativePath)) {
      $relativePath = "index.html"
    }

    $safeRelativePath = $relativePath.Replace("/", [System.IO.Path]::DirectorySeparatorChar)
    $filePath = Join-Path $root $safeRelativePath

    if ((Test-Path $filePath -PathType Leaf) -and $filePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
      $extension = [System.IO.Path]::GetExtension($filePath).ToLowerInvariant()
      $contentType = switch ($extension) {
        ".html" { "text/html; charset=utf-8" }
        ".css" { "text/css; charset=utf-8" }
        ".js" { "application/javascript; charset=utf-8" }
        ".env" { "text/plain; charset=utf-8" }
        ".png" { "image/png" }
        default { "application/octet-stream" }
      }

      $bytes = [System.IO.File]::ReadAllBytes($filePath)
      $context.Response.StatusCode = 200
      $context.Response.ContentType = $contentType
      $context.Response.ContentLength64 = $bytes.Length

      if ($context.Request.HttpMethod -ne "HEAD") {
        $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      }
    } else {
      $context.Response.StatusCode = 404
    }

    $context.Response.Close()
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
