# Stable Diffusion Models

**Folder model Stable Diffusion untuk halaman **Image Generation**.

Sesuai desain, folder ini **tidak berisi bobot model** dan Waves **tidak
pernah mengunduh model secara otomatis** — Anda yang menaruh checkpointnya
secara manual. Pipa inferensi (`diffusers`) selalu diload dengan
`local_files_only=True`, jadi kalau foldernya kosong atau folder model
tidak ada, request akan gagal dengan pesan yang jelas, bukan men-download.

---

## 📁 Struktur Folder

```txt
server/storage/generate/image/
└── <model_id>/
    ├── ........................... (mode A) folder berformat diffusers
    ├── ........................... (mode B) satu file checkpoint + config.json
    └── cover.png ................. (opsional) gambar ditampilkan di UI
```

### Mode A — folder diffusers lengkap

Cara paling umum. Tiap model punya `model_index.json` + subfolder
(`unet/`, `vae/`, `text_encoder/`, `tokenizer/`, `scheduler/`).

Unduh dari Hugging Face (mis. `runwayml/stable-diffusion-v1-5`), lalu
taruh isinya di `server/storage/generate/image/<model_id>/`:

```bash
# di komputer dengan internet (TIDAK dijalankan oleh Waves)
huggingface-cli download runwayml/stable-diffusion-v1-5 \
  --local-dir server/storage/generate/image/sd-v1-5
```

Waves akan memuatnya dengan `StableDiffusionPipeline.from_pretrained(<folder>)`.

### Mode B — satu file checkpoint (.safetensors/.ckpt)

Taruh satu file `*.safetensors` (atau `*.ckpt`) di
`server/storage/generate/image/<model_id>/`, plus `config.json` opsional:

```json
{
  "vae": "vae-local"
}
```

Waves akan memuatnya dengan `from_single_file(...)`. Kalau `vae` disebut
di `config.json`, nilai itu harus berupa folder diffusers **lokal** — Waves
tidak pernah mengunduh VAE dari internet. Kosongkan/hapus field `vae`
untuk VAE bawaan checkpoint.

### Judul yang tampil di UI (meta.json)

Letakkan `meta.json` di folder model untuk nama yang tampil di dropdown:

```json
{
  "name": "Stable Diffusion 1.5",
  "description": "Model 512×512 klasik"
}
```

Tanpa `meta.json`, nama folder dipakai apa adanya.

---

## ⚙️ Validasi

1. Taruh model di `server/storage/generate/image/<model_id>/`.
2. Mulai backend: `uvicorn server.waves:app --port 9035`.
3. `GET /api/models` — pastikan model muncul.
4. `POST /api/generate` dengan `{"model_id": "<id>", "prompt": "..."}`.

Bobot model (.safetensors/.ckpt/.bin, multi-GB) sengaja di-ignore oleh
git; `README.md`, `meta.json`, dan `config.json` boleh di-commit.