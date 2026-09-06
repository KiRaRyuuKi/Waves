# Voice Models

**Katalog & Checkpoint Model Suara VITS untuk Waves**

Folder ini adalah rumah bagi model suara VITS yang dipakai pada halaman **Voice Synthesis** dan **Fine-tune**. Setiap model disimpan per karakter, cukup dengan satu file checkpoint `.pth` — `config.json` dan `meta.json` bersifat **opsional** (dipakai otomatis dari default/katalog saat tidak ada).

---

## 🚀 Ringkasan

- **Satu model, banyak suara**: Koleksi ini adalah satu model multi-speaker (804 suara) yang disalin/disimbolkan per karakter; speaker di-pilih lewat `sid`.
- **Pemilihan by nama**: User di UI memilih **nama karakter**, bukan id numerik — speaker id (`default_sid`) diisi otomatis dari katalog `info.json`.
- **Checkpoint asli**: File `.pth` asli (atau pointer Git LFS yang belum ter-download, ditandai sebagai *belum siap*).
- **Validasi cepat**: `GET /api/voice/models` lalu `POST /api/voice/synthesize` untuk memastikan karakter baru berfungsi.

## 📁 Struktur Folder

```txt
server/storage/models/
├── info.json              # katalog karakter (nama, sid, contoh teks, dll)
├── _default_config.json   # hyperparameter VITS default (multi-speaker, 804 suara)
└── <model_id>/
    ├── config.json        # (opsional) hyperparameter khusus model ini
    ├── meta.json          # (opsional) metadata kustom yang tampil di UI
    └── <model_id>.pth     # checkpoint VITS (bobot)
```

## ⚙️ Cara Kerja

### 1. Katalog karakter (info.json)

`info.json` di akar folder adalah katalog berisi `model_id -> {...}` dengan field yang dipakai otomatis:

- `name_en` / `name_zh` / `title` — nama karakter (dipakai sebagai nama model; urutan prioritas: `title` > `name_en` > `name_zh`)
- `sid` — speaker id; menjadi `default_sid`
- `example` — contoh teks default di textbox
- `language`, `enable`
- `cover` — path gambar karakter

`list_models()` menggabungkan folder yang ada dengan katalog ini; folder yang cukup berisi `*.pth` tetap dikenali (tanpa `config.json`/`meta.json`).

### 2. Model kustom (meta.json)

Untuk model buatan sendiri, taruh `meta.json` di folder model; isinya dipakai apa adanya dan menimpa katalog:

```json
{
  "name": "Nama yang tampil di UI",
  "language": "ja",
  "sample_text": "Contoh kalimat default di textbox",
  "speakers": [
    { "id": 0, "name": "Nama karakter 1" },
    { "id": 1, "name": "Nama karakter 2" }
  ]
}
```

Untuk model single-speaker, cukup satu entri di `speakers` dengan `id: 0`.

### 3. Config & checkpoint

- **config**: Kalau folder model tidak punya `config.json`, dipakai `_default_config.json` (config bersama dari koleksi 804 suara).
- **checkpoint**: File `.pth` asli (bukan pointer) di dalam folder model. Format `_load_state_dict` menangani raw `state_dict` maupun dict terbungkus (`model` / `state_dict` / `generator`).
- **Pointer Git LFS**: File `.pth` kecil yang isinya `version https://git-lfs` menunjuk blob besar yang belum ter-download. Selama belum di-download, model tampil sebagai *belum siap* di UI. Kalau ada model lain **dengan ukuran byte sama** yang sudah ter-download (koleksi ini adalah satu model multi-speaker yang disalin per karakter), bobot tersebut dipakai bersama dan suara karakter disesuaikan lewat `sid` dari `info.json`.

## 🧩 Menambahkan Karakter Baru

1. Buat folder `server/storage/models/<model_id>/`.
2. Taruh checkpoint `*.pth` (download penuh dari sumbernya, bukan pointer LFS).
3. Tambahkan entri di `info.json` (`name_en`, `sid`, `example`, dst).
4. (Opsional) taruh `cover.png` dan `config.json` jika perlu.
5. Coba `GET /api/voice/models` lalu `POST /api/voice/synthesize` dengan `model_id` folder tadi.

File `.pth` sengaja tidak ikut ke-track di git (lihat `.gitignore`); `info.json`, `config.json`, dan `meta.json` kecil jadi boleh di-commit.
