# Country Lock desktop: sinkron bundel dari server ke komputer dan router jump

Tanggal: 2026-11-28. Status: **rancangan, menunggu persetujuan pemilik**. Pemilik produk: pemilik QC App.
Melanjutkan dan sebagian MENGGANTI `2026-11-06-qc-desktop-country-lock-design.md` (selanjutnya "spek desktop"), terutama §4, §5, §5.1 dan baris fase 2 di §9. Fase 2 spek desktop untuk paket konfigurasi dan sinkron router **belum pernah dibangun**; dokumen ini adalah rancangan pembangunannya, ditambah kebutuhan baru dari pemilik.

Tanda dalam dokumen: **[Pemilik]** = keputusan pemilik (semua tanggal 2026-11-28 bila tak disebut lain); **[Perancang]** = pilihan perancang yang boleh diubah pemilik; **[Builder]** = diserahkan ke pembangun; **[Spike]** = dugaan yang harus dibuktikan di perangkat nyata sebelum diandalkan.

## 1. Maksud dan alasan

Sekarang operator harus menyimpan script di komputernya dan membuka `config.QC` dari disk sebelum Country Lock bisa dipakai, dan router jump harus disiapkan manual. Desktop yang ada hari ini masih membaca paket dari folder lokal (`packageDir`, `desktop/src/main/package/local-folder.ts`); server belum punya modul untuk paket ini. Aplikasi lama juga punya masalah keadaan: bila koneksi ke router jump putus saat komputer sudah berganti mode (single/multi) atau rotasi interface, catatan di komputer dan kenyataan di router berbeda dan tidak ada yang memeriksa.

Pemilik ingin: **server menjadi sumber tunggal** untuk pengaturan, script, firmware, berkas router, dan konfigurasi router. Desktop menyelaraskan komputer sendiri, lalu memeriksa dan menyetel router jump, tanpa operator menyimpan atau memilih berkas apa pun. Semua yang diperlukan disimpan di komputer sekali diunduh, sehingga menyalin ke router tidak bergantung pada jaringan ke server. Dan **keadaan "sedang tersambung ke mana" dijaga oleh router, bukan oleh catatan di komputer**.

Bahan acuan nyata yang dilihat perancang: contoh paket di komputer pemilik (`Country Lock2`: `config.QC`, 8 script Mikrotik, 9 script Ubiquiti) dan ekspor konfigurasi router jump (`RB_CL_Config.rsc`). Isi keduanya menjadi dasar bagian di bawah; berkas biner (`.npk`, `.bin`, `.cfg`) tidak ada di folder itu karena sekarang hanya tersimpan di `/temp/` router jump.

## 2. Tujuan, bukan tujuan, anti-tujuan

Tujuan:
- T1. Halaman Country Lock tidak lagi meminta pengguna memilih folder atau berkas `config.QC`. Tidak ada script yang perlu disimpan operator.
- T2. Saat halaman Country Lock pertama dibuka (dan setiap kali dibuka), desktop: (a) menyelaraskan bundel di komputer dengan server, (b) memeriksa jaringan komputer, (c) memeriksa router jump dan menyamakannya dengan bundel di komputer.
- T3. Router jump yang baru, atau yang berpindah mode single/multi, disiapkan otomatis sampai Country Lock dapat berjalan.
- T4. Admin menambah firmware baru (script, berkas firmware, konfigurasi, dan lain-lain) lewat satu pendaftaran di web, dan hasilnya sampai ke komputer dan router.
- T5. Proses sinkron terlihat jelas dan terkunci lewat dialog; pengguna dapat menjalankannya di background.
- T6. Admin menyunting teks (script, pengaturan, konfigurasi router) dengan jejak riwayat seperti git: tiap perubahan tercatat, dapat dibandingkan, dikembalikan, dan versi lama dapat diaktifkan lagi.
- T7. Mode (single/multi) dan interface yang sedang aktif selalu dapat dipercaya, atau aplikasi menyatakan terang-terangan bahwa statusnya tidak diketahui.

Bukan tujuan:
- B1. OCR stiker (fase 4 spek desktop) **ditunda** [Pemilik].
- B2. Server tidak melacak keadaan router (prinsip spek desktop §5 tetap): keadaan router disimpan di router sendiri.
- B3. Tidak ada konfigurasi berbeda per router atau per komputer, kecuali dua pilihan lokal yang disebut di §5.4 (adapter Ethernet Windows) dan §5.7 (interface router yang aktif). Satu bundel aktif untuk semua [Pemilik; sama dengan spek desktop §4.1].
- B4. Kredensial **tidak** disembunyikan: tetap polos di bundel, seperti keputusan lama [Pemilik, mengonfirmasi spek desktop §4.2]. Satu-satunya pengamanan: kredensial tidak ditulis ke log (penyamaran sandi `StreamMasker` yang sudah ada tetap dipakai) [Perancang]. Catatan: bundel diunduh lewat internet dengan token bersama yang tertanam di installer publik, sehingga kredensial polos dan berkas firmware dapat diambil siapa pun yang memegang token itu (spek desktop §4.2 hanya menerima kredensial polos untuk paket di disk lokal); risiko ini diterima pemilik 2026-11-28 (§9 butir 4).
- B5. Tidak ada dukungan RouterOS v6. Semua router jump diarahkan upgrade ke v7 [Pemilik].
- B6. Tidak ada konfigurasi router berupa `.rsc` mentah. Konfigurasi router dinyatakan lewat form terstruktur (§5.6) [Pemilik].
- B7. Tidak ada kompatibilitas dengan format legacy: `config.QC`, peta `sshKeys`, field `folder`, `version`, `manualCredentialInput`, `plink.exe`/`putty.exe` tidak dibawa [Pemilik: "bersih dari hal-hal legacy"].
- B8. Mikrotik multi-port bawaan pabrik (IP statis `192.168.88.1`) **tidak** dijalankan paralel; hanya mode single (§5.7).

