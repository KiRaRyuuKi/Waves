<#
.SYNOPSIS
.DESCRIPTION
.PARAMETER PythonPath
.PARAMETER Install
#>
param(
  [string]$PythonPath = "",
  [switch]$Install
)

$ErrorActionPreference = "Continue"

# ---------------------------------------------------------------------------
# Tentukan root proyek dan direktori penyimpanan wheel.
# ---------------------------------------------------------------------------
# Wheel 2.6GB disimpan di server/storage/torch/ agar tidak di-cache torch hub 
# tapi tetap persisten dan di-ignore git. New-Item -Force memastikan folder ada sebelum curl.
$PSScriptRootResolved = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = (Resolve-Path (Join-Path $PSScriptRootResolved "..")).Path
$dir = Join-Path $projectRoot "server\storage\torch"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

# ---------------------------------------------------------------------------
# Daftar wheel yang harus ada out, size, dan url mirror Aliyun.
# ---------------------------------------------------------------------------
# torchaudio 2.11.0+cu126 adalah pasangan yang cocok untuk torch 2.14.0+cu126,
# versi lain mismatch dan gagal import. Mirror mengurangi 429 dibanding download.pytorch.org.
$jobs = @(
  @{ out = Join-Path $dir "torchaudio-2.11.0+cu126-cp313-cp313-win_amd64.whl"; size = 1519625;
     url = "https://mirrors.aliyun.com/pytorch-wheels/cu126/torchaudio-2.11.0%2Bcu126-cp313-cp313-win_amd64.whl" },
  @{ out = Join-Path $dir "torch-2.14.0+cu126-cp313-cp313-win_amd64.whl"; size = 2602775157;
     url = "https://mirrors.aliyun.com/pytorch-wheels/cu126/torch-2.14.0%2Bcu126-cp313-cp313-win_amd64.whl" }
)

$knownTotal = 0L
foreach ($j in $jobs) { $knownTotal += [long]$j.size }

function Get-Len([string]$path) {
  $f = Get-Item $path -ErrorAction SilentlyContinue
  if ($null -eq $f) { return 0L }
  return [long]$f.Length
}

function Get-DoneTotal {
  $done = 0L
  foreach ($j in $jobs) {
    $len = Get-Len $j.out
    if ($len -gt [long]$j.size) { $len = [long]$j.size }
    $done += $len
  }
  return $done
}

# ---------------------------------------------------------------------------
# Invoke-WheelDownload, unduh satu wheel dengan resume dan chunk 30 detik.
# ---------------------------------------------------------------------------
# Wheel 2.6GB tanpa resume harus ulang dari nol bila putus di 99%. 
# Loop curl -C - --max-time 30, cek Get-Len, kirim WAVES:PROGRESS, retry bila belum lengkap.
function Invoke-WheelDownload($def) {
  $out = $def.out
  $size = [long]$def.size

  $attempts = 0
  while ($true) {
    $cur = Get-Len $out
    if ($cur -ge $size) {
      Write-Output ("WAVES:LOG selesai {0}" -f (Split-Path $out -Leaf))
      return
    }

    # Apa: Satu iterasi curl max 30 detik; `-C -` = lanjut byte yang belum ada.
    curl.exe --show-error -L -C - --retry 999 --retry-delay 5 --max-time 30 -o $out $def.url
    $cur = Get-Len $out

    $done = Get-DoneTotal
    Write-Output ("WAVES:PROGRESS {0} {1}" -f $done, $knownTotal)

    if ($cur -ge $size) {
      Write-Output ("WAVES:LOG selesai {0}" -f (Split-Path $out -Leaf))
      return
    }
    if ($attempts++ -gt 500) {
      Write-Output ("WAVES:ERROR Terlalu banyak percobaan untuk {0}" -f (Split-Path $out -Leaf))
      return
    }
    Start-Sleep -Seconds 2
  }
}

# =====================================================================
#  Bagian untuk unduh torch & torchaudio
# =====================================================================
# Iterasi semua wheel dan panggil Invoke-WheelDownload. 
# Torchaudio kecil dulu memberi feedback cepat bahwa koneksi OK sebelum unduh 2.6GB.
foreach ($j in $jobs) {
  Write-Output ("WAVES:STAGE Mengunduh {0}" -f (Split-Path $j.out -Leaf))
  Invoke-WheelDownload $j
}

# =====================================================================
#  Bagian untuk install torch & torchaudio ke venv proyek dan Python pilihan user.
# =====================================================================
# Backend jalan dari venv, jadi torch wajib ada di sana. 
# Deteksi venvPy dari 2 kandidat, gabung dengan PythonPath menjadi targets unik, 
# pip install --no-cache-dir tiap target agar tidak gandakan disk 2.6GB, 
# lalu verifikasi torch.cuda.is_available() supaya tahu GPU terdeteksi.
if ($Install) {
  if (-not $PythonPath) {
    Write-Output "WAVES:ERROR -Install dipakai tapi -PythonPath kosong (target python wajib diisi)."
    exit 1
  }
  if (-not (Test-Path $PythonPath)) {
    Write-Output ("WAVES:ERROR Python tidak ditemukan: {0}" -f $PythonPath)
    exit 1
  }

  Write-Output "WAVES:STAGE Menyiapkan target install..."

  # Cari venv proyek selalu dipasang, bukan opsional.
  $venvPy = $null
  foreach ($cand in @(
    (Join-Path $projectRoot ".venv\Scripts\python.exe"),
    (Join-Path $projectRoot "venv\Scripts\python.exe")
  )) {
    if (Test-Path $cand) { $venvPy = $cand; break }
  }
  if (-not $venvPy) {
    Write-Output "WAVES:ERROR venv proyek tidak ditemukan (.venv atau venv). Jalankan `python -m venv .venv` dulu."
    exit 1
  }

  # Gabung target dan hindari install dua kali bila user pilih venv yang sama.
  $targets = @($PythonPath)
  if ($venvPy -notin $targets) { $targets += $venvPy }

  $wheels = @($jobs | ForEach-Object { $_.out })

  foreach ($t in $targets) {
    $envName = if ($t -eq $venvPy) { "venv proyek" } else { $t }
    Write-Output ("WAVES:STAGE Memasang torch ke {0}..." -f $envName)
    & $t -m pip install --upgrade --no-cache-dir @wheels 2>&1
    if ($LASTEXITCODE -ne 0) {
      Write-Output ("WAVES:ERROR pip install gagal di {0} (exit {1})" -f $envName, $LASTEXITCODE)
      exit $LASTEXITCODE
    }

    # Verifikasi import torch dan cek CUDA agar tahu GPU terdeteksi atau fallback CPU.
    $check = & $t -c "import torch; print('cuda=' + str(torch.cuda.is_available()))" 2>&1
    Write-Output ("WAVES:LOG verifikasi ({0}): {1}" -f $envName, ($check -join " | "))
  }
}

Write-Output "WAVES:DONE"
