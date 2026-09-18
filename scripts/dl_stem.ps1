param(
  [ValidateSet("htdemucs", "htdemucs_ft", "mdx_extra")]
  [string]$Model = "htdemucs"
)

$ErrorActionPreference = "Continue"

# ---------- Target: cache torch hub (folder yang dibaca Demucs) ----------
$cacheDir = Join-Path $HOME ".cache\torch\hub\checkpoints"
New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null

$baseUrl = "https://dl.fbaipublicfiles.com/demucs"

# Bobot pre-trained Demucs. `name` = nama file di cache torch hub (harus
# sama persis agar ditemukan tanpa diunduh ulang oleh demucs). `url` =
# path relatif ke server fbaipublicfiles.
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
    $len = Get-Len (Join-Path $cacheDir $j.name)
    if ($len -gt [long]$j.size) { $len = [long]$j.size }
    $done += $len
  }
  return $done
}

# ---------- Unduh satu checkpoint (resume + chunk pendek agar progres live) ----------
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

    # Report progres tiap ~1 detik supaya UI live (bar naik terus).
    if ((Get-Date).AddMilliseconds(-1000) -ge $lastUpdate) {
      $done = Get-DoneTotal
      Write-Output ("WAVES:PROGRESS {0} {1}" -f $done, $knownTotal)
      $lastUpdate = Get-Date
    }

    # Unduh dalam chunk pendek (~5 detik) + resume, supaya progres bisa
    # dilaporkan di antara chunk, bukan baru setelah file penuh.
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

# ---------- Proses ----------
Write-Output ("WAVES:STAGE Mengunduh bobot Demucs ({0})..." -f $Model)
foreach ($j in $jobs) {
  Invoke-CheckpointDownload $j
}

Write-Output "WAVES:STAGE Verifikasi file..."
$missing = @($jobs | Where-Object { (Get-Len (Join-Path $cacheDir $_.name)) -lt [long]$_.size })
if ($missing.Count -gt 0) {
  Write-Output ("WAVES:ERROR File belum lengkap: {0}" -f (($missing | ForEach-Object { $_.name }) -join ", "))
  exit 1
}

Write-Output ("WAVES:STAGE Selesai - bobot {0} siap dipakai." -f $Model)
Write-Output "WAVES:DONE"