param(
  [string]$PythonPath = "",
  [switch]$Install
)

$ErrorActionPreference = "Continue"

# ---------- Anchor path ke root proyek ----------
$PSScriptRootResolved = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = (Resolve-Path (Join-Path $PSScriptRootResolved "..")).Path
$dir = Join-Path $projectRoot "server\storage\torch"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

# url  = rangkaian curl (with resume manual via -C -).
# torchaudio 2.11.0 = versi yang tersedia & cocok dengan wheel torch 2.14.0 di mirror Aliyun.
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

# ---------- Unduh satu wheel (resume + chunk ~30 detik untuk progres) ----------
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

    # satu iterasi curl maks ~30 detik; "-C -" => lanjut byte yang belum ada
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
#  Bagian 1 — unduh torch & torchaudio
# =====================================================================
foreach ($j in $jobs) {
  Write-Output ("WAVES:STAGE Mengunduh {0}" -f (Split-Path $j.out -Leaf))
  Invoke-WheelDownload $j
}

# =====================================================================
#  Bagian 2 — install torch & torchaudio
#  Selalu ke venv proyek (backend) + ke Python pilihan user (jika beda).
# =====================================================================
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

  # Target 1: venv proyek (yang menjalankan backend Waves) — SELALU dipasang.
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

  # Target 2: Python pilihan user (kalau sama dengan venv, jangan dua kali).
  $targets = @($PythonPath)
  if ($venvPy -notin $targets) { $targets += $venvPy }

  $wheels = @($jobs | ForEach-Object { $_.out })

  foreach ($t in $targets) {
    $envName = if ($t -eq $venvPy) { "venv proyek" } else { $t }
    Write-Output ("WAVES:STAGE Memasang torch ke {0}…" -f $envName)
    & $t -m pip install --upgrade --no-cache-dir @wheels 2>&1
    if ($LASTEXITCODE -ne 0) {
      Write-Output ("WAVES:ERROR pip install gagal di {0} (exit {1})" -f $envName, $LASTEXITCODE)
      exit $LASTEXITCODE
    }

    # verifikasi import supaya tahu GPU di aktifkan atau tidak
    $check = & $t -c "import torch; print('cuda=' + str(torch.cuda.is_available()))" 2>&1
    Write-Output ("WAVES:LOG verifikasi ({0}): {1}" -f $envName, ($check -join " | "))
  }
}

Write-Output "WAVES:DONE"
