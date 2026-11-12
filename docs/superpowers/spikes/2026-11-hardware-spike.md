# Spike perangkat nyata: penanda SSH, SFTP router, host key (Task 9)

Status: **menunggu dijalankan pemilik** (gerbang Task 9 Step 6). Hanya pemilik yang memiliki router
jump dan perangkat Ubiquiti nyata; harness dan server SSH palsu sudah teruji otomatis, tetapi asumsi
tiruan dapat meleset dari perangkat sungguhan (spek §11). Jangan lanjut ke Task 10 dst. sebelum
lembar hasil di bawah terisi dan keputusannya dicatat.

## Apa yang diuji

Spike mengerjakan butir 1, 2, 3, dan 7 spek §11 pada perangkat sungguhan:

| Cek | Cara | Butir §11 |
|---|---|---|
| `sentinelEcho` / `sentinelPut` (router) | Shell interaktif `ssh2`, baris uji yang MEMAKAN WAKTU (`:delay 2s`) dengan penanda `echo <token>` lalu `:put <token>`; batas 10 detik per baris. `ok` hanya bila penanda kembali SETELAH baris selesai (>= 1,8 detik sejak shell dibuka); penanda yang kembali seketika dilaporkan `error` (token muncul dua kali dari echo saja = "Selesai palsu"). Di RouterOS, `echo` seharusnya **timeout** dan `:put` **ok** | 1 |
| `sftpPut`, `sftpRename`, `sftpStat` | Membersihkan sisa uji lama, menulis berkas uji 1 KB `/temp/qc-spike.tmp.part`, mengganti nama ke `/temp/qc-spike.tmp`, `stat` memeriksa ukuran 1024. Lalu (hanya catatan, bukan penentu gerbang) menguji apakah rename ke nama yang SUDAH ADA menimpa atau gagal: penting untuk sinkron §5 | 2 |
| `hostKeyType` | Jabat tangan SSH menangkap host key router (harus `ssh-rsa`, kunci non-RSA menggagalkan `{sshKey}`) | 3 |
| `deviceMode`, `importBlocked` | `/system device-mode print`, lalu menulis `/temp/qc-spike.rsc` (satu baris komentar) dan menjalankan `/import file-name=temp/qc-spike.rsc` | 7 |
| `ubiquiti.sentinelEcho` | Shell interaktif ke perangkat Ubiquiti, baris uji `sleep 2` dengan penanda `echo`; aturan waktu sama seperti router | 1 |
| `ubiquiti.scpFromRouter` | Di perangkat Ubiquiti: menambah baris `known_hosts` router lalu `scp <user>@<router>:/temp/qc-spike.tmp /tmp/qc-spike.tmp` (persis seperti skrip produksi), `wc -c` harus 1024 | 2 |

Semua tulis-uji dibersihkan kembali (berkas `/temp/qc-spike.*` di router dihapus lewat SFTP,
`/tmp/qc-spike.tmp` di Ubiquiti dihapus). **Satu efek samping yang disengaja**: satu baris untuk router
ditambahkan ke `/var/etc/persistent/.ssh/known_hosts` di Ubiquiti (sama dengan yang dilakukan skrip
produksi; aman diulang karena memakai `grep -q ... ||`). Bila ada berkas uji yang gagal dihapus, laporan
memuat catatan `BERKAS UJI TERSISA di router: ...`: hapus manual (`/file remove`).

Router yang salah kredensial atau tak terjangkau menghentikan semua cek router setelah SATU percobaan
login (supaya tidak memicu penguncian akun).

## Prasyarat

- Node.js 24 atau lebih baru terpasang (`node --version`) dan `bun install` sudah dijalankan di akar repo.
- Komputer ada di jaringan yang dapat menjangkau router jump (dan perangkat Ubiquiti, bila diuji).
- Pakai router jump yang sedang tidak dipakai produksi bila ada. Skrip hanya menulis berkas `qc-spike.*`
  di `/temp`, tetapi `/import` dijalankan pada router sungguhan (berkasnya hanya berisi komentar).

## Langkah menjalankan (PowerShell, dari akar repo)

Kata sandi **tidak pernah lewat argumen**; hanya dari variabel lingkungan sesi PowerShell ini:

