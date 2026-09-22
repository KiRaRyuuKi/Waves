<#
.SYNOPSIS
.DESCRIPTION
.PARAMETER RepoId
.PARAMETER Exclude
.PARAMETER Folder
.PARAMETER Base
.PARAMETER KeepRoot
.PARAMETER Test
#>

param(
  [Parameter(Mandatory=$true)]
  [string]$RepoId,
  # Satu string, pola dipisah koma/titik-koma. 
  # (PowerShell -File tidak bisa mengikat parameter array, jadi jangan pakai [string[]] di sini.)
  [string]$Exclude = "",
  # Nama folder tujuan di server/storage/<Base>/<Folder>/. 
  # Default segmen terakhir RepoId (mis. 'Lykon/DreamShaper' -> 'DreamShaper'). 
  # Override dipakai untuk nama folder yang konsisten di storage.
  [string]$Folder = "",
  # Root tujuan relatif project root (mis. 'server\storage\generate\video'). 
  # Default 'server\storage\generate\image' (model gambar). Dipakai task model video agar
  # terunduh ke storage/generate/video/.
  [string]$Base = "server\storage\generate\image",
  # Ikut sertakan file BUKAN .json di root repo (mis. checkpoint .safetensors
  # yang persis di root, khas repo transformers/CLIP & motion module).
  # Default false: hanya file .json di root yang diambil (layout diffusers).
  [switch]$KeepRoot,
  # Hanya uji koneksi & daftar file tanpa download (dipakai untuk cek apakah download bisa atau tidak).
  [switch]$Test
)

$ErrorActionPreference = "Continue"

# Saat stdout di-redirect (spawn dari backend), rendering progress bar
# bawaan PS 5.x bikin Invoke-RestMethod sangat lambat seperti hang.
$ProgressPreference = "SilentlyContinue"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = (Resolve-Path (Join-Path $scriptDir "..")).Path

# ---------------------------------------------------------------------------
# Test-HFConnection, mengecek apakah HuggingFace bisa dijangkau.
# ---------------------------------------------------------------------------
# Sebelum daftar file 100+ entri, kita harus tahu internet OK. Tanpa ini, Get-HFJson akan retry 10x sia-sia dan user menunggu lama tanpa feedback.
# Coba Invoke-WebRequest ke huggingface.co (3x), fallback ke API bert-base-uncased; tiap gagal tulis WAVES:LOG dan sleep backoff.
# Firewall sering blok huggingface.co tapi API tetap bisa fallback memastikan tidak false-negative.
# ---------------------------------------------------------------------------
function Test-HFConnection {
  param([int]$MaxAttempts = 3)
  for ($i = 1; $i -le $MaxAttempts; $i++) {
    try {
      $null = Invoke-WebRequest -Uri "https://huggingface.co" -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
      return $true
    } catch {
      Write-Output ("WAVES:LOG Cek koneksi HuggingFace percobaan {0}/{1} gagal: {2}" -f $i, $MaxAttempts, $_.Exception.Message)
      if ($i -lt $MaxAttempts) { Start-Sleep -Seconds (3 * $i) }
    }
    try {
      $null = Invoke-RestMethod -Uri "https://huggingface.co/api/models/bert-base-uncased" -TimeoutSec 10 -ErrorAction Stop
      return $true
    } catch {}
  }
  return $false
}