Anti-tujuan (gagal walau secara teknis berjalan):
- A1. Router terkunci dari desktop akibat penerapan konfigurasi atau penggantian kredensial (A6 spek desktop).
- A2. Bundel setengah jadi (unduhan putus, penerbitan belum selesai) menjadi aktif di komputer atau router.
- A3. Router dipakai inject dengan berkas atau konfigurasi usang tanpa sepengetahuan operator.
- A4. Operator kehilangan internet atau akses server karena pergantian IP komputer yang salah sasaran.
- A5. Inject menyuntik perangkat yang salah: dua perangkat ber-IP sama di satu segmen, dua port aktif di mode single, atau tabel ARP basi.
- A6. Penerapan konfigurasi yang memutus akses aplikasi ke router di tengah jalan lalu tak dapat diteruskan atau dibatalkan.

## 3. Batasan

- Desktop: Electron 45, Windows x64/arm64. Server: Bun + Hono + MariaDB, mengikuti `docs/adding-a-module.md`, kabel REST `API_ROUTES`, ID baris ULID (`newId()`), migrasi expand-only, dan kebijakan versi API di CLAUDE.md.
- Kebutuhan lama yang tetap: Country Lock berjalan tanpa login dan tanpa server setelah bundel pertama terunduh (spek desktop §10); unduhan klien tanpa sesi memakai token bersama dan pembatas percobaan per IP (spek desktop §4.3).
- Router jump selalu diperlakukan sebagai Mikrotik/RouterOS v7 [Pemilik]. Aplikasi mengurus router lewat **REST RouterOS v7** (`/rest/...`, HTTP polos port 80, otentikasi Basic; trafik hanya di kabel lokal, tidak dienkripsi: diterima pemilik). SFTP dipakai hanya untuk memindahkan berkas biner ke `/temp/`, dan SSH hanya untuk menjalankan script inject dan mengambil kunci host. Pemilik menyatakan router jump di-unlock; hasil spike di perangkat nyata masih konfirmasi, belum dilaporkan.
- Script Mikrotik berjalan **di router jump**, bukan di perangkat target (mengunggah paket lewat FTP ke target lalu `ssh-exec` reboot), karena device-mode perangkat pabrik (umumnya `home`/`basic` di RouterOS v7) membatasi unduhan dan sebagian perintah [Pemilik]. Akibatnya device-mode **router jump** sendiri harus tidak dibatasi; setup awal memeriksanya (§5.5). Script Ubiquiti berjalan di perangkat (`scp` dari `/temp/` router jump).
- Ethernet komputer operator **dikhususkan** untuk perangkat QC (router jump dan perangkat target) [Pemilik]. Mengganti IP-nya tidak memutus internet atau server.
- Hanya pemilik yang punya perangkat dan router nyata. Pembangun memakai server SSH/SFTP/REST palsu untuk tes otomatis (`desktop/test-support/fake-ssh-server.ts` dilengkapi penyimulasi REST dan router yang dapat diputus di tengah langkah); pemilik menjalankan uji perangkat nyata.
- Batas badan permintaan server (`MAX_REQUEST_BODY_BYTES`): berkas `.npk`/`.bin` umumnya belasan MB, jadi unggah admin bertahap dan unduhan streaming dengan `Range` (spek desktop §4.3).
- Satu router jump dipakai satu komputer pada satu waktu [Pemilik]. Tidak ada kunci kepemilikan.

## 4. Pendekatan yang dipertimbangkan

**4.1 Kecocokan versi komputer dan router** (keputusan penentu):
1. Satu bundel rilis dengan satu nomor versi (rancangan lama): sederhana, tetapi mengubah satu script menaikkan versi router juga dan tak ada versi campuran.
2. Dua komponen berversi sendiri dengan tabel kontrak yang diisi admin: fleksibel, tetapi tabel dapat salah isi atau basi.
3. Kontrak tertanam di paket komputer: tanpa tabel, tetapi kecocokan tak bisa dinyatakan setelah paket terbit.

**Dipilih [Pemilik]: satu bundel rilis, dengan hash sisi komputer dan hash sisi router terpisah.** Sinkron hanya berjalan bila hash yang relevan berbeda. Nomor versi bundel hanyalah label dan urutan terbit; yang menentukan kecocokan adalah hash. Alasan pemilik: tidak membingungkan, versi di komputer dan router mengikuti yang aktif di server, dan tidak ada sinkron ulang bila hash sama.

**4.2 Cara menyatakan konfigurasi router.**
1. Berkas `.rsc` yang di-`:import`: persis tetapi tidak idempoten, sulit diverifikasi dan tak ada pratinjau perubahan.
2. **Dipilih [Pemilik]: keadaan yang diinginkan (deklaratif) disunting lewat form seperti Winbox dan diterapkan lewat REST.** Aplikasi membaca keadaan router, menghitung selisih, menampilkannya sebelum persetujuan, menerapkan per bagian, dan memverifikasi dengan membaca ulang. Konsekuensi: tiap hal yang harus diatur router perlu punya bagian form; menambah jenis pengaturan baru berarti mengubah kode.

**4.3 Penyimpanan.**
1. Volume Docker di VPS: sederhana, tetapi tidak ikut `mariadb-dump` dan harus dipindah saat server pindah.
2. Kolom BLOB di MariaDB: ikut cadangan, tetapi membengkakkan dump harian dan memori `qc-db` (dibatasi 512 MB).
3. **Dipilih [Pemilik setuju]: gabungan.** Teks (script, pengaturan, konfigurasi router, semua revisi) di MariaDB; berkas biner di Google Drive memakai pola yang sudah ada (§5.2).

**4.4 Riwayat revisi.** Memasang repositori git sungguhan di server ditolak: image server tidak memuat git, izin/Log Audit/ID/cadangan sudah ada di basis data, dan CodeMirror 6 (dengan `@codemirror/merge`) sudah punya tampilan perbandingan. **Dipilih [Perancang; arah disetujui pemilik]: model revisi sendiri di basis data**, meniru konsep git (§5.2).

## 5. Rancangan

