# Checklist uji manual: QC App Desktop (Country Lock + seluruh halaman web)

Dijalankan pemilik pada perangkat nyata sebelum Fase 2 ditulis (rencana `docs/superpowers/plans/2026-11-06-qc-desktop-country-lock-fase-0-1.md` Task 18, dan `docs/superpowers/plans/2026-11-12-qc-desktop-penuh-login-bearer-ui-hibrid.md` Task H8). Kolom **Hasil** dikosongkan: isi dengan Lulus / Gagal beserta catatan (tanggal, versi aplikasi, temuan). Temuan yang menyimpang dari spek (`docs/superpowers/specs/2026-11-06-qc-desktop-country-lock-design.md`) menunggu keputusan pemilik; jangan diperbaiki sepihak.

## Prasyarat

- Laptop Windows 10/11 x64 **bersih** (tanpa Node, Bun, atau Git) dan satu laptop/PC lain sebagai pembanding berisi **aplikasi WPF Country Lock lama**.
- Installer: `desktop/dist-app/QC App Setup <versi>.exe` (dibuat `bun run build:desktop`; pasang per pengguna, tanpa hak admin). Untuk uji tanpa installer: `bun run build:web && bun run --cwd desktop pack`, lalu `desktop/dist-app/win-unpacked/QC App.exe`.
- Paket skrip: folder `Country Lock2` (berisi `config.QC`, `MIKROTIK\`, `UBIQUITI\`).
- Router jump Mikrotik (alamat sesuai `server.ip` di `config.QC`) dan perangkat uji: satu Ubiquiti dan satu Mikrotik, keduanya **bukan** perangkat produksi.
- Akun QC terdaftar di server (staging `https://qc-dev.rhd.my.id` atau production `https://qc.rhd.my.id`) dan peramban sistem yang dapat login Google.
- **Gerbang spike perangkat nyata sudah lulus** (`docs/superpowers/spikes/2026-11-hardware-spike.md`, rencana Fase 0-1 Task 9 Step 6) sebelum bagian D dijalankan.
- Folder data aplikasi (`userData`, di bawah `%APPDATA%`) berisi `settings.json` (folder paket, alamat server), `auth.json` (token terenkripsi), `pending.db`, dan `ui\` (bundel UI terunduh). Hapus folder ini untuk mengulang dari keadaan bersih.

Kata sandi perangkat tidak boleh muncul di layar progres, log, atau berkas mana pun; periksa di setiap langkah inject.

## A. Pemasangan dan Country Lock tanpa server

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| A1 | Di laptop bersih, jalankan `QC App Setup <versi>.exe` | Terpasang per pengguna tanpa permintaan hak admin; pintasan tersedia; aplikasi terbuka | |
| A2 | Di mesin yang sama jalankan `"QC App.exe" --smoke` dari folder pasang | Mencetak JSON dengan `node` berawalan `24.`, `ssh2: true`, `sqlite: true` | |
| A3 | Jalankan `"QC App.exe" --smoke-ui` | Mencetak `{"bridgeVersion":N}` (N sama dengan `BRIDGE_VERSION` di `countrylock/src/bridge-channels.ts`) lalu keluar | |
| A4 | Putuskan jaringan (atau pastikan server tak terjangkau), hapus folder `userData`, buka aplikasi | Aplikasi terbuka dari UI dasar tanpa galat fatal; tidak ada layar kosong | |
| A5 | Buka halaman Country Lock (menu atau `app://qc/country-lock`) tanpa login | Halaman tampil tanpa meminta login; belum ada paket terpilih | |
| A6 | Pilih folder paket `Country Lock2` lewat dialog | Paket termuat; daftar merk dan firmware dari `config.QC` tampil; skrip yang hilang (bila ada) tercantum sebagai peringatan, bukan galat | |
| A7 | Pilih folder yang tidak berisi `config.QC` | Pesan galat jelas; paket aktif sebelumnya tidak berubah | |
| A8 | Tutup lalu buka aplikasi | Folder paket terakhir diingat dan termuat otomatis | |

## B. Login Bearer lewat peramban sistem

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| B1 | Dengan server menyala, buka halaman selain Country Lock | Diarahkan ke layar login desktop (bukan layar login web biasa) | |
| B2 | Klik tombol login | Jendela kecil bergaya popup (mode aplikasi Chrome/Edge bila peramban bawaan salah satunya; selain itu peramban biasa) terbuka di halaman login Google server; aplikasi menampilkan "Lanjutkan login di browser…" | |
| B3 | Selesaikan login Google di jendela popup | Peramban kembali ke `http://127.0.0.1:<port>/callback?...` dan menampilkan "Login berhasil" (jendela mencoba menutup sendiri; tanpa dialog "Buka aplikasi ini?"); aplikasi masuk ke beranda tanpa muat ulang manual. Tanpa registrasi `qc://` (mis. `electron .`) tetap berhasil | |
| B4 | Periksa URL peramban dan layar aplikasi | Tidak ada token/kode yang tampil di aplikasi; `auth.json` di folder `userData` tidak memuat token polos | |
| B5 | Tutup dan buka aplikasi | Tetap masuk (token terenkripsi bertahan) | |
| B6 | Klik tautan `qc://auth?code=x&state=yyyyyyyy` (atau salin ulang tautan B3 yang sudah dipakai) saat tidak ada login berjalan | Diabaikan: tidak ada perubahan status login, tidak ada galat yang tampil | |
| B7 | Mulai login, jangan selesaikan; mulai login kedua; selesaikan tautan dari login pertama | Tautan login pertama diabaikan; hanya login terbaru yang dapat selesai | |
| B8 | Selesaikan login, lalu buka tautan callback yang sama sekali lagi | Callback kedua diabaikan; status tetap masuk | |
| B9 | Tunggu lebih dari 10 menit setelah mulai login, lalu buka tautan callback | Diabaikan; login harus dimulai ulang | |
| B10 | Nonaktifkan akun di server (admin), lalu muat ulang halaman | Kembali ke layar login (token ditolak server, token lokal dihapus) | |

## C. Semua halaman web dan logout

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| C1 | Buka satu per satu semua menu (Item, Merk, Handover, QR Code, Stiker, Postel, Pengaturan Akses, dst.) | Setiap halaman terbuka dan datanya termuat | |
| C2 | Buat/ubah satu data (mis. merk uji) dan unggah satu gambar item ukuran ~5 MB | Tersimpan; gambar tampil kembali | |
| C3 | Unduh satu berkas (mis. PDF QR atau lampiran Postel) | Berkas terunduh utuh | |
| C4 | Dari DevTools (bila dapat dibuka) jalankan `fetch('/api/openapi.json')` dan `fetch('/auth/login')` | Ditolak 403 `application/problem+json`; hanya `/api/v1/*`, `/api/ping`, `/auth/logout` yang diteruskan | |
| C5 | Menu Country Lock tampil di sidebar | Menu hanya ada di aplikasi desktop (tidak ada di peramban biasa) | |
| C6 | Logout | Kembali ke layar login; `auth.json` terhapus; Country Lock tetap dapat dibuka tanpa login | |
| C7 | Login ulang | Berhasil seperti B2-B3 | |

## D. Country Lock dengan perangkat nyata

Jalankan hanya setelah gerbang spike lulus. Selalu bandingkan dengan aplikasi WPF lama pada perangkat sejenis.

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| D1 | Pilih merk Ubiquiti dan firmware yang sesuai; hubungkan perangkat Ubiquiti | Ping perangkat dan router jump hijau; serial terbaca otomatis tiap ping sukses | |
| D2 | Klik baca info | Model, serial, dan negara tampil; kredensial salah memunculkan "Permission denied!!!" (bukan galat jaringan umum) | |
| D3 | Inject Ubiquiti (manual) | Progres bergerak (menghubungkan, mengirim, berjalan, selesai); setelah perangkat reboot negara terkunci ke **Indonesia**, sama dengan hasil aplikasi WPF lama pada perangkat sejenis | |
| D4 | Ulangi D1-D3 untuk perangkat Mikrotik | Hasil sama dengan aplikasi WPF lama (negara terkunci, skrip RouterOS berjalan sampai selesai) | |
| D5 | Selama inject, periksa layar progres dan seluruh teks yang tampil | Kata sandi tidak muncul (diganti `****`), juga bentuk yang di-escape; tidak ada urutan kendali terminal mentah | |
| D6 | Mulai inject lalu klik batal | Inject berhenti, status "dibatalkan", dapat dimulai lagi | |
| D7 | Nyalakan auto-inject dan sambungkan perangkat baru | Inject berjalan otomatis sekali; setelah sukses interface bridge router berganti ke berikutnya | |
| D8 | Sambungkan lagi perangkat dengan serial yang **sudah** tercatat di pending | Tidak di-auto-inject; tampil sebagai "sudah terdaftar"; inject manual tetap mungkin dan mencatat waktu inject ulang pada entri yang sama | |
| D9 | Cabut perangkat saat inject berjalan | Mengikuti kebijakan putus koneksi (putus setelah ada keluaran dianggap selesai; putus lebih awal = gagal); tidak ada hang | |
| D10 | Tutup paksa aplikasi (Task Manager > Akhiri tugas) saat ada beberapa entri pending, lalu buka lagi | Semua entri pending masih ada (`pending.db`) | |
| D11 | Hapus satu entri pending | Entri hilang dan tetap hilang setelah aplikasi dibuka ulang | |

## E. Server mati dan pembaruan UI

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| E1 | Matikan server (atau putuskan jaringan) saat aplikasi terbuka dan sudah masuk | Halaman selain Country Lock menampilkan pesan "tidak dapat terhubung"; aplikasi tidak crash | |
| E2 | Pada keadaan E1, buka Country Lock dan lakukan ping/baca info/inject | Berjalan normal (tidak bergantung server) | |
| E3 | Nyalakan server kembali | Halaman lain pulih tanpa memulai ulang aplikasi | |
| E4 | Prasyarat: aplikasi dibangun dengan `UI_PUBLIC_KEY_PEM` terisi (kunci publik disuntikkan saat build; `docs/desktop-ui-signing.md`, log build mencetak sidiknya) dan server menyajikan manifest bertanda tangan kunci pasangannya. Deploy versi web baru ke staging, buka aplikasi, tunggu pemeriksaan (saat dibuka, saat jendela fokus, atau sampai 1 jam) | Bundel baru terunduh di `userData\ui\versions\`; UI baru terpakai pada peluncuran berikutnya atau setelah tombol "Muat ulang" (spanduk muat ulang menyusul di web); tidak diterapkan saat inject berjalan | |
| E5 | Aplikasi dibangun tanpa `UI_PUBLIC_KEY_PEM` (build dev/`pack`; build rilis `dist` menolak ini) | Tidak ada unduhan UI; aplikasi tetap memakai UI dasar tanpa galat | |
| E6 | Rusak-kan bundel di server uji (ubah satu berkas tanpa menandatangani ulang, atau pakai manifest bertanda tangan kunci lain) | Bundel ditolak; UI aktif tidak berubah; tidak ada berkas setengah jadi di `userData\ui\staging` | |
| E7 | Terapkan bundel yang sengaja gagal dimuat (uji pengembang) dua kali berturut-turut | Aplikasi kembali ke bundel sebelumnya, lalu ke UI dasar; versi itu tidak diunduh ulang | |

## F. Tautan protokol dan instans tunggal

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| F1 | Di peramban biasa buka halaman Country Lock web | Menampilkan ajakan membuka aplikasi desktop (tautan `qc://country-lock`), bukan jembatan | |
| F2 | Klik tautan itu dengan aplikasi tertutup | Aplikasi terbuka di halaman Country Lock | |
| F3 | Klik lagi dengan aplikasi sudah terbuka | Tidak ada jendela kedua; jendela yang ada fokus | |
| F4 | Buka `qc://lain`, `qc://country-lock/x`, atau `qc://country-lock?a=1` | Diabaikan (tidak membuka rute apa pun) | |

## Pengisian hasil

- Penguji dan tanggal: 
- Versi aplikasi (`desktop/package.json`) dan commit: 
- Perangkat yang dipakai (model, firmware): 
- Ringkasan temuan dan keputusan lanjut: 