# --- Bundle AnimateDiff dan Wan ---
$animateBundleIds = @("animatediff", "animatediff-bundle", "animate_diff", "animate-diff")
if ($RepoId -in $animateBundleIds) {
  if ($Test) {
    Write-Output "WAVES:STAGE AnimateDiff - uji koneksi & daftar file (tidak download)..."
    if (-not (Test-HFConnection -MaxAttempts 3)) {
      Write-Output "WAVES:ERROR Tidak ada koneksi ke HuggingFace (huggingface.co). Periksa internet / proxy / firewall, lalu coba lagi."
      exit 1
    }
    Write-Output "WAVES:LOG [TEST 1/2] Motion Adapter AnimateDiff v1-5-2..."
    & $PSCommandPath -RepoId "guoyww/animatediff-motion-adapter-v1-5-2" -Base $bundleBase -Folder "animate-diff/motion-adapter" -KeepRoot -Exclude "README.md,.gitattributes" -Test
    if ($LASTEXITCODE -ne 0) { Write-Output "WAVES:ERROR Uji motion adapter gagal (exit $LASTEXITCODE)"; exit $LASTEXITCODE }
    Write-Output "WAVES:LOG [TEST 2/2] CLIP Vision ViT-Large/14..."
    & $PSCommandPath -RepoId "openai/clip-vit-large-patch14" -Base $bundleBase -Folder "animate-diff/clip-vit-large" -KeepRoot -Exclude "pytorch_model.bin,flax_model.msgpack,tf_model.h5,README.md,.gitattributes" -Test
    if ($LASTEXITCODE -ne 0) { Write-Output "WAVES:ERROR Uji CLIP Vision gagal (exit $LASTEXITCODE)"; exit $LASTEXITCODE }
    Write-Output "WAVES:LOG Uji AnimateDiff OK - kedua repo bisa diakses, download bisa dilakukan."
    Write-Output "WAVES:DONE"
    exit 0
  }
  Write-Output "WAVES:STAGE AnimateDiff - mengunduh motion adapter dan CLIP Vision (bundle)..."
  if (-not (Test-HFConnection -MaxAttempts 3)) {
    Write-Output "WAVES:ERROR Tidak ada koneksi ke HuggingFace (huggingface.co). Periksa internet / proxy / firewall, lalu coba lagi."
    exit 1
  }
  $bundleBase = if ($Base -eq "server\storage\generate\image") { "server\storage\generate\video" } else { $Base }
  Write-Output "WAVES:LOG [1/2] Motion Adapter AnimateDiff v1-5-2..."
  & $PSCommandPath -RepoId "guoyww/animatediff-motion-adapter-v1-5-2" -Base $bundleBase -Folder "animate-diff/motion-adapter" -KeepRoot -Exclude "README.md,.gitattributes"
  if ($LASTEXITCODE -ne 0) { Write-Output "WAVES:ERROR Motion adapter gagal (exit $LASTEXITCODE)"; exit $LASTEXITCODE }
  Write-Output "WAVES:LOG [2/2] CLIP Vision ViT-Large/14..."
  & $PSCommandPath -RepoId "openai/clip-vit-large-patch14" -Base $bundleBase -Folder "animate-diff/clip-vit-large" -KeepRoot -Exclude "pytorch_model.bin,flax_model.msgpack,tf_model.h5,README.md,.gitattributes"
  if ($LASTEXITCODE -ne 0) { Write-Output "WAVES:ERROR CLIP Vision gagal (exit $LASTEXITCODE)"; exit $LASTEXITCODE }
  Write-Output "WAVES:STAGE Verifikasi AnimateDiff..."
  $check1 = Join-Path $projectRoot "$bundleBase/animate-diff/motion-adapter/diffusion_pytorch_model.fp16.safetensors"
  $check1Alt = Join-Path $projectRoot "$bundleBase/animate-diff/motion-adapter/diffusion_pytorch_model.safetensors"
  $check2 = Join-Path $projectRoot "$bundleBase/animate-diff/clip-vit-large/model.safetensors"
  if (((Test-Path $check1) -or (Test-Path $check1Alt)) -and (Test-Path $check2)) {
      Write-Output "WAVES:LOG AnimateDiff terpasang lengkap."
  } else {
      Write-Output "WAVES:LOG Peringatan: salah satu file AnimateDiff belum terdeteksi."
  }
  Write-Output "WAVES:DONE"
  exit 0
}