### 5.1 Bundel dan hash
- Satu **bundel** bernomor (bilangan bulat naik tiap penerbitan), tidak dapat diubah setelah terbit. Isinya: **dokumen pengaturan** berskema baru (§5.2), script per merk dan firmware, berkas router `role: asset` (biner di `/temp/`), dan **keadaan router yang diinginkan** (§5.6). Tiap berkas bertujuan `laptop` atau `router`, ber-`sha256` dan ukuran.
- Manifest memuat dua hash tambahan [Pemilik]:
  - `computerHash` = sha256 atas daftar terurut `path` + `sha256` semua berkas `laptop` ditambah bagian pengaturan yang dipakai komputer (alamat IP komputer, daftar merk dan firmware, mode, kredensial bawaan target).
  - `routerHash` = sha256 atas daftar terurut `path` + `sha256` semua berkas `router`, ditambah dokumen keadaan-diinginkan yang **sudah diselesaikan** (nilai turunan seperti rentang pool DHCP sudah dihitung, jadi mengganti IP komputer mengubah hash), ditambah hash kredensial router jump [Perancang].
- Manifest juga membawa `schema` dan `minApp` (§5.10 butir 7). Bagian keadaan router (§5.6) baru ditambahkan ke bundel setelah spike REST (fase 4); sebelum itu `routerHash` hanya mencakup berkas router dan kredensial, lalu skemanya dinaikkan lewat `schema` dan `minApp` [Perancang].
- Bundel yang **aktif** = bundel terbit terbaru; mengaktifkan versi lama = menerbitkannya lagi sebagai bundel baru (§5.2).

### 5.2 Server (fase 1)
- Modul server baru (nama [Builder], mis. `countrylock`), izin baru untuk melihat dan mengelola, Log Audit.
- **Dokumen pengaturan** menggantikan `config.QC`, disunting lewat form yang divalidasi (tanpa tab JSON mentah [Perancang]). Isinya:
  - Router jump: alamat (`server.ip`), kredensial, nama bridge.
  - Jaringan komputer: IP dan panjang awalan yang diharapkan.
  - Per merk: label, username dan password bawaan target, templat tautan web (memuat `{ip}`), daftar firmware (tiap firmware punya kode, label, script, dan penanda `paralel` = boleh dijalankan paralel di mode Multi, bawaan tidak [Perancang]), dan per mode (single/multi): `ip`, `ipServer`, `connectVia` (`Target` atau `Server`), bridge, serta profil runtime mode (§5.7).
  - Tidak ada lagi: `folder`, `version`, `manualCredentialInput`, `sshKeys` (kunci host router diambil dari jabat tangan SSH, sebagaimana sudah diputuskan di kode), `interfaceList` dan `interfaceComp` (digantikan deteksi dan pilihan per router, §5.7).
- **Riwayat revisi per berkas seperti git** [Pemilik]:
  - Tiap **Simpan** menghasilkan satu **revisi** (penulis, waktu, catatan perubahan yang boleh kosong). Revisi tidak pernah diubah atau dihapus [Perancang: otomatis per Simpan, bukan tombol Commit terpisah].
  - **Draf** = revisi terbaru tiap berkas. **Bundel terbit** = foto dari revisi tiap berkas pada saat terbit.
  - **Perbandingan** dua revisi memakai tampilan diff CodeMirror 6 (`@codemirror/merge`). **Pengembalian** (revert) = memilih revisi lama menghasilkan **revisi baru** berisi isi lama; riwayat tidak ditulis ulang. **Mengaktifkan versi lama** = menerbitkan bundel lama sebagai bundel baru.
  - Berkas biner dan berkas yang tak dapat disunting: riwayatnya berupa daftar versi (hash, ukuran, pengunggah, waktu), tanpa diff teks.
  - Tanpa cabang dan merge. Dua admin yang menyunting berkas yang sama dijaga penguncian versi `If-Match`/`ETag` (spek desktop §4.3).
- **Editor admin di web**: CodeMirror 6 untuk script (dimuat malas; keputusan pemilik 2026-11-28, §9 butir 5, menggantikan Monaco), form untuk pengaturan dan keadaan router, unggah bertahap untuk berkas biner.
- **Penyimpanan**: teks dan revisi di MariaDB (ikut cadangan harian). Berkas biner di **subfolder Google Drive** di bawah folder induk (pola `GOOGLE_ROOT_FOLDER_ID` dan `folderIdOf`, tanpa variabel `.env` baru), dinamai menurut `sha256` sehingga berkas yang sama dipakai banyak bundel tersimpan sekali. Tabel katalog biner mencatat `sha256`, ukuran, id Drive, dan MD5; unggah idempoten dengan verifikasi MD5 seperti rilis desktop. Berkas biner yang dirujuk bundel terbit **tidak pernah dihapus**; biner draf yang tak dirujuk apa pun disapu otomatis setelah masa tenggang [Builder]. Pemilik menyiapkan dan mengunggah berkas biner sendiri; **tidak ada fitur mengunduh dari router jump** [Pemilik].
- **Validasi saat menerbitkan** [Perancang]: (a) setiap rujukan `/temp/<nama>` di script harus ada di bundel sebagai berkas router; (b) placeholder dalam script harus dikenal (`ipTarget`, `usernameTarget`, `passwordTarget`, `ipServer`, `usernameServer`, `passwordServer`, `sshKey`); (c) pengaturan valid (IP sah, kode firmware unik, tiap firmware punya script, nama bridge ada di keadaan router); (d) peringatan, bukan penolakan, bila ada berkas router yang tak dirujuk script mana pun, dan bila script Mikrotik memuat `/ip arp remove [find]` tanpa filter alamat (merusak inject paralel, §5.7); (e) `schema`/`minApp` (§5.10 butir 7); (f) **peringatan keras** bila `server.ip`, IP komputer, atau nama bridge berbeda dari bundel terbit sebelumnya, dengan daftar akibatnya (router yang terpasang masih di alamat lama, komputer pindah segmen); penerapannya lewat tangga komunikasi §5.5 (MNDP lalu sambung ulang), bukan larangan [Perancang]. Editor menampilkan **"dipakai oleh"** untuk tiap berkas router (contoh: `system.cfg` dipakai bersama oleh lebih dari satu firmware Ubiquiti).
- **Pendaftaran firmware baru** [Pemilik]: satu alur di admin: kode dan label, script (editor), lalu aplikasi mendeteksi berkas `/temp/...` yang dirujuk dan placeholder yang dipakai; berkas yang belum ada diminta diunggah. Hasilnya satu entri firmware di dokumen pengaturan dan masuk bundel draf. **Daftar firmware menjadi data dinamis di server** [Pemilik 2026-11-28, §9 butir 3]: Data Item (`items.firmware`) memilih dari daftar **draf** (jadi firmware dapat dipasang ke Tipe sebelum bundel terbit; desktop sudah menampilkan alasan bila firmware belum ada di bundel aktif), menghapus firmware yang masih dipakai item hidup **ditolak**, dan `shared/firmware.ts` (`FIRMWARE_BY_BRAND`) beserta tes paritasnya dihapus [Perancang].
- **Impor sekali pakai** dari folder paket lama (script dan `config.QC`) ke draf, supaya tidak mengetik ulang; berkas biner tidak ikut dan diunggah pemilik sendiri [Perancang]. Alat ini boleh dibuang setelah bundel pertama [Builder].
- Unduhan klien: manifest (ETag) dan berkas lewat token bersama, tanpa sesi, dengan pembatas percobaan salah per IP dan `Range`; server meneruskan berkas dari Drive sebagai aliran. Desktop memverifikasi `sha256` setelah unduh. Batas laju unduhan sah dan jalur berkas: lihat §9 butir 6 dan 7.

