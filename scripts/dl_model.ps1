param(
  [Parameter(Mandatory=$true)]
  [string]$RepoId,
  # Satu string, pola dipisah koma/titik-koma. (PowerShell -File tidak bisa
  # mengikat parameter array, jadi jangan pakai [string[]] di sini.)
  [string]$Exclude = "",
  # Nama folder tujuan di server/storage/<Base>/<Folder>/. Default: segmen
  # terakhir RepoId (mis. 'Lykon/DreamShaper' -> 'DreamShaper'). Override
  # dipakai untuk nama folder yang konsisten di storage.
  [string]$Folder = "",
  # Root tujuan relatif project root (mis. 'server\storage\generate\video'). Default
  # 'server\storage\generate\image' (model gambar). Dipakai task model video agar
  # terunduh ke storage/generate/video/ tanpa mengotori folder image SD.
  [string]$Base = "server\storage\generate\image",
  # Ikut sertakan file BUKAN .json di root repo (mis. checkpoint .safetensors
  # yang persis di root, khas repo transformers/CLIP & motion module).
  # Default false: hanya file .json di root yang diambil (layout diffusers).
  [switch]$KeepRoot
)

$ErrorActionPreference = "Continue"

# Saat stdout di-redirect (spawn dari backend), rendering progress bar
# bawaan PS 5.x bikin Invoke-RestMethod sangat lambat seperti hang.
$ProgressPreference = "SilentlyContinue"

$excludePatterns = @()
if ($Exclude) {
  $excludePatterns = $Exclude -split '[,;]' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = (Resolve-Path (Join-Path $scriptDir "..")).Path
$modelName = ($RepoId -split "/")[-1]
if (-not $Folder) { $Folder = $modelName }
$root = Join-Path $projectRoot (Join-Path $Base $Folder)
New-Item -ItemType Directory -Force -Path $root | Out-Null

$baseUrl = "https://huggingface.co/$RepoId/resolve/main"

# --- Fetch file tree recursively via HuggingFace API ---
$script:hfFiles = @()

# Panggil API HF dengan retry + backoff (429 Too Many Requests umum
# untuk unduhan publik). Berhenti coba setelah 10 attempt.
function Get-HFJson([string]$url) {
  $attempt = 0
  while ($true) {
    $attempt++
    try {
      return Invoke-RestMethod -Uri $url -TimeoutSec 30
    } catch {
      $msg = $_.Exception.Message
      $is429 = $msg -match "429|Too Many Requests"
      $retryAfter = $null
      if ($_.Exception.Response) {
        $retryAfter = $_.Exception.Response.Headers["Retry-After"]
      }
      Write-Output ("WAVES:LOG HF API error attempt {0}: {1}" -f $attempt, $msg)
      if ($attempt -ge 10) { throw }
      if ($is429 -and $retryAfter) { $wait = [math]::Min([int]$retryAfter + 1, 60) }
      elseif ($is429) { $wait = [math]::Min(5 * $attempt, 60) }
      else { $wait = 2 }
      Start-Sleep -Seconds $wait
    }
  }
}

function Get-HFFiles([string]$apiPath) {
  $url = "https://huggingface.co/api/models/$RepoId/tree/main/$apiPath"
  try {
    $resp = Get-HFJson $url
  } catch {
    Write-Output ("WAVES:LOG Gagal mengambil daftar dari {0}: {1}" -f $apiPath, $_.Exception.Message)
    return
  }
  foreach ($item in $resp) {
    # API tree HF mengembalikan field "path" (bukan "name").
    $leaf = Split-Path $item.path -Leaf
    if ($item.type -eq "file" -and $item.size -gt 0) {
      $rel = $item.path
      $skip = $false
      # Di root repo, hanya ambil file konfigurasi; lewati checkpoint/ckpt-
      # safetensors raksasa & gambar yang biasanya cuma pelengkap di root.
      # (kecuali -KeepRoot disertakan — task yang butuh file non-json di root,
      # seperti motion module AnimateDiff & CLIP vision, memakainya.)
      if ($apiPath -eq "" -and $leaf -notlike "*.json" -and -not $KeepRoot) { $skip = $true }
      foreach ($pat in $excludePatterns) {
        if ($leaf -like $pat) { $skip = $true; break }
      }
      if (-not $skip) {
        $script:hfFiles += @{ rel = $rel; size = [long]$item.size }
      }
    } elseif ($item.type -eq "directory") {
      $sub = $item.path
      Start-Sleep -Milliseconds 400
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
    # Update total progress tiap detik supaya UI live
    $lastUpdate = 0
    while ($true) {
      $cur = Get-Len $out
      if ($cur -ge $size) { break }
      
      # Report progres tiap ~1 detik
      if ((Get-Date).AddMilliseconds(-1000) -ge $lastUpdate) {
         $doneTotal = Get-CurBytes
         Write-Output ("WAVES:PROGRESS {0} {1}" -f $doneTotal, $KNOWN_TOTAL)
         $lastUpdate = Get-Date
      }

      curl.exe --no-progress-meter --show-error -L -C - --retry 999 --retry-delay 5 --retry-all-errors --speed-time 60 --speed-limit 1024 -o $out "$baseUrl/$($fileDef.rel)"
      if ($LASTEXITCODE -eq 0) { break }
      
      Start-Sleep -Seconds 2
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