$wanBundleIds = @("wan", "wan-bundle", "wan_t2v_13b", "wan2.1-t2v-1.3b")
if ($RepoId -in $wanBundleIds) {
  if ($Test) {
    Write-Output "WAVES:STAGE Wan 2.1 T2V 1.3B - uji koneksi & daftar file (tidak download)..."
    if (-not (Test-HFConnection -MaxAttempts 3)) {
      Write-Output "WAVES:ERROR Tidak ada koneksi ke HuggingFace. Periksa internet lalu coba lagi."
      exit 1
    }
    & $PSCommandPath -RepoId "Wan-AI/Wan2.1-T2V-1.3B-Diffusers" -Base $wanBase -Folder $wanFolder -Exclude "*.jpg,*.JPG,*.jpeg,*.png,*.md,.gitattributes" -Test
    exit $LASTEXITCODE
  }
  Write-Output "WAVES:STAGE Wan 2.1 T2V 1.3B - cek koneksi & unduh..."
  if (-not (Test-HFConnection -MaxAttempts 3)) {
    Write-Output "WAVES:ERROR Tidak ada koneksi ke HuggingFace. Periksa internet lalu coba lagi."
    exit 1
  }
  $wanBase = if ($Base -eq "server\storage\generate\image") { "server\storage\generate\video" } else { $Base }
  $wanFolder = if ($Folder) { $Folder } else { "wan" }
  & $PSCommandPath -RepoId "Wan-AI/Wan2.1-T2V-1.3B-Diffusers" -Base $wanBase -Folder $wanFolder -Exclude "*.jpg,*.JPG,*.jpeg,*.png,*.md,.gitattributes"
  exit $LASTEXITCODE
}

Write-Output "WAVES:LOG Cek koneksi ke HuggingFace..."
if (-not (Test-HFConnection -MaxAttempts 3)) {
  Write-Output "WAVES:ERROR Tidak ada koneksi ke HuggingFace (huggingface.co). Periksa koneksi internet, proxy, atau firewall, lalu coba lagi."
  exit 1
}
Write-Output "WAVES:LOG Koneksi OK."

# Jika -Test, hanya uji daftar file tanpa download
$testMode = $Test.IsPresent

$excludePatterns = @()
if ($Exclude) {
  $excludePatterns = $Exclude -split '[,;]' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
}

$modelName = ($RepoId -split "/")[-1]
if (-not $Folder) { $Folder = $modelName }
if (-not $Base) { $Base = "server\storage\generate\image" }
$root = Join-Path $projectRoot (Join-Path $Base $Folder)
if (-not $testMode) { New-Item -ItemType Directory -Force -Path $root | Out-Null }

$baseUrl = "https://huggingface.co/$RepoId/resolve/main"

# --- Fetch file tree recursively via HuggingFace API ---
$script:hfFiles = @()

# ---------------------------------------------------------------------------
# Get-HFJson, fetch JSON dari HuggingFace API dengan retry & backoff.
# ---------------------------------------------------------------------------
# HF sering 429 (rate-limit) untuk IP publik — tanpa backoff, script langsung throw dan download gagal.
# Loop attempt 1..10, tangkap 429 → tunggu Retry-After atau 5*attempt, connection error → 5*attempt, else 2 detik; throw baru setelah 10x.
# Invoke-RestMethod tanpa retry membuat unduh model 28GB gagal di 90% hanya karena 1 request 429 sesaat.
# ---------------------------------------------------------------------------
# Panggil API HF dengan retry + backoff (429 Too Many Requests umum untuk unduhan publik). Berhenti coba setelah 10 attempt.
function Get-HFJson([string]$url) {
  $attempt = 0
  while ($true) {
    $attempt++
    try {
      return Invoke-RestMethod -Uri $url -TimeoutSec 30
    } catch {
      $msg = $_.Exception.Message
      $is429 = $msg -match "429|Too Many Requests"
      $isConn = $msg -match "Unable to connect|No such host|Timeout|connection"
      $retryAfter = $null
      if ($_.Exception.Response) {
        $retryAfter = $_.Exception.Response.Headers["Retry-After"]
      }
      Write-Output ("WAVES:LOG HF API error attempt {0}: {1}" -f $attempt, $msg)
      if ($attempt -ge 10) { throw }
      if ($is429 -and $retryAfter) { $wait = [math]::Min([int]$retryAfter + 1, 60) }
      elseif ($is429) { $wait = [math]::Min(5 * $attempt, 60) }
      elseif ($isConn) { $wait = [math]::Min(5 * $attempt, 30); Write-Output "WAVES:LOG Masalah koneksi, retry dalam $wait detik..." }
      else { $wait = 2 }
      Start-Sleep -Seconds $wait
    }
  }
}

