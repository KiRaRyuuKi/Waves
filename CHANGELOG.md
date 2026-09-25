# Changelog

All notable changes to Waves will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
versioning loosely follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned
- Pengujian menyeluruh fitur Image / Video / LLM / Coder sebelum release stabil
- Dokumentasi vendor fork lebih lengkap dan arsitektur
- Release versi stabil `v1.2.0-stable` setelah QA

## [1.1.5-preview] - 2026-09-25

### Added
- Remover: backend `server/remover.py` dengan isolasi `REMBG_HOME`/`U2NET_HOME`/`XDG_DATA_HOME` ke `server/storage`, `scripts/dl_remover.ps1` (u2net 176 MB, isnet 179 MB, silueta 44 MB), dependensi `rembg`/`onnxruntime`/`pymatting`/`scikit-image`/`pooch`, serta UI `src/components/Remover.tsx` dan `src/app/remover/page.tsx`
- Studio Creation: alur gabungan Image + Video di `src/app/studio/page.tsx`
- Screen Coder (`server/coder.py`, `src/app/coder`, `ScreenCoder`) dan LLM Hub (`server/llm.py`, `src/app/llm`, `LlmHub`) untuk agent pengodean serta inferensi GGUF lokal
- Binary lokal `bin/waves.js` agar `npx waves` berjalan tanpa install global (field `bin` di `package.json`, `npm run waves` tetap kompatibel)
- Vendor fork untuk Screen Coder dan inferensi GGUF: `vendor/llama` (ggml-org/llama.cpp, MIT, fb34fc2) dan `vendor/coder` (screenshot-to-code agent), dengan atribusi upstream di tabel Vendor Forks
- Checkpoint VITS Kafka sebagai objek Git LFS di `server/storage/models/kafka/kafka.pth` (159.650.901 byte, 804 speaker) + konfigurasi multi-speaker bersama
- Galeri screenshot `docs/screenshots/index.html` (11 tangkapan) dengan Prev/Next, panah keyboard, thumbnail, swipe, dan layar penuh
- Regression test keamanan `tests/security_regression.py`: 39 pemeriksaan untuk A01 path traversal, A02 secret masking, A04 batas upload, CSRF origin guard, dan A05 sisa file temporer
- Sponsorship: `.github/FUNDING.yml` (GitHub Sponsors `KiRaRyuuKi` + Saweria `saweria.co/KiRaRyuuKi`)
- Governance open-source awal: `LICENSE` (MIT), `CHANGELOG.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue/PR templates

### Changed
- Batas upload terpusat di `server/uploads.py` (`MAX_AUDIO_UPLOAD` 500 MB, `MAX_IMAGE_UPLOAD` 20 MB, `MAX_DATASET_AUDIO` 100 MB, `MAX_DATASET_FILES` 200) dan diterapkan ke separator, voice, image, remover, dan training
- Migrasi ESM: `type: module` di `package.json`, `next.config.js` dan `postcss.config.js` ke `export default`
- Route setup Next.js memakai segmen dinamis `[id]` (dari `[jobId]`/`[taskId]`)
- `postcss` dipin ke 8.5.28 dengan `overrides` agar 8.4.31 yang tertanam di dalam Next.js hilang dari lockfile
- Pixel asset: mascot `pixel-capybara` di Sidebar, header layout, dan asset pixel lama dihapus
- `server/storage/jobs.json` dan `tsconfig.tsbuildinfo` berhenti dilacak Git karena sudah di-ignore sebagai artefak runtime
- README: sembilan utilitas, pohon arsitektur, tabel batas upload dan keamanan; `CONTRIBUTING.md`, `SECURITY.md`, dan template issue/PR diselaraskan
- Video/Image pipeline dan SetupModal disetel ulang, plus penyempurnaan runner `scripts/start.mjs`, `restart.mjs`, dan `stop.mjs`

### Fixed
- Mapping id model Remover ke nama session rembg (`isnet` → `isnet-general-use`) plus alias folder, sehingga `model_dir`, `resolve_existing`, dan pesan error memakai sumber nama yang sama
- API key Coder dimasker di `GET /api/coder/config/raw` dan secret tersimpan dipertahankan saat marker masker dikirim balik
- Penulisan `jobs.json` dan config Coder menjadi atomik tanpa meninggalkan file `.tmp`
- Rate limit dibatasi jumlah IP terlacak dan perluas ke seluruh prefix path yang dilindungi
- Origin guard untuk request yang mengubah state, baik di middleware `server/waves.py` maupun route Next.js (`src/lib/api/originGuard.ts`)
- Path traversal ditutup untuk `dataset_id`, `repoId`/`filename` GGUF, dan `model_id` di training, LLM, TTS, voice, image, serta fine-tune
- `scripts/start.mjs`: quoting `spawnSync` untuk path ber-spasi; artifact putih pada canvas compare dihapus dan ukuran minimum card compare 560 → 360
- Status `Terpasang` model Image/Video di SetupModal, serta ETA dan kecepatan unduh Setup yang live

## [1.0.5-beta] - 2026-09-21

### Added
- AnimateDiff single-task (`animate-diff`) dan Wan T2V `1.3B`
- Setup live ETA dan kecepatan internet via disk polling
- `ServerControl` & `SetupModal` untuk manajemen model runtime

## [0.1.5-alpha] - 2026-09-20

- Rilis awal: Stem Separator (Demucs), Voice Synthesis (VITS), Fine-tune, Image/Video generation, Web Audio mixer