```powershell
# Kata sandi dibaca tersembunyi lalu disimpan di variabel lingkungan sesi ini saja.
$p = Read-Host "Kata sandi router jump" -AsSecureString
$env:SPIKE_ROUTER_PASSWORD = [System.Net.NetworkCredential]::new('', $p).Password

# Hanya bila perangkat Ubiquiti ikut diuji:
$p = Read-Host "Kata sandi perangkat Ubiquiti" -AsSecureString
$env:SPIKE_UBNT_PASSWORD = [System.Net.NetworkCredential]::new('', $p).Password

# Router saja:
bun run --cwd desktop spike -- --router <IP-router> --router-user <pengguna-router>

# Router + Ubiquiti (tambahkan --router-from-ubnt bila alamat router yang terlihat dari
# perangkat Ubiquiti berbeda dari <IP-router>, mis. karena NAT):
bun run --cwd desktop spike -- --router <IP-router> --router-user <pengguna-router> `
  --ubnt <IP-ubiquiti> --ubnt-user <pengguna-ubiquiti> --router-from-ubnt <IP-router-dari-ubiquiti>

# Setelah selesai, hapus kata sandi dari sesi:
Remove-Item Env:SPIKE_ROUTER_PASSWORD, Env:SPIKE_UBNT_PASSWORD -ErrorAction SilentlyContinue
```

Opsi lain: `--router-port`, `--ubnt-port` (bila SSH tidak di port 22). Proses memakan sekitar satu
sampai dua menit (penanda `echo` di RouterOS sengaja menunggu batas waktu 10 detik).

Hasilnya dicetak ke layar dan ditulis ke `desktop/spike-report-<tanggal>.json` (berkas ini diabaikan git;
tanpa kata sandi). CLI menutup dengan baris `GERBANG: lolos/TIDAK lolos` menurut aturan di bawah.

## Cara menafsirkan (aturan gerbang, rencana Task 9 Step 6)

| Hasil | Arti | Tindakan |
|---|---|---|
| `router.sentinelPut` ≠ `ok` | Penanda `:put` tidak andal di RouterOS | **Berhenti**; perbarui spek bersama pemilik sebelum Task 18 |
| `router.sftpPut` atau `router.sftpRename` = `false` | Sinkron router §5 tak dapat memakai SFTP | **Berhenti**; perbarui spek |
| `router.importBlocked` = `true` | `/import` diblokir device-mode (penerapan `.rsc` §5.1) | **Berhenti**; perbarui spek |
| `router.importBlocked` = `"unknown"` | Keluaran `/import` tak dikenali (lihat `notes`) | Laporkan; bukan penghenti otomatis |
| `router.hostKeyType` ≠ `ssh-rsa` | Router tidak menawarkan RSA; `{sshKey}` untuk dropbear Ubiquiti bermasalah (T8 melempar `NOT_RSA`) | Laporkan (risiko §11 butir 3) |
| `ubiquiti.sentinelEcho` ≠ `ok` | `echo` tidak andal di perangkat Ubiquiti | Laporkan; `SENTINEL_BY_BRAND.ubiquiti` perlu diganti |
| `ubiquiti.scpFromRouter` = `false` | `scp` dari router gagal (mis. meminta kata sandi, host key, atau berkas tak ada) | Laporkan; lihat `notes` |

Jika gerbang lolos: ubah `SENTINEL_BY_BRAND` di `desktop/src/main/ssh/strategy.ts` sesuai hasil
(`mikrotik: 'put'` dan `ubiquiti: 'echo'` bila `sentinelPut` dan `ubiquiti.sentinelEcho` bernilai `ok`),
hapus tanda "menunggu hasil spike T9" di berkas itu, lalu lanjut ke Task 10.

---

## Lembar hasil (diisi pemilik)

Tanggal dijalankan: ____-__-__  Pelaksana: __________

Perangkat:
- Router jump: model __________  versi RouterOS __________  (mode device: __________)
- Ubiquiti: model __________  versi firmware __________

### Laporan JSON (tempel `desktop/spike-report-<tanggal>.json` di sini)

```json

```

### Ringkasan

| Cek | Hasil | Catatan |
|---|---|---|
| Penanda `echo` di router | | (harapan: timeout) |
| Penanda `:put` di router | | (harapan: ok) |
| SFTP put | | |
| SFTP rename | | |
| SFTP stat | | |
| Host key router | | (harapan: ssh-rsa) |
| device-mode / `/import` | | |
| Penanda `echo` di Ubiquiti | | |
| `scp` dari router di Ubiquiti | | |

### Keputusan

- [ ] Gerbang lolos; `SENTINEL_BY_BRAND` disesuaikan dan Task 10 dst. dilanjutkan.
- [ ] Gerbang TIDAK lolos; spek diperbarui dengan persetujuan pemilik (tanggal/alasan): __________
- Catatan lain / perilaku tak terduga (ANSI, lebar 200 kolom, baris panjang, versi RouterOS): __________
