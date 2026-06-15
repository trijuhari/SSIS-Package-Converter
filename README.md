# SSIS Package Converter

Konverter sederhana untuk paket SSIS — frontend utility untuk membantu proses modernisasi dan konversi.

## Konten proyek
- `app.js` — entry / logika utama (frontend)
- `parser.js` — parser untuk mengurai paket atau sumber input
- `codegen.js` — generator kode/output
- `index.html` — antarmuka pengguna (UI)
- `style.css` — stylesheet untuk UI

## Prasyarat
- Web browser modern (Chrome/Firefox/Edge)
- (Opsional) Node/NPM bila ingin menjalankan server lokal menggunakan paket seperti `http-server`.

## Cara Menjalankan
1. Buka `index.html` langsung di browser (cukup untuk penggunaan frontend statis).
2. Atau jalankan server HTTP sederhana dari direktori proyek untuk menghindari masalah CORS:

```bash
# dengan Python 3
python3 -m http.server 8000

# atau dengan http-server (Node)
npx http-server -c-1

# lalu buka http://localhost:8000 di browser
```

## Struktur & Tujuan File
- `parser.js`: baca dan parse input paket/definisi.
- `codegen.js`: ambil hasil parse lalu buat output/konversi.
- `app.js`: glue code yang menghubungkan UI dengan parser dan codegen.

## Kontribusi
Silakan fork repo dan buka Pull Request. Untuk perubahan besar, buat issue dulu agar diskusi dapat dimulai.

## Lisensi
Tidak ada lisensi resmi yang ditentukan di repo ini.

---
_File ini dibuat otomatis oleh asisten. Edit sesuai kebutuhan proyek._
