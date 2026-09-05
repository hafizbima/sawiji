# Sawiji Pilates — Payment & Schedule Tracker

Dashboard internal untuk menggantikan Excel + tracking manual WhatsApp di **Sawiji Pilates Studio**: jadwal kelas per sesi, ledger transaksi append-only, dan antrian konfirmasi pembayaran.

## Fitur

- **Jadwal Kelas** — Kuota/Hold/Booking/Sisa/Status per sesi, dihitung otomatis dari ledger (bukan input manual). Tambah/hapus slot, pencarian klien-side.
- **Menunggu Konfirmasi** — antrian booking berstatus *hold*; satu klik konfirmasi → catat payment di ledger → slot pindah ke *confirmed*.
- **Transaksi Baru** — form dinamis per jenis transaksi (Booking Baru, Payment, Pakai Sesi Member, Tambah Paket, Reschedule, Cancel, Refund, Transfer Sesi).
- **Riwayat (Ledger)** — append-only, 1 baris = 1 kejadian; filter jenis/customer/tanggal; tautan antar-transaksi via Ref ID.
- **Template Pesan WA** — teks terima kasih siap salin per transaksi.
- **Database Konsumen** — master 293 konsumen (K0001+, profil, kondisi khusus), pencarian instan.
- **Membership** — kuota paket 10 Kelas (5 minggu) / 15 Kelas (7 minggu), sisa kuota & status Aktif/Kedaluwarsa/Habis dihitung dari absensi.
- **Absensi** — log kehadiran per sesi (Hadir/Reminding/Reschedule/Tidak Hadir/Refund), reschedule ke sesi pengganti, validasi anti log ganda.
- Badge jumlah antrian konfirmasi di nav, filter tabel instan tanpa request server.

## Stack

Node.js + Express + EJS · SQLite via `@libsql/client` (file lokal **atau** Turso cloud) · tanpa build step. Dependency runtime hanya 4.

Skema: 2 tabel sumber (`schedule`, `ledger`) + 1 tabel proyeksi (`bookings`) yang **selalu direbuild dari ledger** setiap ada tulisan — Hold/Booking/Sisa tidak pernah jadi sumber kebenaran.

## Jalankan Lokal

```bash
npm install
npm start          # http://localhost:3000 (tanpa env var = SQLite file pilates.db)
```

Password default: `sawiji` (ganti via env `PASSWORD`).

## Konfigurasi

| Env var | Fungsi |
|---|---|
| `TURSO_DATABASE_URL` | URL `libsql://...` — kosongkan untuk mode file lokal |
| `TURSO_AUTH_TOKEN` | token Turso (tidak perlu di mode file) |
| `PASSWORD` | password login (wajib diganti di produksi) |
| `SECRET` | kunci HMAC cookie session (wajib diset di produksi) |

## Seed Data

Mengisi jadwal + ledger dari Excel (`Sawiji_Pilates_Studio_September_2026.xlsx` di root). **Menghapus data lama di target DB.**

```bash
npm run seed                                          # ke file lokal
TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npm run seed   # ke Turso
```

## Test

```bash
npm test   # 6 test: booking→hold, payment→confirmed, cancel, reschedule, waitlist, ref_id
```

## Deploy (Vercel + Turso)

1. Buat DB gratis di [turso.tech](https://turso.tech), catat URL + token.
2. Seed: `TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npm run seed`
3. Push repo ini, import di Vercel.
4. Set env var: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `PASSWORD`, `SECRET`.
5. Settings → Functions → Function Region → samakan dengan lokasi DB Turso (mis. Tokyo) supaya latensi rendah.
