# Sawiji Pilates Studio — Payment & Schedule Tracker — Dokumen Kebutuhan (v2)

## Latar Belakang

Bisnis: **Sawiji Pilates Studio**. Saat ini proses booking, konfirmasi pembayaran, dan pelacakan jadwal kelas dilakukan manual lewat WhatsApp + Excel.

Berdasarkan data asli yang diupload (jadwal & log transaksi bulan September), sistemnya ternyata lebih detail dari sekadar status "hold/paid" biner:
- Jadwal per sesi punya angka **Hold** dan **Booking** terpisah, bukan cuma satu status
- Riwayat transaksi dicatat sebagai **ledger append-only** dengan berbagai jenis kejadian (booking, payment, reschedule, cancel, refund, dll), bukan satu tabel flat

Alur manual yang berjalan sekarang tetap sama secara garis besar:
1. Cek WA kategori hold → ambil bukti TF dari chat terakhir customer
2. Cek jadwal yang sudah ditetapkan admin
3. Input transaksi: nama, no HP, hari/tanggal kelas, jam, atas nama pembayaran
4. Cocokkan manual ke Excel jadwal, update angka hold/booking
5. Tambahkan baris baru di log transaksi
6. Kirim template terima kasih di WA
7. Update status di WA

## Tujuan

Mengganti Excel (jadwal per sesi + log transaksi) dan tracking status manual di WA dengan satu dashboard sebagai sumber data tunggal (single source of truth).

## Scope Fase 1

- Ganti Excel (jadwal kelas + log transaksi) jadi dashboard web
- WA tetap dibuka & dibaca manual (belum ada integrasi otomatis di fase ini)

## Struktur Data

### 1. Jadwal Kelas (per sesi, per hari)
- Tanggal
- Sesi (nomor & jam, misal "Sesi 1 (07.30)")
- Coach
- Nama Kelas (Basic / Special Class / Jumpboard / Flou)
- Kuota
- Hold (jumlah customer yang masih hold, belum fix)
- Booking (jumlah customer yang sudah fix/lunas)
- Sisa — **computed**: Kuota − Hold − Booking
- Status — **computed** dari Sisa: Tersedia / Hampir Penuh (sisa ≤2) / FULL / Waitlist
- Daftar Nama Peserta
- Daftar Waitlist

### 2. Log Transaksi (ledger append-only)
Prinsip: **1 baris = 1 kejadian**. Baris lama tidak pernah diedit atau dihapus — setiap perubahan dicatat sebagai baris baru.

Field:
- ID Transaksi
- Tanggal
- Jenis Transaksi: Booking Baru / Payment / Pakai Sesi Member / Tambah Paket / Reschedule / Cancel / Refund / Transfer Sesi
- Nama Customer
- No. HP
- Hari & Tanggal Kelas
- Jam Kelas
- Nama Kelas
- Instructor
- Jumlah Sesi
- Nominal (Rp)
- Metode Bayar
- Status Bayar
- Dibayarkan Oleh (kalau dibayar orang lain, misal teman yang ikut bareng)
- Ref ID Transaksi (link ke transaksi terkait — misal baris Payment mereferensikan baris Booking Baru)
- Dari Jadwal / Ke Jadwal (khusus untuk Reschedule)
- Alasan
- Admin (siapa yang input)
- Catatan

Field wajib vs opsional berbeda tergantung Jenis Transaksi yang dipilih — form input perlu menyesuaikan field yang muncul/wajib berdasarkan jenis transaksi ini.

### 3. Alokasi Mat/Shade per Peserta (perlu klarifikasi)
Ada tabel terpisah di data asli yang assign kode/nama "shade" ke tiap peserta per sesi (misal "D24 Serve"). Belum jelas ini giveaway, deposit mat, atau kebutuhan lain — perlu ditanyakan dulu ke pacar sebelum dimasukkan ke scope.

## Halaman / Fitur

1. **List Menunggu Konfirmasi** — pengganti kategori "hold" WA, menampilkan customer yang sudah kirim bukti TF tapi belum di-ACC
2. **Form Input Transaksi** — field dinamis mengikuti Jenis Transaksi yang dipilih; pilih slot dari jadwal (bukan ketik manual); otomatis update angka Hold/Booking/Sisa di jadwal terkait
3. **Tabel Jadwal Kelas** — real-time menampilkan Kuota/Hold/Booking/Sisa/Status per sesi, pengganti Excel
4. **Riwayat Transaksi (ledger)** — bisa difilter per customer atau jenis transaksi, mendukung penelusuran transaksi terkait lewat Ref ID
5. **Generate Template Pesan** — teks thank you otomatis untuk di-copy ke WA
6. **(Opsional, menunggu klarifikasi)** Alokasi mat/shade per peserta

## Di Luar Scope Fase 1

- Integrasi WhatsApp Business API untuk kirim pesan otomatis
- Fitur alokasi shade — menunggu klarifikasi kegunaannya

## Hal yang Perlu Dicek/Diklarifikasi Sebelum Development

- Data "WEEK III SEP" di file yang diupload menunjukkan tanggal yang sama dengan "WEEK II SEP" (Selasa 8 – Minggu 13 Sept) — kemungkinan typo saat menyalin sheet mingguan, perlu dicek ke Excel sumber
- Beberapa baris log transaksi terlihat kosong di kolom No. HP / Nominal / Metode Bayar — perlu dipastikan apakah memang kosong atau artefak dari proses extract PDF (disarankan cek langsung ke file Excel asli, bukan PDF)
- Kegunaan tabel alokasi shade/mat

## Catatan Teknis

- Web app internal, skala kecil — tidak perlu infrastruktur rumit
- Database: 2 tabel utama (Jadwal Kelas, Log Transaksi) + tabel opsional (Alokasi Shade, jika jadi dipakai)
- Kolom Sisa & Status pada Jadwal Kelas harus computed/derived otomatis, bukan input manual, supaya selalu konsisten dengan Hold + Booking
