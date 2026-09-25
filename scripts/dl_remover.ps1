param(
  [Parameter(Mandatory=$true)]
  [string]$Model
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = (Resolve-Path (Join-Path $scriptDir "..")).Path

$map = @{
  "u2net"   = @{ Url = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx"; Dir = "server\storage\remover\u2net"; File = "u2net.onnx"; Total = 175997641 }
  "isnet"   = @{ Url = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx"; Dir = "server\storage\remover\isnet"; File = "isnet-general-use.onnx"; Total = 178648008 }
  "isnet-general-use" = @{ Url = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx"; Dir = "server\storage\remover\isnet"; File = "isnet-general-use.onnx"; Total = 178648008 }
  "silueta" = @{ Url = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/silueta.onnx"; Dir = "server\storage\remover\silueta"; File = "silueta.onnx"; Total = 44173029 }
}

$key = $Model.ToLower().Trim()
if (-not $map.ContainsKey($key)) {
  Write-Output "WAVES:ERROR Model remover tidak dikenal: $Model (pilih: u2net, isnet, silueta)"
  exit 1
}

$info = $map[$key]
$url = $info.Url
$dir = Join-Path $projectRoot $info.Dir
$out = Join-Path $dir $info.File
$total = $info.Total

Write-Output "WAVES:STAGE Remover $key - mengunduh ONNX..."
Write-Output "WAVES:LOG URL: $url"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

function Get-Len([string]$path) {
  $item = Get-Item $path -ErrorAction SilentlyContinue
  if ($null -eq $item) { return 0L }
  return [long]$item.Length
}

# If already complete, skip
$cur = Get-Len $out
if ($cur -ge $total -and $total -gt 0) {
  Write-Output "WAVES:LOG Sudah terpasang: $out ($cur bytes)"
  Write-Output "WAVES:DONE"
  exit 0
}

# Progress loop every 1s while curl downloads in background
# Use curl with resume -C -
Write-Output "WAVES:LOG Mulai download ke $out"
$lastUpdate = Get-Date
$attempt = 0
while ($true) {
  $cur = Get-Len $out
  if ($cur -ge $total) { break }
  if ((Get-Date) - $lastUpdate -ge (New-TimeSpan -Seconds 1)) {
    Write-Output ("WAVES:PROGRESS {0} {1}" -f $cur, $total)
    $lastUpdate = Get-Date
  }
  # Start or resume download (curl handles resume)
  # Use a job to allow progress polling, but simpler: blocking curl with retry, then loop check
  # We'll just call curl once with retry and break on success
  break
}

# Actual download - single blocking call with retry via curl flags
# We do one curl invocation; its file will be monitored by _poll_disk in setup.py as well
Write-Output ("WAVES:PROGRESS {0} {1}" -f (Get-Len $out), $total)
curl.exe --no-progress-meter --show-error -L -C - --retry 999 --retry-delay 5 --retry-all-errors --speed-time 60 --speed-limit 1024 -o $out $url
$code = $LASTEXITCODE

if ($code -ne 0) {
  Write-Output "WAVES:ERROR Download gagal (exit $code) untuk $key dari $url"
  exit $code
}

# Verify size
$final = Get-Len $out
if ($final -lt ($total * 0.95)) {
  Write-Output ("WAVES:ERROR Ukuran tidak sesuai: {0} < {1} (95%)" -f $final, $total)
  exit 1
}

Write-Output ("WAVES:LOG selesai: {0} ({1} bytes)" -f $out, $final)
Write-Output "WAVES:DONE"