### 5.3 Komputer: sinkron bundel (fase 2)
- Desktop memeriksa manifest saat halaman Country Lock dibuka, saat kembali fokus, dan berkala. Bila server terjangkau dan bundel aktif berbeda, bundel baru diunduh ke folder staging, semua `sha256` diverifikasi, lalu dijadikan aktif lewat pergantian penunjuk atomik; versi sebelumnya disimpan untuk pemulihan (spek desktop §4.4).
- **Seluruh berkas, termasuk berkas router, disimpan di komputer** [Pemilik], supaya sinkron ke router tidak butuh server. Ukuran total belum diketahui; batas cache [Builder].
- Server tak terjangkau = pakai bundel aktif terakhir. Belum pernah ada bundel = keadaan "belum ada bundel"; unduhan pertama butuh server sekali.
- **Dihapus dari desktop**: pemilih folder paket, pembukaan `config.QC` dari disk, `packageDir`, dan `parseConfig` berformat lama (diganti pembaca dokumen pengaturan baru).

### 5.4 Komputer: jaringan (fase 3)
- Bundel menyatakan IP komputer yang diharapkan pada Ethernet QC (alamat dan panjang awalan) [Pemilik: dari konfigurasi server]. Desktop memeriksa adapter Ethernet QC; bila IP tidak sesuai, **bentrok** dengan perangkat lain, atau beda segmen dengan router jump, desktop mengganti IP adapter itu ke nilai bundel [Pemilik].
- Mengganti IP butuh hak admin Windows: satu permintaan UAC saat perlu, hanya bila ada ketidakcocokan [Perancang; cara teknisnya, mis. PowerShell dengan `RunAs`, [Builder]].
- **Adapter Ethernet Windows yang dipakai dipilih per komputer dan disimpan lokal** [Pemilik: tiap komputer fleksibel]. Tebakan awal = adapter berkabel yang bukan pembawa jalur internet; bila ragu, ditanyakan sekali lalu diingat [Perancang].
- IP komputer ini sekaligus menjadi `ExcludeIp` untuk pemindaian Multi dan alamat yang dikeluarkan dari pool DHCP router (§5.6), menggantikan pengaturan lokal manual di spek desktop §4.2 [Perancang].

### 5.5 Router jump: menemukan, berkomunikasi, dan masuk (fase 5)
**Tangga komunikasi (IP lalu lapis 2)** [Pemilik: fallback ke MAC bila IP tak terjangkau]:
1. **IP.** Alamat router dari `server.ip` di pengaturan. REST (HTTP port 80) untuk membaca dan mengatur, SFTP untuk berkas biner ke `/temp/`, SSH untuk inject dan kunci host (algoritma `ssh-rsa`, sesuai script yang menulis `ssh-rsa` di `known_hosts` perangkat).
2. **Penemuan lewat MNDP** bila IP tak terjangkau: siaran MNDP (UDP 5678) pada adapter QC memberi MAC, IP, versi, dan tipe board router. Bila router di segmen lain, IP komputer disesuaikan (§5.4) lalu koneksi diulang. Windows Firewall harus mengizinkan penerimaan UDP 5678 [Builder].
3. **Jalur darurat lapis 2 (MAC-Telnet)**: hanya untuk menyetel IP router lewat baris perintah ketika IP tak bisa dijangkau sama sekali; setelah IP ada, REST mengambil alih. MAC-Telnet tidak memindahkan berkas dan tidak menggantikan SFTP. Risiko: protokol tertutup, otentikasi RouterOS baru, mungkin butuh Npcap. **[Spike]: dibangun hanya setelah dibuktikan di router nyata** (fase 7, tidak menghalangi fase lain).
4. **Bentrok IP pabrik saat setup awal.** Router pabrik memakai `192.168.88.1`, sama dengan IP Mikrotik target bawaan pabrik. Selama setup awal tidak boleh ada perangkat target di segmen yang sama; aplikasi mendeteksi alamat ganda (MNDP/ARP) dan meminta perangkat target dicabut dulu [Perancang].

**Versi dan device-mode** [Perancang]: aplikasi membaca versi RouterOS dan device-mode lewat REST. Versi di bawah 7 ditolak dengan pesan "router jump harus RouterOS v7". Device-mode yang membatasi `fetch`/`ssh-exec` ditolak dengan panduan; mengubah device-mode di RouterOS umumnya butuh konfirmasi fisik di perangkat **[Spike]**.