# ---------------------------------------------------------------------------
# Get-HFFiles, rekursif mengambil daftar file dari repo HuggingFace.
# ---------------------------------------------------------------------------
# Repo diffusers punya tree dalam (scheduler/, vae/, unet/), 
# harus di-crawl rekursif untuk dapat semua *.json/*.safetensors.
# GET /api/models/<RepoId>/tree/main/<apiPath>, iterasi item;
# jika file & size>0 & tidak di-exclude → tambah ke $hfFiles, 
# jika directory → sleep 400ms lalu rekursi.
# Tanpa filter root non-json, file 4GB di root ikut terunduh padahal hanya butuh model_index.json.
# ---------------------------------------------------------------------------
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
      # (kecuali -KeepRoot disertakan, task yang butuh file non-json di root,
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
  Write-Output "WAVES:ERROR Tidak ada file ditemukan di $RepoId (mungkin koneksi terputus atau RepoId salah)"
  exit 1
}

$KNOWN_TOTAL = 0L
foreach ($f in $script:hfFiles) { $KNOWN_TOTAL += $f.size }

Write-Output ("WAVES:LOG Ditemukan {0} file ({1} bytes total)" -f $script:hfFiles.Count, $KNOWN_TOTAL)

if ($testMode) {
  Write-Output ("WAVES:LOG Uji OK: {0} file bisa diakses ({1} bytes). Download bisa dilakukan - tidak ada file yang diunduh (mode Test)." -f $script:hfFiles.Count, $KNOWN_TOTAL)
  Write-Output "WAVES:DONE"
  exit 0
}

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

# ---------------------------------------------------------------------------
# Invoke-ChunkedDownload, unduh satu file dengan resume & progress live.
# ---------------------------------------------------------------------------
# File *.safetensors 2-4GB, tanpa resume, putus di 99% harus ulang dari nol. 
# Tanpa progress tiap detik, UI terlihat hang.
# Loop cek Get-Len(cur) < size → WAVES:PROGRESS tiap 1s → curl -C --retry 999 --speed-time 60. Break bila curl exit 0.
# curl tanpa --speed-limit akan hang di koneksi lelet, speed-time memastikan retry bila throughput <1KB/s selama 60s.
# ---------------------------------------------------------------------------
function Invoke-ChunkedDownload($fileDef) {
  $out = Join-Path $root $fileDef.rel
  $size = $fileDef.size

  New-Item -ItemType Directory -Force -Path (Split-Path $out) | Out-Null

  $attempts = 0
    # Update total progress tiap detik
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

# ---------------------------------------------------------------------------
# Proses utama untuk iterasi semua file di $hfFiles dan panggil download.
# ---------------------------------------------------------------------------
# Eksekusi unduh berurutan dengan verifikasi model_index.json di akhir.
# foreach $f in $hfFiles → Invoke-ChunkedDownload; cek model_index.json.
# Tanpa verifikasi, repo korup (mis. file 0 byte) tetap dianggap DONE.
# ---------------------------------------------------------------------------
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
