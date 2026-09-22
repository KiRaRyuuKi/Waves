<#
.SYNOPSIS
.DESCRIPTION
.PARAMETER Model
#>
param(
  [ValidateSet("htdemucs", "htdemucs_ft", "mdx_extra")]
  [string]$Model = "htdemucs"
)

$ErrorActionPreference = "Continue"

# ---------------------------------------------------------------------------
# Tentukan direktori cache torch hub dan lokasi yang dibaca Demucs secara native.
# ---------------------------------------------------------------------------
# Demucs tidak mencari di server/storage/ tapi di ~/.cache/torch/hub/checkpoints/.
# Salah folder membuat Demucs tetap coba unduh ulang meski file sudah ada.
# Join-Path $HOME bersama New-Item -Force memastikan folder ada sebelum curl.
$cacheDir = Join-Path $HOME ".cache\torch\hub\checkpoints"
New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null

$baseUrl = "https://dl.fbaipublicfiles.com/demucs"

# ---------------------------------------------------------------------------
# Tabel job di setiap entri berisi name, url, dan size untuk verifikasi.
# ---------------------------------------------------------------------------
# Nama file hash adalah kunci cache, size dipakai untuk hitung KNOWN_TOTAL dan WAVES:PROGRESS. 
# htdemucs_ft butuh 4 file, jika salah jumlah model tetap dianggap belum terpasang oleh separator.
$jobs = @{
  htdemucs = @(
    @{ name = "955717e8-8726e21a.th"; url = "hybrid_transformer/955717e8-8726e21a.th"; size = 84141911 }
  )
  htdemucs_ft = @(
    @{ name = "f7e0c4bc-ba3fe64a.th"; url = "hybrid_transformer/f7e0c4bc-ba3fe64a.th"; size = 84141271 },
    @{ name = "d12395a8-e57c48e6.th"; url = "hybrid_transformer/d12395a8-e57c48e6.th"; size = 84141271 },
    @{ name = "92cfc3b6-ef3bcb9c.th"; url = "hybrid_transformer/92cfc3b6-ef3bcb9c.th"; size = 84141271 },
    @{ name = "04573f0d-f3cf25b2.th"; url = "hybrid_transformer/04573f0d-f3cf25b2.th"; size = 84141271 }
  )
  mdx_extra = @(
    @{ name = "e51eebcc-c1b80bdd.th"; url = "mdx_final/e51eebcc-c1b80bdd.th"; size = 167399275 },
    @{ name = "a1d90b5c-ae9d2452.th"; url = "mdx_final/a1d90b5c-ae9d2452.th"; size = 167391595 },
    @{ name = "5d2d6c55-db83574e.th"; url = "mdx_final/5d2d6c55-db83574e.th"; size = 167391595 },
    @{ name = "cfa93e08-61801ae1.th"; url = "mdx_final/cfa93e08-61801ae1.th"; size = 167399275 }
  )
}[$Model]

# Hitung total bytes untuk model terpilih agar WAVES:PROGRESS bisa hitung persen dan ETA.
$knownTotal = 0L
foreach ($j in $jobs) { $knownTotal += [long]$j.size }

# ---------------------------------------------------------------------------
# Get-Len, cek ukuran file yang sudah ada (0 bila belum).
# ---------------------------------------------------------------------------
# Untuk resume kita perlu tahu cur bytes agar curl -C - lanjut dari posisi yang
# benar dan tidak mengunduh ulang dari nol.
function Get-Len([string]$path) {
  $f = Get-Item $path -ErrorAction SilentlyContinue
  if ($null -eq $f) { return 0L }
  return [long]$f.Length
}

# ---------------------------------------------------------------------------
# Get-DoneTotal, hitung total bytes yang sudah terunduh.
# ---------------------------------------------------------------------------
# Clamp ke size bila kelebihan byte karena retry, agar done tidak melebihi total
# dan bar progress tidak lewat 100%.
function Get-DoneTotal {
  $done = 0L
  foreach ($j in $jobs) {
    $len = Get-Len (Join-Path $cacheDir $j.name)
    if ($len -gt [long]$j.size) { $len = [long]$j.size }
    $done += $len
  }
  return $done
}

# ---------------------------------------------------------------------------
# Invoke-CheckpointDownload, unduh satu checkpoint dengan resume dan chunk pendek.
# ---------------------------------------------------------------------------
# File 80-167MB jika curl sekali jalan tanpa chunk, UI hanya update setelah
# selesai dan terlihat hang. Loop cek cur, kirim WAVES:PROGRESS tiap 1 detik,
# lalu curl -C - --max-time 5 selama 5 detik, sleep 200ms dan ulang. Pakai
# curl.exe native karena Invoke-WebRequest lambat saat stdout di-redirect.
function Invoke-CheckpointDownload($def) {
  $out = Join-Path $cacheDir $def.name
  $size = [long]$def.size

  $attempts = 0
  $lastUpdate = 0
  $nextRun = Get-Date
  while ($true) {
    $cur = Get-Len $out
    if ($cur -ge $size) {
      Write-Output ("WAVES:LOG selesai {0}" -f $def.name)
      return
    }

    # Report progres tiap 1 detik supaya bar di SetupModal naik terus dan user dapat feedback konstan.
    if ((Get-Date).AddMilliseconds(-1000) -ge $lastUpdate) {
      $done = Get-DoneTotal
      Write-Output ("WAVES:PROGRESS {0} {1}" -f $done, $knownTotal)
      $lastUpdate = Get-Date
    }

    # Unduh dalam chunk pendek 5 detik dengan resume agar WAVES:PROGRESS bisa dilaporkan di antara chunk.
    if ((Get-Date) -ge $nextRun) {
      $nextRun = (Get-Date).AddMilliseconds(5500)
      curl.exe --no-progress-meter --show-error -L -C - --max-time 5 -o $out "$baseUrl/$($def.url)"
    }

    if ((Get-Date).AddMilliseconds(-1000) -ge $lastUpdate) {
      $done = Get-DoneTotal
      Write-Output ("WAVES:PROGRESS {0} {1}" -f $done, $knownTotal)
      $lastUpdate = Get-Date
    }

    if ($attempts++ -gt 2000) {
      Write-Output ("WAVES:ERROR Terlalu banyak percobaan untuk {0}" -f $def.name)
      return
    }
    Start-Sleep -Milliseconds 200
  }
}

# ---------------------------------------------------------------------------
# Proses utama untuk iterasi semua file dalam jobs untuk model terpilih.
# ---------------------------------------------------------------------------
# Satu model bisa 1 atau 4 file, harus semua lengkap sebelum Demucs bisa dipakai.
Write-Output ("WAVES:STAGE Mengunduh bobot Demucs ({0})..." -f $Model)
foreach ($j in $jobs) {
  Invoke-CheckpointDownload $j
}

# Verifikasi dan pastikan semua file ukurannya sesuai ekspektasi.
# File setengah terunduh tidak boleh dianggap sukses, tanpa cek ini separator.py
# akan error unexpected EOF saat load checkpoint.
Write-Output "WAVES:STAGE Verifikasi file..."
$missing = @($jobs | Where-Object { (Get-Len (Join-Path $cacheDir $_.name)) -lt [long]$_.size })
if ($missing.Count -gt 0) {
  Write-Output ("WAVES:ERROR File belum lengkap: {0}" -f (($missing | ForEach-Object { $_.name }) -join ", "))
  exit 1
}

Write-Output ("WAVES:STAGE Selesai - bobot {0} siap dipakai." -f $Model)
Write-Output "WAVES:DONE"