**Kredensial gagal** [Pemilik]: dialog dua pilihan: (a) masukkan kredensial yang berlaku sekarang; sesudah login, kredensial router diganti ke yang ada di bundel agar seragam, **paling akhir** dengan login ulang diverifikasi sebelum penanda ditulis [Perancang]; atau (b) reset ke pabrik, **dipandu manual** (tombol reset fisik atau Netinstall; aplikasi tidak bisa mereset tanpa login), lalu aplikasi menunggu router muncul lagi (MNDP) dengan pengaturan pabrik dan melanjutkan setup awal otomatis. **Peringatan bahwa semua konfigurasi dan berkas di router akan dibersihkan atau diganti ditampilkan pada setiap sinkron yang mengubah konfigurasi**, bukan hanya reset. **Panduan password pabrik** [Pemilik]: sebagian router MikroTik punya password acak bawaan pabrik pada label perangkat; panduan "lihat label perangkat" ditampilkan **setiap kali login gagal karena kredensial**.

### 5.6 Router jump: keadaan yang diinginkan (form seperti Winbox; fase 5, skema dibekukan setelah spike fase 4)
Konfigurasi router dinyatakan sebagai dokumen deklaratif yang disunting di admin (satu form per bagian) dan diterapkan lewat REST. Bagian-bagiannya diturunkan dari `RB_CL_Config.rsc` pemilik:

| Bagian | Catatan |
|---|---|
| Bridge | `BridgeAll`, `UBNTSingle`. `BridgeNet` (beserta DHCP client-nya) dan `BridgeMikrotik` **dibuang** [Pemilik] |
| IP Address | alamat router di segmen perangkat (mis. `192.168.88.2`, alias NAT `192.168.88.50`, `192.168.1.1` di `UBNTSingle`) |
| IP Pool | **dihitung otomatis**: subnet dikurangi semua alamat milik router dan IP komputer bundel [Perancang]. Contoh yang diperbaiki: pool `ALL` lama memuat `192.168.88.50`, alamat router sendiri |
| DHCP Server dan Network | server `All` (Multi) dan `MikrotikOnly` (mengunci Mikrotik ke `192.168.88.1`); yang aktif termasuk keadaan runtime (§5.7) |
| NAT | src-nat dan dst-nat untuk jalur Ubiquiti single (`.50` ke `192.168.1.20`) |
| DNS, Connection Tracking, pengaturan IP dan IPv6, Waktu dan NTP | pengaturan tetap |
| Pengguna dan Layanan | kredensial router; layanan REST (`www`), SSH, FTP, SFTP aktif |
| Dibuang | pool `pool1` dan `dhcp_pool3`, route nonaktif `192.168.11.0/24` [Perancang] |

- Tabel di atas hanya ringkasan. Berkas `RB_CL_Config.rsc` diserahkan pemilik kepada pembangun di luar repo pada fase 5, dan bentuk field tiap bagian ditentukan setelah spike [Perancang].
- **Penerapan**: baca keadaan router lewat REST, hitung selisih, tampilkan daftar perubahan beserta peringatan penghapusan, minta persetujuan, terapkan per bagian dalam urutan yang tidak memutus akses, baca ulang tiap bagian untuk verifikasi, dan tulis penanda **terakhir** (§5.7). Bagian runtime (port bridge aktif, server DHCP aktif) tidak ditimpa oleh penerapan bundel; itu urusan mode (§5.7).
- **Router baru dari pabrik** membawa konfigurasi bawaan (bridge `bridge`, server DHCP, NAT, aturan firewall, IP `192.168.88.1`) yang bertabrakan dengan keadaan yang diinginkan. Urutan [Perancang; rinci [Builder]; **[Spike]**]: sambung ke IP pabrik, tambah objek baru (bridge, alamat `server.ip`), pindahkan port komputer paling akhir, sambung ulang ke `server.ip`, baru hapus objek bawaan pabrik. Reset konfigurasi total tidak dipakai di tengah proses karena router kehilangan IP dan REST tak dapat dipakai lagi.

### 5.7 Router jump: keadaan runtime, mode, dan interface (fase 6)
**Prinsip: router adalah satu-satunya sumber kebenaran untuk apa yang sedang tersambung.** Komputer hanya menyimpan *niat* dan *pengamatan terakhir*, tidak pernah menjadikannya kebenaran. Indeks rotasi tidak disimpan di komputer.

- **Yang menjadi keadaan runtime**: keanggotaan port di bridge dan server DHCP yang aktif (`All` atau `MikrotikOnly`). Mode dibaca dari keadaan itu: single = tepat satu port aktif selain port komputer; Multi = semua port yang dipilih ada di bridge. Profil per mode dan merk [Perancang, dari `config.QC` contoh pemilik]:

| Mode | Port aktif masuk ke | Server DHCP aktif | Alamat perangkat | `connectVia` |
|---|---|---|---|---|
| Mikrotik single | `BridgeAll` | `MikrotikOnly` | `192.168.88.1` (terkunci) | Server |
| Ubiquiti single | `UBNTSingle` | tidak dipakai | alias `192.168.88.50` (NAT ke `192.168.1.20`) | Target |
| Multi | semua port terpilih di `BridgeAll` | `All` | dari tabel lease | Server |

