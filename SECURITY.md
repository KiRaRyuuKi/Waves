# Security Policy

## Supported Versions

| Version        | Supported |
| -------------- | --------- |
| `1.1.x-preview`| ✅ |
| `< 1.0`        | ❌ |

## Reporting a Vulnerability

Jangan buka issue publik untuk vulnerability. Hubungi secara privat:

- Email: `m.ilham.v.28.07.2003@gmail.com`
- Subject: `[Waves SECURITY] deskripsi singkat`

Sertakan langkah reproduksi, dampak, dan jika ada patch suggestion. Maintainer akan merespons dalam 3–7 hari.

## Scope

- Backend FastAPI (`server/`), proxy `next.config.js` rewrites `/api/* → :9035`
- Upload/SSRF/command injection di `separator.py`, `image.py`, `video.py`, `setup.py`
- Frontend Next.js `src/`

Terima kasih sudah menjaga keamanan Waves!
