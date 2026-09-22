# Contributing to Waves

Terima kasih sudah mau berkontribusi! Waves adalah proyek open-source berkelanjutan — semua kontribusi dihargai.

## Cara Kontribusi

1. **Fork** repo ini dan buat branch dari `main`:
   ```bash
   git checkout -b feat/nama-fitur
   ```
2. **Instal & jalankan** sesuai `README.md` (`npm install`, `pip install -r requirements.txt`, `npm run waves` atau `npm run dev` + `uvicorn server.waves:app --port 9035`).
3. **Commit** dengan format Title Case seperti riwayat (`Refactor ...`, `Fix ...`, `Add ...`) dan body deskriptif.
4. **Push** branch-mu dan buka **Pull Request** — isi template PR, jelaskan perubahan + screenshot jika UI.
5. Pastikan `npm run lint` / `npm run build` lolos dan tidak menambah secret / kredensial.

## Laporan Bug & Request Fitur

- Gunakan **Issue Template**: *Bug Report* atau *Feature Request* di `.github/ISSUE_TEMPLATE/`
- Sertakan: langkah reproduksi, OS / Node / Python / FFmpeg version, log `server/storage/jobs.json` atau console.

## Gaya Kode

- Frontend: TypeScript + Tailwind, komponen kecil di `src/components/`
- Backend: FastAPI di `server/`, hindari hardcoded `sys.executable` — pakai `sys.executable` dari venv
- Jangan commit file hasil generate, model besar (`.pth`, `*.gguf` di `server/storage/`), atau secrets — sudah di `.gitignore`
- Vendor forks (`vendor/stem`, `vendor/llama`, `vendor/coder`, `vendor/vits`) jangan di-edit langsung tanpa catat upstream di `README.md` → Vendor Forks

## Vendor Forks

Jika mengubah `vendor/*`, cantumkan:
- upstream URL + commit/tag
- alasan perubahan (mis. patch `torchcodec` di `vendor/stem/demucs/audio.py`)
- patch dipertahankan minimal agar mudah rebase

## Lisensi

Dengan berkontribusi, kamu setuju kontribusi berada di bawah `LICENSE` (MIT) proyek ini.

## Butuh Bantuan?

Buka Discussion atau hubungi maintainer: `m.ilham.v.28.07.2003@gmail.com` / [@kiraryuuki](https://github.com/kiraryuuki)