- **Penanda keadaan di router**: nomor bundel, `routerHash` yang terpasang, mode yang dimaksud, waktu terakhir diubah. Ditulis **terakhir**, setelah semua langkah terverifikasi, dan harus dapat dibaca lewat REST (bentuknya [Builder], mis. objek skrip bernama). Penanda hanya untuk mendeteksi penyimpangan; kebenaran tetap tabel port dan server DHCP yang nyata. Reset pabrik menghapus penanda sehingga router dikenali sebagai baru.
- **Interface**: aplikasi membaca daftar interface ethernet dari router (nama, status, MAC, tipe board) lewat REST, jadi tipe router dengan jumlah port berbeda tidak masalah [Pemilik]. Pengguna memilih interface mana yang aktif lewat daftar centang. Pilihan **disimpan di komputer dan dikunci menurut identitas router** (MAC atau serial), bukan per komputer, sehingga komputer yang berpindah router mengingat pilihan tiap router. Router yang baru dilihat dimulai dengan semua port ethernet selain port komputer, dikonfirmasi pengguna. Pilihan ini tidak masuk hash bundel.
- **Port komputer** dideteksi otomatis dari tabel host bridge (port tempat MAC komputer terlihat) **[Spike]**; bila gagal, ditanyakan sekali. Port ini tidak pernah disentuh.
- **Ganti mode adalah transaksi dengan jurnal niat**: (1) tulis niat `dari → ke` ke jurnal lokal; (2) terapkan; (3) baca ulang dan verifikasi; (4) baru setelah itu UI berpindah dan jurnal ditutup. Urutan langkah **tidak pernah meninggalkan router tanpa port aktif**: tambahkan port tujuan dulu, baru hapus yang lain. Memilih mode di halaman memicu setup mode lewat dialog terkunci (§5.8) dengan satu konfirmasi (menggantikan tombol manual "Siapkan bridge").
- **Rekonsiliasi** bila koneksi putus di tengah, atau penanda dan kenyataan berbeda:

| Kenyataan di router | Tindakan |
|---|---|
| Sama dengan tujuan | Dianggap selesai, tutup jurnal |
| Sama dengan asal | Belum sempat berubah: ulangi atau batalkan |
| Setengah jadi (mis. dua port aktif di mode single) | Terapkan ulang. Tanpa jurnal: tampilkan port aktif beserta MAC di tiap port dan minta pengguna memilih yang dipertahankan |
| Berbeda dari keduanya tanpa jurnal (mis. diubah manual di Winbox) | **Menyimpang**: tampilkan selisih dan minta persetujuan sebelum menimpa |

- **Pemeriksaan sebelum setiap inject** (satu pembacaan REST): keadaan port dan penanda sama dengan yang diyakini UI; mode single wajib tepat satu port aktif; MAC yang dilihat komputer untuk IP target sama dengan MAC yang dilihat router di port aktif. Gagal salah satu = inject berhenti dan rekonsiliasi berjalan (A5).
- **Denyut**: router diperiksa berkala. Saat putus, status menjadi "Terputus, status tidak diketahui sejak HH:MM" dan inject dikunci; saat tersambung lagi rekonsiliasi berjalan otomatis.
- **Paralel Mikrotik**: kelas wireless-only (satu ethernet, DHCP client, tak dikunci) boleh di mode Multi bila firmware-nya bertanda `paralel` (§5.2; mesin Multi saat ini hanya mendukung Ubiquiti dan diperluas [Builder: periksa kode]), karena mendapat IP unik dari server `All` dan script memakai `{ipTarget}` (tanpa IP literal). Mikrotik multi-port pabrik (statis `192.168.88.1`) hanya mode single (B8). Pengaman: bila daftar neighbor (`/ip/neighbor`) memuat dua perangkat ber-alamat sama, inject berhenti dengan pesan "dua perangkat ber-IP sama, pakai mode single". Script Mikrotik wajib memakai `/ip arp remove [find address={ipTarget}]`, bukan `[find]` global (dicek saat menerbitkan, §5.2). Jalur paralel untuk multi-port lewat VRF atau pemberian IP lapis 2 **[Spike]** ditunda ke fase 7.

### 5.8 Router jump: sinkron (fase 5)
Algoritma mengikuti spek desktop §5, dengan perubahan di bawah.
1. Periksa versi RouterOS dan device-mode (§5.5). Bandingkan `routerHash` penanda dengan `routerHash` bundel di komputer (bila server terjangkau, bundel aktif di server dicek dan diunduh lebih dulu). Sama = tidak ada yang dikerjakan.
2. Beda = tentukan berkas router yang hilang, berbeda, atau tak lagi dikelola; salin lewat SFTP ke `/temp/` dengan nama sementara, periksa ukuran, ganti nama; hapus hanya berkas yang pernah dikelola. Terapkan keadaan yang diinginkan (§5.6) dengan cadangan pra-penerapan (ekspor konfigurasi, [Builder]), lalu ganti kredensial bila beda.
3. Tulis penanda **terakhir**, hanya setelah semua langkah sah. Penanda lama berarti sinkron belum selesai dan diulang. Sinkron terputus tidak pernah meninggalkan penanda palsu.
4. Setiap sinkron yang akan mengubah router memerlukan persetujuan operator di dialog (ringkasan versi, berkas dan bagian yang berubah, peringatan penghapusan) [Pemilik, memperluas spek desktop §5.1]. Tanpa perubahan, tak ada dialog.
- **Gerbang inject**: inject diblokir sampai `routerHash` router sama dengan bundel di komputer, jaringan komputer sesuai, dan pemeriksaan sebelum inject (§5.7) lolos (A3, A5).

### 5.9 Dialog sinkron dan halaman Country Lock
- Seluruh proses (§5.3-5.8) berjalan dalam **alert dialog yang terkunci** [Pemilik]: langkah, progres, dan hasil. Selama proses, fitur Country Lock tidak dapat dipakai.
- Tombol **"Jalankan di background"** menutup dialog dan membiarkan proses jalan; pengguna dapat memakai bagian lain QC App. Indikator progres tetap terlihat di header [Perancang]. Kembali ke halaman Country Lock selagi proses jalan memunculkan dialog lagi [Pemilik].
- Pembatalan hanya tersedia di antara langkah (tidak di tengah penulisan ke router), dan menutup aplikasi saat router sedang ditulis meminta konfirmasi [Perancang].
- Halaman Country Lock tidak lagi punya langkah "buka `config.QC`" dan menampilkan informasi router jump (identitas, versi, mode, interface aktif, status penanda).

