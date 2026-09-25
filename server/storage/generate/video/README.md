# Video Models

**Folder model untuk halaman **Video Generation**.**

Sama seperti `server/storage/generate/image/`, folder ini **tidak diisi bobot oleh
git** dan Waves **tidak mengunduh model saat inferensi**. Unduhan disediakan
lewat menu **Setup & Runtime** di aplikasi (skrip `scripts/dl_model.ps1`),
sehingga tidak ada trafik internet diam-diam saat generate.

---

## 📁 Struktur Folder

```txt
server/storage/generate/video/
├── animatediff/
│   ├── motion-adapter/     # guoyww/animatediff-motion-adapter-v1-5-2
│   └── clip-vit-large/     # openai/clip-vit-large-patch14 (CLIPVisionModel)
└── wan/
    └── t2v-1.3b/           # Wan-AI/Wan2.1-T2V-1.3B-Diffusers (layout diffusers)
# (hasil video TIDAK disimpan di disk, dikembalikan via API sebagai data:video/mp4;base64,
#  mirip Image Generation, dan bisa diunduh langsung dari browser)
```

### A) AnimateDiff (`server/video.py`)

AnimateDiff bukan model video mandiri, ia **motion module** yang ditempel ke
model SD 1.5 yang sudah ada di `server/storage/generate/image/<id>/`. Jadi pastikan
salah satu model SD 1.5 (mis. `stable-diffusion`) sudah terpasang.

Dibutuhkan dua bagian (keduanya ada di Setup & Runtime):

1. `animatediff/motion-adapter/` dari `guoyww/animatediff-motion-adapter-v1-5-2`
2. `animatediff/clip-vit-large/` dari `openai/clip-vit-large-patch14`

### B) Wan 2.1 T2V 1.3B

Pipeline diffusers lengkap (`model_index.json` + `transformer/`, `vae/`,
`text_encoder/`, `tokenizer/`, `scheduler/`) dari
`Wan-AI/Wan2.1-T2V-1.3B-Diffusers` (~28 GB). Di GPU 4 GB model ini berjalan
dengan *CPU offload* sehingga lambat, tapi hemat vRAM.

---

## ⚙️ Validasi

1. Pasang model lewat **Setup & Runtime** (kategori *model*, awalan "Video:").
2. Mulai backend: `uvicorn server.waves:app --port 9035`.
3. `GET /api/video/models` pastikan `installed: true`.
4. `POST /api/video/generate` dengan `{"model_id": "animatediff", ...}`.

Bobot (multi-GB) di-ignore git; `README.md` boleh di-commit.
