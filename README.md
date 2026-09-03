# Waves

Tool pemisahan instrumen musik berbasis [Demucs](https://github.com/facebookresearch/demucs),
dengan backend FastAPI (Python) dan UI mixer profesional berbasis **Next.js + TypeScript**,
bergaya visual mengikuti GitHub (Primer design tokens: header gelap, kartu putih dengan
border tipis, tombol hijau khas GitHub, dsb).

Upload sebuah lagu → Demucs memisahkannya jadi 4 stem (**vocals, drums, bass, other**) →
UI menampilkan mixer console lengkap: waveform per-stem, fader volume, mute/solo,
level meter real-time, dan tombol **export mix kustom ke .wav** — semua diproses
langsung di browser tanpa upload ulang ke server.

## Struktur project

Backend (Python) dan frontend (Next.js) sengaja digabung di satu root folder
yang sama — bukan dua folder `backend/`+`frontend/` terpisah. Penting:
folder backend Python **bernama `server/`, bukan `app/`**, supaya tidak
bentrok dengan konvensi routing Next.js yang juga memakai nama folder `app/`
(lewat `src/app/`). Kalau kamu ganti nama folder `server/` kembali menjadi
`app/` di root, Next.js akan salah baca folder itu sebagai app-directory-nya
sendiri dan semua halaman jadi 404.

```
Waves/
├── server/                 # backend Python (JANGAN dinamai "app")
│   ├── main.py             # FastAPI: upload, status job, download stem
│   ├── separator.py        # menjalankan demucs & parsing progress
│   └── jobs.py             # job store in-memory
├── vendor/demucs/          # source code Demucs, di-vendor langsung (lihat catatan offline)
├── requirements.txt
│
├── src/                     # frontend Next.js (App Router) + TypeScript
│   ├── app/
│   │   ├── layout.tsx      # header gelap ala GitHub (breadcrumb repo)
│   │   ├── page.tsx
│   │   └── globals.css     # design tokens ala GitHub Primer
│   ├── lib/
│   │   ├── audioEngine.ts  # mixer real-time berbasis Web Audio API
│   │   ├── wavEncoder.ts   # encoder WAV manual untuk export mix
│   │   ├── peaks.ts        # downsampling waveform
│   │   ├── api.ts
│   │   └── types.ts
│   └── components/         # Toolbar, UploadZone, Mixer, ChannelStrip, TransportBar, dst.
├── package.json
└── next.config.js          # proxy /api/* ke backend FastAPI (localhost:8000)
```

## Development

**Backend**

```bash
python -m venv .venv
.venv/bin/activate
pip install -r requirements.txt
uvicorn server.main:app --reload --port 8000
```

`requirements.txt` menginstall Demucs dari folder lokal `vendor/demucs`
(bukan `pip install git+https://...`), jadi proses `pip install` ini **tidak
butuh akses ke GitHub sama sekali**.

Butuh **ffmpeg** terpasang di sistem (untuk baca berbagai format audio):
- macOS: `brew install ffmpeg`
- Ubuntu/Debian: `sudo apt install ffmpeg`
- Windows: `winget install ffmpeg` (buka terminal baru setelahnya)

**Frontend**

```bash
npm install
npm run dev
```

Buka `http://localhost:3000`. Next.js (lewat `rewrites()` di `next.config.js`)
otomatis meneruskan (proxy) request `/api/*` ke backend di port 8000, jadi
kedua server harus jalan bersamaan.

## Catatan penting untuk "offline mode"

Ada dua hal yang terpisah di sini, karena keduanya sering tertukar:

1. **Kode Demucs sendiri** — sudah sepenuhnya di-vendor ke dalam
   `vendor/demucs`. `pip install` tidak perlu internet untuk mengambil kode
   ini lagi.
2. **Bobot model terlatih (pretrained weights)** — Demucs mengunduh file model
   (ratusan MB) dari server Meta (`dl.fbaipublicfiles.com`) **saat pertama kali**
   model tersebut dipakai. Ini bukan kode, melainkan file model besar yang tidak
   realistis untuk ikut di-bundle di repo ini.

   - Jalankan sekali dengan koneksi internet aktif, biarkan model ter-download.
   - Setelah itu, model tersimpan di cache lokal (biasanya
     `~/.cache/torch/hub/checkpoints/` di Linux/macOS, `C:\Users\<nama>\.cache\torch\hub\checkpoints\`
     di Windows), dan **semua proses pemisahan berikutnya berjalan 100% offline**,
     tidak butuh internet lagi.
   - Jika mesin kamu benar-benar tanpa internet sama sekali, kamu perlu
     mengunduh file checkpoint model tersebut dari mesin lain lalu menaruhnya
     manual di folder cache di atas.

   Dependensi Python Demucs sendiri (torch, torchaudio, dll., didefinisikan di
   `vendor/demucs/requirements.txt` via `setup.py`) tetap diambil dari PyPI
   saat `pip install -r requirements.txt` — itu instalasi paket Python biasa,
   bukan terkait GitHub/Demucs.

## Fitur mixer

- **4 stem terpisah** (vocals / drums / bass / other), masing-masing punya
  identitas warna sendiri yang konsisten di waveform, meter, dan fader.
- **Playback sinkron sample-accurate** lewat Web Audio API (bukan beberapa
  elemen `<audio>` yang gampang ngedrift satu sama lain).
- **Fader volume, mute, solo** per stem, dengan logika solo yang benar
  (channel yang di-solo tetap terdengar, sisanya senyap sementara).
- **Level meter real-time** per channel (RMS dari `AnalyserNode`).
- **Waveform** track asli + per-stem, klik untuk seek ke posisi mana pun.
- **Export mix kustom ke WAV** — merender ulang kombinasi volume/mute/solo
  yang sedang aktif jadi satu file WAV, langsung di browser (`OfflineAudioContext`
  + encoder WAV manual), tanpa round-trip ke server.
- Pilihan kualitas model (`htdemucs` cepat, `htdemucs_ft` kualitas tinggi,
  `mdx_extra` alternatif).

## Troubleshooting

- **Halaman selalu 404** — biasanya karena ada folder bernama `app/` lain di
  root project (misalnya backend Python yang tidak sengaja dinamai `app/`
  lagi). Next.js akan salah pakai folder itu sebagai app-directory. Pastikan
  backend tetap bernama `server/`, bukan `app/`.
- **`ModuleNotFoundError: torchcodec` / `Could not load libtorchcodec`** — versi
  `torchaudio` terbaru mewajibkan package `torchcodec` (plus FFmpeg versi yang
  persis cocok) hanya untuk menyimpan file audio. Ini rapuh di banyak setup
  Windows. Sudah diperbaiki dengan mem-patch `vendor/demucs/demucs/audio.py`
  supaya menyimpan WAV/FLAC lewat `soundfile` (libsndfile) langsung, tanpa
  lewat `torchaudio.save` sama sekali.
- **Upload berhasil tapi separation selalu gagal ("Demucs exited with an
  error")** — `server/separator.py` sebelumnya memanggil `python3` secara
  hardcoded untuk menjalankan Demucs. Di Windows, `python3` bisa diam-diam
  mengarah ke Python lain (bukan venv proyek ini), sehingga semua dependency
  yang sudah terpasang di venv tidak ketemu. Sudah diperbaiki dengan memakai
  `sys.executable`, yaitu interpreter Python yang sama persis dengan yang
  menjalankan server FastAPI-nya.
- **`pip install` gagal soal versi paket** (misalnya
  `torchaudio<2.1,>=0.8` tidak ketemu) — Demucs aslinya dirilis tahun 2023 dan
  menetapkan batas atas versi yang sudah usang di
  `vendor/demucs/requirements_minimal.txt`. Sudah dilonggarkan
  (`torchaudio>=0.8`, tanpa batas atas) di file vendored ini. Kalau muncul
  error serupa untuk paket lain, pola perbaikannya sama: buka file itu dan
  hapus batas atas versi yang terlalu ketat.

## Build production

```bash
npm run build   # build production Next.js
npm run start   # jalankan hasil build (default port 3000)
```

Untuk backend di production, jalankan uvicorn tanpa `--reload` di belakang
reverse proxy (nginx/caddy), atau bungkus dengan `gunicorn -k uvicorn.workers.UvicornWorker`.