### 5.10 Pilihan perancang hasil peninjauan (pemilik dapat mengubah)
1. **Router tanpa penanda diperlakukan sebagai router baru.** Selisih keadaan nyata terhadap keadaan yang diinginkan ditampilkan lewat REST, operator menyetujui, ada cadangan pra-penerapan; tidak ada mode "adopsi" tanpa menerapkan (lihat §9 butir 2).
2. **Pindah IP saat setup router baru/reset.** Komputer pindah sementara ke segmen router pabrik, keadaan yang diinginkan diterapkan, lalu komputer kembali ke IP bundel. Seluruh urutan memakai **satu** sesi dengan hak admin (satu UAC), bukan satu UAC per pergantian IP. Putusnya koneksi karena IP router berubah ditangani dengan sambung ulang ke `server.ip` dan verifikasi sebelum penanda ditulis (A1, A4, A6).
3. **Kredensial yang berganti.** Sebelum dialog "kredensial gagal" muncul, desktop mencoba kredensial bundel aktif lalu kredensial bundel-bundel sebelumnya yang masih tersimpan di komputer. Dialog baru tampil bila semuanya gagal.
4. **Tanpa masa peralihan.** Jalur lama (pemilih folder, `packageDir`, `parseConfig` lama) dibuang sekali jalan pada rilis desktop fase 2; tidak ada dua pembaca konfigurasi. Syaratnya: bundel versi 1 sudah diterbitkan lewat impor sekali pakai (§5.2) **sebelum** rilis itu dipasang di komputer operator. Komputer tanpa bundel dan tanpa server menampilkan keadaan "belum ada bundel".
5. **Rotasi bridge setelah inject sukses** adalah operasi normal dan tidak dihitung sebagai perubahan router yang butuh persetujuan §5.8.4. Rotasi interface mode tunggal belum ada di kode dan dibangun mengikuti lampiran legacy §4.1 dengan aturan §5.7.
6. **Kode yang diganti**: perintah teks SSH untuk bridge (`multi/bridge-plan.ts`) dan pembaca lease (`multi/lease.ts`) diganti klien REST; inject, pembaca info perangkat, dan penyamaran sandi tetap lewat SSH.
7. **Kompatibilitas aplikasi.** Manifest membawa `schema` dan `minApp` (versi aplikasi desktop minimum, pola `minBridge`). Desktop yang lebih lama menolak bundel itu, tetap memakai bundel lama, dan menampilkan permintaan memperbarui aplikasi. Server menolak penerbitan bundel yang memakai bagian pengaturan yang tak dikenal skemanya, kecuali admin menaikkan `minApp`.
8. **Risiko biner**: Drive menyimpan berkas, tetapi tabel katalognya ikut cadangan basis data; pemulihan basis data tanpa folder Drive membuat rujukan menggantung. Pemeriksaan konsistensi katalog terhadap Drive [Builder].

## 6. Dampak pada dokumen lain dan kewajiban pencatatan

Sebagai bagian pengerjaan (aturan pemilik: keputusan di luar atau berbeda dari spek dicatat di spek terkait, lengkap dengan tanggal, alasan, dan persetujuan pemilik), spek desktop 2026-11-06 diubah, bukan hanya diberi catatan:
- §4.1: satu manifest dengan `computerHash` dan `routerHash`, dokumen pengaturan menggantikan `config.QC`; §4.2: `ExcludeIp` diturunkan dari IP komputer bundel; kredensial tetap polos.
- §5 dan gerbang inject: dibandingkan lewat `routerHash`, jaringan komputer, dan pemeriksaan sebelum inject; §5.1: konfigurasi router lewat keadaan deklaratif dan REST (bukan `.rsc` `:import`), persetujuan operator pada setiap sinkron yang mengubah router, dan penyamaan kredensial router.
- §9: fase 4 (OCR) ditandai ditunda 2026-11-28; baris fase 2 menunjuk dokumen ini untuk paket konfigurasi dan sinkron router.
- Keputusan 2026-11-18 "firmware per Tipe dari daftar tetap per merk" (CLAUDE.md, `shared/firmware.ts`) diganti daftar dinamis (diputuskan pemilik 2026-11-28, §9 butir 3).
- `CLAUDE.md` bagian desktop dan checklist `docs/e2e-checklist-desktop.md` diperbarui seiring selesainya tiap fase; `docs/ci-cd.md` mencatat folder Drive dan cadangan katalog biner.

## 7. Fase pengerjaan (berurutan; tiap fase diuji perangkat nyata oleh pemilik sebelum fase berikutnya diandalkan)

1. Server: modul, model revisi, penyimpanan teks dan biner (Drive), editor admin (script dan form pengaturan), validasi penerbitan, pendaftaran firmware, impor sekali pakai, unduhan klien. **Bagian keadaan router (form, hash, validasi) tidak dibangun di fase ini**: skemanya menunggu hasil spike (fase 4) dan ditambahkan di fase 5 lewat kenaikan `schema`/`minApp` [Perancang].
2. Komputer: sinkron bundel, penyimpanan lokal, pembuangan jalur lama sekali jalan: pemilih folder, `packageDir`, `config.QC` (§5.10 butir 4).
3. Komputer: pemeriksaan dan penyetelan jaringan.
4. **Spike REST di router asli** (skrip sekali pakai milik pemilik; hasilnya menentukan dugaan bertanda [Spike] sebelum fase 5 dibangun): CRUD REST untuk bagian §5.6, unggah SFTP ke `/temp/`, pembacaan device-mode, deteksi port komputer lewat tabel host bridge, urutan setup awal tanpa memutus akses, perilaku `/ip/neighbor`.
5. Router: komunikasi (REST, MNDP, versi, device-mode), kredensial, sinkron berkas dan keadaan yang diinginkan (form dan skema keadaan router ditambahkan di server lebih dulu), penanda, gerbang inject, dialog.
6. Router: setup awal dari pabrik, keadaan runtime, ganti mode, deteksi interface, rekonsiliasi, pemeriksaan sebelum inject, paralel Mikrotik wireless-only.
7. Jalur darurat lapis 2 (MAC-Telnet) dan paralel Mikrotik multi-port: spike dulu, bangun hanya bila lulus.

## 8. Risiko dan hal yang harus divalidasi di perangkat nyata

