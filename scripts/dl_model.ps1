param(
  [Parameter(Mandatory=$true)]
  [string]$RepoId,
  [string[]]$Exclude = @()
)

$ErrorActionPreference = "Continue"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = (Resolve-Path (Join-Path $scriptDir "..")).Path
$modelName = ($RepoId -split "/")[-1]
$root = Join-Path $projectRoot "server\storage\diffusers\$modelName"
New-Item -ItemType Directory -Force -Path $root | Out-Null

$baseUrl = "https://huggingface.co/$RepoId/resolve/main"

# --- Fetch file tree recursively via HuggingFace API ---
$script:hfFiles = @()

function Get-HFFiles([string]$apiPath) {
  $url = "https://huggingface.co/api/models/$RepoId/tree/main/$apiPath"
  try {
    $resp = Invoke-RestMethod -Uri $url -TimeoutSec 30
  } catch {
    Write-Output ("WAVES:LOG Gagal mengambil daftar dari {0}: {1}" -f $apiPath, $_.Exception.Message)
    return
  }
  foreach ($item in $resp) {
    if ($item.type -eq "file" -and $item.size -gt 0) {
      $rel = "$apiPath/$($item.name)".TrimStart("/")
      $skip = $false
      # Di root repo, hanya ambil file konfigurasi; lewati checkpoint/ckpt-
      # safetensors raksasa & gambar yang biasanya cuma pelengkap di root.
      if ($apiPath -eq "" -and $item.name -notlike "*.json") { $skip = $true }
      foreach ($pat in $Exclude) {
        if ($item.name -like $pat) { $skip = $true; break }
      }
      if (-not $skip) {
        $script:hfFiles += @{ rel = $rel; size = [long]$item.size }
      }
    } elseif ($item.type -eq "directory") {
      $sub = "$apiPath/$($item.name)".TrimStart("/")
      Get-HFFiles $sub
    }
  }
}

Write-Output ("WAVES:STAGE Mengambil daftar file dari HuggingFace...")
Get-HFFiles ""

if ($script:hfFiles.Count -eq 0) {
  Write-Output "WAVES:ERROR Tidak ada file ditemukan di $RepoId"
  exit 1
}

$KNOWN_TOTAL = 0L
foreach ($f in $script:hfFiles) { $KNOWN_TOTAL += $f.size }

Write-Output ("WAVES:LOG Ditemukan {0} file ({1} bytes total)" -f $script:hfFiles.Count, $KNOWN_TOTAL)

# --- Helpers ---
function Get-Len([string]$path) {
  $item = Get-Item $path -ErrorAction SilentlyContinue
  if ($null -eq $item) { return 0L }
  return [long]$item.Length
}

function Get-CurBytes {
  $sum = 0L
  foreach ($f in $script:hfFiles) {
    $out = Join-Path $root $f.rel
    $cur = Get-Len $out
    if ($cur -gt $f.size) { $cur = $f.size }
    $sum += $cur
  }
  return $sum
}

function Invoke-ChunkedDownload($fileDef) {
  $out = Join-Path $root $fileDef.rel
  $size = $fileDef.size

  New-Item -ItemType Directory -Force -Path (Split-Path $out) | Out-Null

  $attempts = 0
  while ($true) {
    $cur = Get-Len $out
    $doneTotal = Get-CurBytes
    Write-Output ("WAVES:PROGRESS {0} {1}" -f $doneTotal, $KNOWN_TOTAL)

    if ($cur -ge $size) { break }

    curl.exe --show-error -L -C - --retry 999 --retry-delay 5 --max-time 8 -o $out "$baseUrl/$($fileDef.rel)"
    if ($LASTEXITCODE -ne 0) {
      $attempts++
      if ($attempts -gt 500) {
        Write-Output ("WAVES:ERROR Terlalu banyak percobaan untuk {0}" -f $fileDef.rel)
        return
      }
      Start-Sleep -Seconds 2
      continue
    }

    if ((Get-Len $out) -ge $size) { break }
    $attempts++
    Start-Sleep -Seconds 1
  }
  Write-Output ("WAVES:LOG selesai: {0}" -f $fileDef.rel)
}

# --- Process ---
Write-Output ("WAVES:STAGE Mengunduh model dari $RepoId")
foreach ($f in $script:hfFiles) {
  Invoke-ChunkedDownload $f
}

Write-Output ("WAVES:STAGE Verifikasi model...")
if (Test-Path (Join-Path $root "model_index.json")) {
  Write-Output ("WAVES:LOG Model pipeline terdeteksi: model_index.json ditemukan")
} else {
  Write-Output ("WAVES:LOG Catatan: model_index.json tidak ditemukan, mungkin format checkpoint tunggal")
}

Write-Output ("WAVES:STAGE Selesai")
Write-Output "WAVES:DONE"
