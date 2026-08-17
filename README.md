# RESTORAN KITA — Full Stack

Versi ini mengganti penyimpanan localStorage dengan backend Express + database SQLite.

## Fitur
- Halaman pembeli `index.html` dengan QR meja: `/?meja=01`
- Pesanan masuk ke database dan tampil di admin
- Pembayaran: **bayar di kasir**
- Stok berkurang otomatis ketika pesanan dibuat
- Admin login
- Admin dapat mengubah nama, logo, dan lokasi toko
- Upload foto logo/menu dari galeri
- Tambah, edit, hapus menu
- Ubah harga, stok, kategori, deskripsi
- Kelola status pesanan
- Ganti password admin
- SQLite database di `data/restoran.db`

## Menjalankan di komputer/hosting Node.js

1. Pastikan Node.js terpasang.
2. Buka folder project.
3. Jalankan:
   `npm install`
4. Atur secret:
   Linux/macOS:
   `JWT_SECRET="buat-secret-yang-panjang" npm start`

   Windows PowerShell:
   `$env:JWT_SECRET="buat-secret-yang-panjang"; npm start`
5. Buka:
   `http://localhost:3000/`
6. Admin:
   `http://localhost:3000/admin`

## Login awal
- Username: `admin`
- Password: `admin123`

**Segera ganti password setelah login.**

Jika ingin QR meja, QR dapat diarahkan ke:
- `https://domain-anda/?meja=01`
- `https://domain-anda/?meja=02`
- dan seterusnya.

## Struktur
- `server.js` — backend/API
- `public/index.html` — halaman pembeli
- `public/login.html` — login admin
- `public/admin.html` — panel admin
- `data/restoran.db` — database SQLite (dibuat otomatis)
- `public/uploads/` — foto hasil upload admin

## Catatan hosting
Hosting harus mendukung aplikasi Node.js dan penyimpanan file/database yang persisten. Untuk penggunaan publik, gunakan HTTPS dan set `JWT_SECRET` melalui environment variable.