- REST RouterOS: cakupan sumber daya yang dibutuhkan (§5.6), perilaku saat IP/bridge berubah di tengah penerapan, ada tidaknya jalan unggah berkas lewat REST (dugaan: tidak ada, SFTP tetap dipakai), versi tujuh router jump yang sebenarnya.
- SFTP RouterOS ke `/temp/`, penggantian nama via SFTP, cara memverifikasi hash di router (bila tak ada: ukuran + penanda).
- Device-mode router jump dan cara mengubahnya.
- Urutan setup awal dari pabrik tanpa kehilangan akses (§5.6), cadangan dan pemulihan bila koneksi terputus, penggantian kredensial agar tidak mengunci.
- Deteksi port komputer lewat tabel host bridge, `/ip/neighbor` untuk mendeteksi alamat ganda, urutan "tambah dulu baru hapus" pada rotasi.
- Hak admin Windows untuk mengganti IP, deteksi IP bentrok, memilih adapter yang benar, penerimaan MNDP di Windows Firewall.
- Ukuran total cache bundel di komputer dan kuota Drive.
- MAC-Telnet (fase 7): kecocokan protokol dan otentikasi, kebutuhan driver.

## 9. Pilihan perancang yang menunggu konfirmasi pemilik

Butir 1-2 belum dijawab pemilik secara eksplisit; perancang mengambil pilihan di bawah dan pemilik cukup menyetujui atau mengubahnya saat membaca dokumen ini. Butir 3 dan 4 sudah diputuskan pemilik.
1. **Setiap Simpan otomatis menjadi satu revisi** dengan catatan opsional (§5.2), bukan tombol "Commit" dengan catatan wajib.
2. **Router yang sudah berjalan di lapangan tanpa penanda** diperlakukan sebagai router baru (§5.10 butir 1): selisih ditampilkan lewat REST, operator menyetujui, ada cadangan; tidak ada "adopsi" diam-diam. Pilihan lain: menunggu pemilik memastikan konfigurasinya teruji dulu.
3. **[Pemilik 2026-11-28: dinamis.] Daftar firmware menjadi data dinamis** di server (§5.2): firmware baru dapat langsung dipilih di Data Item tanpa rilis aplikasi; Item memilih dari daftar draf dan firmware yang masih dipakai item hidup tidak dapat dihapus. Pilihan yang ditolak pemilik: tetap daftar di kode (firmware baru butuh rilis). Ini mengubah keputusan 2026-11-18 dan menyentuh modul Item (`items.save`, form Item).
4. **[Pemilik 2026-11-28: risiko diterima.] Kredensial polos dan berkas firmware diunduh lewat internet** dengan token bersama yang tertanam di installer publik (B4). Dasarnya: kredensial yang dibawa bundel adalah bawaan pabrik yang umum diketahui (mis. admin tanpa sandi, `ubnt`/`ubnt`), pembatas percobaan per IP berlaku, dan token berganti bersama rilis desktop. Bila kredensial router jump kelak diganti ke nilai yang sungguh rahasia, keputusan ini harus ditinjau ulang. Pilihan yang ditolak pemilik: unduhan bundel mewajibkan login (mengorbankan "Country Lock jalan tanpa login pada pemasangan pertama").

**Keputusan pemilik 2026-11-28 (setelah Fase 1).** Disetujui pemilik produk pada 2026-11-28. Keputusan ini mengubah butir spek yang bertentangan (§3, §5.2, §8 dan butir di bawah), dan menutup pertanyaan terbuka yang terkait.
5. **Editor admin = CodeMirror 6 (+ `@codemirror/merge` untuk diff), BUKAN Monaco.** Alasan: Monaco `editor.api` 598 KB gzip dan versi lengkap 851 KB melewati anggaran 600 KB gzip per potongan (`verify-dist`); Monaco butuh worker, sedangkan CSP desktop tak punya `worker-src`; Monaco kurang ramah ponsel. Skrip `.rsc` tak punya grammar di kedua editor, jadi keunggulan IntelliSense Monaco tak terpakai. CodeMirror 6 sekitar 116 KB gzip dan dimuat malas. Butir ini menutup deviasi pembangun "belum disetujui pemilik" di spek 2026-11-06 dan di sini, dan pertanyaan ukuran editor.
6. **Batas laju unduhan sah `/api/desktop/countrylock/*`** (manifest dan `files/<sha256>`): 600 permintaan per 10 menit per IP, longgar karena satu IP kantor dipakai banyak komputer dan satu sinkron mengunduh banyak berkas. Di atas batas itu server menjawab 429 dengan `Retry-After`. Batas ini terpisah dari pembatas percobaan gagal (20 per 10 menit). Angka ini perlu diukur pola sinkron nyata di staging; tebakan batas kecil per IP ditolak.
7. **Jalur berkas Windows ditolak oleh `validateClPath`.** Desktop menulis berkas ini ke disk Windows, jadi server menolak: nama cadangan `CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`, `LPT1`-`LPT9`; segmen yang berakhir titik atau spasi; karakter `<>:"|?*`; huruf drive dan ADS (`:`).
8. **Impor tanpa tebakan IP komputer.** Halaman impor mewajibkan field "IP komputer" diisi pengguna sebelum impor. Tebakan bawaan (`.3` atau `.4` dalam satu segmen dengan router, yang sebelumnya diisi `parseLegacyConfig`) tidak dipakai lagi. IP komputer tetap wajib sesuai §5.4.
9. **Sesi unggah yang gagal verifikasi ditandai `aborted`.** Bila sha256 atau ukuran tak cocok saat `finish`, sesi berstatus `aborted` dan potongannya dibuang; klien memulai sesi baru. Sesi tak pernah dapat diulang setelah gagal.

## 10. Diserahkan ke builder

Nama modul dan izin server, bentuk tabel dan rute API, skema dokumen pengaturan dan keadaan router, bentuk dan lokasi penanda router, urutan penerapan yang tidak memutus akses, cara teknis mengganti IP dan memilih adapter, strategi unggah bertahap, batas cache, masa tenggang penyapu biner, bentuk indikator background, cara cadangan pra-penerapan, dan pemeriksaan konsistensi katalog biner terhadap Drive.
