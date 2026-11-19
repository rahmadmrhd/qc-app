# Desktop: Mode Multi-Device (Fase 3), rancangan

Tanggal: 2026-11-19. Status: **menunggu persetujuan pemilik** (keputusan Inject All dan bridge 2026-11-19 sudah disetujui). Induk: `2026-11-06-qc-desktop-country-lock-design.md` §6.4 dan §9 fase 3. Perilaku aplikasi lama: `2026-11-06-countrylock-legacy-behavior.md` bagian 4 (rujukan "L4.x" di bawah).

## Maksud

Pemilik produk ingin desktop QC setara aplikasi WPF lama (G2 spek induk, "fitur 100% sama"). Mode Multi-Device meng-inject banyak perangkat **Ubiquiti** sekaligus: perangkat ditemukan lewat DHCP lease di router jump, tiap perangkat dipantau sendiri, dan inject berjalan paralel dengan batas yang bisa diubah. Alasannya: satu operator mengunci puluhan perangkat per batch tanpa menunggui satu per satu. Hasil inject yang sukses masuk ke draft Catat Serial Number yang sama dengan mode tunggal (PR #124).

## Keputusan pemilik

- **Satu Tipe per batch** (2026-11-19). Operator memilih Tipe, Business Unit, dan Lokasi sekali; semua perangkat yang sukses di-inject pada batch itu dicatat dengan nilai itu. Model perangkat yang terbaca hanya ditampilkan, tidak memilih Tipe (konsisten dengan keputusan 2026-11-18 bahwa Tipe tidak dipilih otomatis).
- **Arsitektur B** (2026-11-19). Mesin Multi hidup di proses utama; logikanya murni di `countrylock/`; renderer hanya menampilkan snapshot dan mengirim perintah.
- **Inject All melewati perangkat yang serialnya sudah terdaftar** (2026-11-19, disetujui pemilik produk). Aplikasi lama tidak membedakannya; kini Inject All hanya mengantre perangkat `ready` yang bukan `alreadyRegistered` dan belum di-inject pada sesi ini. Inject manual per perangkat (tombol Inject/Retry di baris) tetap boleh untuk perangkat terdaftar. Alasan: mencegah inject ulang tak sengaja atas perangkat yang sudah tercatat. Menutup pertanyaan terbuka "apakah Inject All ikut menyapu perangkat terdaftar".
- **"Siapkan bridge router" diblokir saat ada inject berjalan** (2026-11-19, disetujui pemilik produk), baik inject tunggal maupun Multi (termasuk perangkat `queued` dan inject yang baru dibatalkan dan belum selesai). Host menolak dengan pesan "Tidak dapat menyiapkan bridge saat inject sedang berjalan" dan tombol di panel nonaktif dengan petunjuk yang sama. Alasan: mengubah bridge port router memutus perangkat di tengah skrip. Menutup pertanyaan terbuka "apakah prepareBridge diblokir saat inject berjalan".
- **Arah sebaliknya: inject ditahan selama "Siapkan bridge router" berjalan** (2026-11-19, disetujui pemilik produk). Selama penyiapan, inject tunggal ditolak ("Sedang menyiapkan bridge router, coba lagi sebentar") dan inject Multi (manual, Inject All, Auto Inject) ditahan dengan alasan "Sedang menyiapkan bridge router", terpisah dari blokir draft (keduanya digabung: tahan baru dilepas bila keduanya tidak ada). Perangkat yang sedang antre dikembalikan `ready`; setelah selesai antrean manual diantre lagi dan Auto Inject menyapu. Tombol Inject All dan Siapkan di panel nonaktif selama penyiapan. Alasan: perangkat tak boleh mulai di-inject saat bridge port router diubah. Menutup risiko "inject saat prepareBridge berjalan".
- **Baris yang dihapus operator muncul lagi bila peristiwanya belum tersimpan** (2026-11-19, disetujui pemilik produk; perilaku sekarang dipertahankan). Bila penyimpanan draft gagal, baris ada di memori dan peristiwanya tetap di proses utama; jika operator menghapus baris itu sebelum tersimpan, baris dibuat lagi saat peristiwa dicoba ulang, lalu operator dapat menghapusnya lagi setelah tersimpan. Alasan: perangkat benar-benar sudah ter-Country-Lock, jadi tak boleh ada yang tak tercatat.
- Semua field form wajib terisi sebelum Multi dimulai (keputusan 2026-11-18 berlaku juga di sini): Tipe, Firmware, Business Unit, Lokasi.

## Tujuan

1. Memindai DHCP lease router jump, mengenali perangkat dari **MAC** (bukan IP), dan menampilkannya dalam tabel dengan status yang diperbarui terus (L4.3, L4.4).
2. Inject paralel (1 sampai 32, bawaan 4) lewat antrean; aksi Inject All, Stop Antrean, Cancel All; Auto Inject; perangkat yang sudah Selesai atau serialnya sudah ada di draft tidak di-inject ulang otomatis, dan Inject All juga melewatinya (inject manual per perangkat tetap boleh; keputusan pemilik 2026-11-19, lihat "Keputusan pemilik").
3. Hasil sukses masuk ke draft lewat jalur yang sama dengan mode tunggal (`useDraftRows.addInjected`), tanpa kehilangan baris walau jendela dimuat ulang saat inject berjalan.
4. Mengganti dua cacat aplikasi lama yang tercatat di spek induk: retry tanpa batas saat kredensial habis (legacy §10 butir 6) dan semafor yang diganti di tengah inject (butir 5).

## Bukan tujuan

- **OCR stiker** (Fase 4): kredensial dari kamera belum ada. Kredensial tambahan hanya lewat antrean manual (L4.6).
- Merk Mikrotik di Multi (aplikasi lama juga tidak mendukungnya).
- Mengubah `config.QC`, skrip, atau mode tunggal.
- Penyaringan perangkat menurut penugasan BU; mode ini tetap berjalan tanpa login.

## Anti-tujuan

- Mengubah konfigurasi router tanpa tindakan operator yang eksplisit.
- Sandi perangkat atau router sampai ke renderer, log, atau pesan galat.
- Meng-inject perangkat yang salah karena IP berpindah (identitas harus MAC dan IP diperiksa ulang tepat sebelum inject).
- Satu perangkat ter-inject dua kali karena dua jalur (otomatis dan manual) berebut.

## Pendekatan yang dipertimbangkan

| | Kelebihan | Kekurangan |
|---|---|---|
| A. Mesin di renderer (pola mode tunggal) | Perubahan lebih sedikit | Timer renderer diperlambat saat jendela tersembunyi (batch panjang tersendat); muat ulang membuang state; sandi lewat renderer |
| **B. Mesin di proses utama, logika murni di `countrylock/` (dipilih)** | Loop tidak melambat; muat ulang aman; sandi tetap di main; logika dapat diuji dengan jam dan port palsu | Permukaan jembatan lebih besar (v9) |

Dipilih B oleh pemilik. Mesin yang sepenuhnya di main tanpa memisahkan logika murni dibuang: aturan status/masa tenggang/antrean rawan salah dan harus bisa diuji tanpa SSH.

## Rancangan

### 1. Unit murni `countrylock/src/multi/` (tes `bun:test`, tanpa `electron`/Node API selain tipe)

- `lease.ts`: `parseDhcpLeases(output)` untuk keluaran `/ip dhcp-server lease print terse proplist=address,mac-address,status where status=bound` (L4.3: baris tanpa `address=` dibuang; status di akhir baris). MAC dinormalisasi huruf besar dengan titik dua.
- `registry.ts`: `reconcile(devices, leases, now, opts)` menghasilkan perangkat baru, pembaruan IP, pemutusan, dan penghapusan: identitas MAC; MAC sama IP berbeda memperbarui IP (dan, bila bukan `injecting`, kembali `waiting` dengan kredensial direset); IP diambil alih MAC lain membuat perangkat lama `disconnected` (bukan `injecting`/`disconnected`); MAC hilang membuatnya `disconnected` lalu dibuang setelah 60 dtk (kecuali `injecting`); entri tanpa MAC atau berIP sama dengan `excludeIp` dibuang (L4.3).
- `device-machine.ts`: status `waiting | pinging | fetching_info | ready | queued | injecting | success | failed | disconnected` dan fungsi transisi murni (L4.4). `ready` memuat bendera `alreadyRegistered`.
- `credentials.ts`: urutan kredensial per perangkat = default `config.QC` lalu antrean bersama mulai dari indeks milik perangkat (L4.4, L4.6). **Perbaikan retry:** tiap kredensial dicoba paling banyak SATU kali per "sesi IP" perangkat; antrean habis = status `waiting` "Permission denied!!!" dan **tidak dicoba ulang otomatis**; ia dicoba lagi hanya bila operator menambah kredensial, IP perangkat berubah, perangkat muncul kembali setelah `disconnected`, atau operator menekan Retry.
- `scheduler.ts`: antrean inject dengan batas `limit` (1 sampai 32). Slot dibagi lewat penghitung (`running < limit`), **tanpa mengganti objek semafor**; mengubah `limit` berlaku untuk pemberian slot berikutnya dan tidak pernah memutus inject yang berjalan. Aksi: `queue(mac)`, `cancel(mac)` (`queued` kembali `ready` "Dibatalkan (masih antri)"; `injecting` diminta batal), `injectAll()` (menyapu perangkat `ready` sekali dan mencabut `queueStopped`), `stopQueue()` (`queueStopped=true`, batalkan yang `queued`, yang `injecting` dibiarkan selesai), `cancelAll()` (sama, lalu batalkan yang `injecting`). `queueStopped` hanya dicabut `injectAll()` atau menyalakan Auto Inject (L4.5).
- `engine.ts`: `createMultiEngine(ports)` merangkai semuanya. Port yang disuntik: `now()`, `sleep(ms, signal)`, `readLeases()`, `ping(ip)`, `readInfo(ip, cred)`, `inject(req, signal, onProgress)`, `ensureBridgePorts()`. Daftar serial yang sudah ada di draft TIDAK dibaca main dari berkas: renderer mendorongnya lewat `setRegistered(serials)` tiap draft berubah (sumber kebenaran = tabel draft di renderer, bukan berkas yang tertunda 500 ms), dan engine menambah himpunan sendiri berisi MAC/serial yang sukses selama mode berjalan. Satu loop per perangkat dengan jeda L4.4 (500/800 ms; `pinging/fetching_info/queued/injecting` ditunggu 500 ms); pemindaian lease adaptif 1/3/5 dtk (L4.3). Keluaran: `snapshot()` (DTO tanpa sandi) dan peristiwa `injected` (lihat 4).
- **Pencegah inject ulang** (anti-tujuan): perangkat `success` tetap `success` walau IP-nya berubah (tidak diproses ulang); selama mode Multi berjalan, MAC/serial yang sukses disimpan di himpunan sesi sehingga perangkat yang dicabut, dibuang setelah 60 dtk, lalu muncul lagi TIDAK di-auto-inject (ia tampil `ready` dengan penanda "sudah di-inject di sesi ini"; inject manual tetap boleh). Himpunan ini hilang saat mode dihentikan; sesudahnya penjaga hanya draft, sama seperti aplikasi lama (yang juga mengosongkan pending setelah unggah). Dipilih perancang.
- **Blokir inject**: renderer memanggil `setBlocked(alasan | null)` bila draft penuh, belum termuat, atau rusak. Selama diblokir engine tidak memberi slot baru, perangkat `queued` dikembalikan ke `ready`, Auto Inject berhenti, dan yang sudah `injecting` dibiarkan selesai; main tidak pernah menulis draft.
- **Model vs firmware**: ketidakcocokan model perangkat dengan Tipe/Firmware batch hanya ditampilkan (kolom Model), tidak menahan inject; sama dengan aplikasi lama dan dengan keputusan Tipe tidak dipilih otomatis. Dipilih perancang.

### 2. Proses utama `desktop/src/main/multi/`

- `host.ts`: satu `MultiHost` per aplikasi; membuat engine dengan port nyata: `readLeases` memakai exec-channel SSH ke router (`ssh/exec.ts`, kredensial server dari `config.QC`, tidak pernah keluar dari main); `ping` memakai `device/ping.ts`; `readInfo` memakai `device/info.ts`; `inject` memakai jalur yang sama dengan `runInjectRequest` di `ipc.ts` (diekstrak menjadi fungsi bersama agar penyamaran sandi dan `{sshKey}` tak diduplikasi); `isSerialRegistered` membaca draft (`draft-store.ts`) dan antrean pending lama.
- **Router dan paket**: Multi memakai paket skrip aktif yang sudah dimuat (`package.load`; operator tidak memilih paket lain) dan merk Ubiquiti di dalamnya. Lease, bridge router, dan host key dibaca dari `config.server` (host = `server.ip`, yaitu alamat SSH PC ke router; pengguna/sandi `config.server`). `ipServer` BUKAN host SSH: itu alamat router seperti terlihat dari perangkat (bisa beda karena NAT) dan hanya dipakai sebagai nilai placeholder `{ipServer}` pada skrip (legacy §2.5 dan §6, `FC.cs:226-231`). Rumusan awal spek ini yang memakai `ipServer` untuk lease keliru dan dikoreksi 2026-11-19; `connectVia` diabaikan di Multi (L4.1). Host key router diterima otomatis seperti inject tunggal (spek induk §6.3) dan direkam untuk `{sshKey}`.
- **Saling-kecualikan dengan mode tunggal** (L4.2): Multi tidak dapat dimulai saat inject tunggal berjalan, dan sebaliknya; `blockReload` (F5) juga menahan selama ada inject Multi. Pesan jelas bila ditolak. Tombol mode Tunggal | Multi dinonaktifkan selama Multi berjalan ("Hentikan Multi dulu"); menutup jendela ke tray tidak menghentikan Multi (mesin ada di main), sedangkan keluar sungguhan dari menu tray menanyakan konfirmasi bila ada inject berjalan. Dipilih perancang.
- **Siapkan bridge router** (`BridgePortSetup`, L4.2): hanya dijalankan oleh tombol eksplisit dengan dialog konfirmasi yang menyebut perintahnya (hapus bridge port semua interface selain `interfaceComp` dari SEMUA bridge, tambah `interfaceList` tanpa `interfaceComp` dan duplikat ke `interfaceBridge`; satu sumber rencana `countrylock/src/multi/bridge-plan.ts`). Ditolak (host) dan tombol nonaktif selama ada inject berjalan, tunggal atau Multi (keputusan pemilik 2026-11-19). Tidak otomatis saat mode dimulai (perubahan atas aplikasi lama, yang menjalankannya diam-diam dan menelan semua galat). Galat dilaporkan ke operator.

### 3. Jembatan v9 (`MULTI_BRIDGE_VERSION = 9`, `BRIDGE_VERSION` 9, `MIN_BRIDGE_VERSION` dan `UI_MIN_BRIDGE_VERSION` tidak naik: UI menyembunyikan mode Multi bila jembatan < 9)

`multi`: `start(cfg)`, `stop()`, `scan()`, `setConcurrency(n)`, `setAutoInject(on)`, `injectDevice(mac)`, `cancelDevice(mac)`, `injectAll()`, `stopQueue()`, `cancelAll()`, `addCredential({username,password})`, `prepareBridge()`, `snapshot()`, `onChange(cb)`, `ackInjected(eventIds)`. `cfg` = `{ firmwareCode, concurrency, excludeIp, autoInject, target: { itemId, itemLabel, buId, buLabel, locationId, locationLabel } }` (`target` = Tipe, BU, dan Lokasi batch; main menyimpannya selama batch dan membubuhkannya pada tiap peristiwa `injected`); ditambah `setBlocked(alasan | null)` dan `setRegistered(serials)`; merk selalu Ubiquiti dan paket skrip dibaca main. Semua argumen divalidasi zod (`BRIDGE_ARGS`); tidak ada kanal yang menerima jalur berkas atau mengembalikan sandi. Snapshot memuat per perangkat: `mac`, `ip`, `status`, `statusMessage`, `pingable`, `model`, `serial`, `country`, `credentialSource`, `alreadyRegistered`, `log` (baris berstempel waktu, sandi disamarkan lewat `StreamMasker`), plus ringkasan (jumlah per status, aktif).

### 4. Pencatatan ke draft tanpa kehilangan baris

Saat inject sukses, engine membuat peristiwa `injected` `{eventId, mac, serial, model, injectedAt, target}` (`injectedAt` = cap waktu engine, ISO; tanggal uji WIB dihitung darinya, bukan saat dicatat; `target` = salinan Tipe/BU/Lokasi batch). Peristiwa **disimpan di tabel `multi_injected` pada `draft.db`** (main, `draft-store.ts`) sampai di-`ack`, sehingga selamat dari muat ulang, keluar aplikasi, dan crash; saat aplikasi dibuka lagi peristiwa yang tersisa dikirim ke renderer begitu draft termuat. Renderer (`useMulti`) menerimanya lewat snapshot, memanggil `useDraftRows.addInjected` (data dari peristiwa, `clientId` baru dari `eventId`, sehingga peristiwa yang dikirim ulang tidak menggandakan baris), lalu `ackInjected`. Bila renderer dimuat ulang, peristiwa yang belum di-ack dikirim lagi; serial yang sudah ada di draft dikembalikan `duplicate` oleh `addInjected` dan tetap di-ack. Draft penuh atau gagal dimuat **menahan Inject dan Auto Inject** seperti mode tunggal (`injectBlocker`); perangkat yang selesai tetapi gagal dicatat ditandai di tabel dan peristiwanya tidak di-ack.

### 5. UI renderer (`web/src/modules/countrylock/`)

- Tombol mode **Tunggal | Multi-Device** di baris judul halaman Country Lock (Multi hanya bila jembatan >= 9 dan paket memuat merk Ubiquiti). Memilih Multi menampilkan form Multi menggantikan kartu "Perangkat"; ringkasan draft, tombol Catat Serial Number, dan dialognya tetap sama.
- Form Multi: Merk (Ubiquiti, tetap), Tipe, Firmware, Business Unit, Lokasi (komponen yang sama dengan mode tunggal, `LinkField`), Concurrent (1 sampai 32), Exclude IP, Auto Inject (dengan konfirmasi yang sama). Tipe/Firmware/BU/Lokasi **terkunci selama mode Multi berjalan**; mengubahnya berarti Hentikan dulu (konfigurasi batch tetap satu).
- Tombol: Mulai/Hentikan mode, Scan, Siapkan bridge router, Inject All, Stop Antrean, Cancel All. Lencana ringkasan yang bisa diklik untuk menyaring (Menunggu, Antri, Inject, Selesai, Gagal) dan teks "N perangkat (M aktif)" (L4.5).
- Tabel perangkat (kartu pada layar sempit): titik ping, MAC, IP, Model, Serial, Negara, sumber kredensial, status berwarna, aksi per baris (Inject/Retry atau Cancel), baris log yang dapat dilipat, tombol "Buka web" yang memanggil peramban sistem untuk `https://<ip>` (hanya IP dari snapshot, divalidasi di main).
- Panel antrean kredensial: tombol `+` menambah kredensial manual tanpa duplikat (L4.6); menambah memicu percobaan ulang perangkat `waiting` yang menunggu kredensial.
- Konfigurasi Multi terakhir (Concurrent, Exclude IP) diingat di `localStorage` `qc.countrylock.multi` (aplikasi lama tidak menyimpan Exclude IP, legacy §10).
- Hook `useMulti(bridge, draft)` menggantikan polling: berlangganan `onChange`, memetakan snapshot ke state, dan menjadi satu-satunya yang memanggil `addInjected` untuk Multi.

### 6. Pengujian

- `countrylock/src/multi/*.test.ts`: engine dengan jam dan port palsu: penemuan dan identitas MAC, IP berubah, IP diambil alih, masa tenggang 60 dtk, kredensial habis tanpa retry tak berujung, `limit` berubah di tengah inject (tanpa pemutusan), aksi massal, `alreadyRegistered` tak di-auto-inject, peristiwa `injected` dan `ack`.
- `desktop/src/main/multi/*.test.ts`: adaptor lease memakai `test-support/fake-ssh-server.ts` (keluaran contoh L4.3), saling-kecualikan dengan inject tunggal, validasi argumen IPC, sandi tidak bocor di snapshot.
- `web`: `useMulti` dengan `fake-bridge.ts` (snapshot, ack, draft penuh), form terkunci selama berjalan, tabel dan aksi.
- Uji manual `docs/e2e-checklist-desktop.md` (butuh router jump dan beberapa Ubiquiti nyata): satu perangkat, banyak perangkat paralel, IP berpindah, perangkat dicabut, Cancel All, muat ulang di tengah batch.

### 7. Dokumen yang diperbarui bersama implementasi

Spek induk §6.4 dan §9 (fase 3), `CLAUDE.md` (bagian desktop), `docs/e2e-checklist-desktop.md`.

## Pilihan perancang (periksa saat membaca)

1. Siapkan bridge router hanya lewat tombol eksplisit (bukan otomatis) dan tidak saat inject berjalan (keputusan pemilik 2026-11-19).
2. Tiap kredensial dicoba sekali per sesi IP; pemicu coba ulang = kredensial baru, IP berubah, muncul kembali, atau Retry manual.
3. Tipe, Firmware, BU, dan Lokasi dikunci selama mode berjalan.
4. Peristiwa `injected` bertahan di main sampai di-`ack` renderer.
5. "Buka web" memakai peramban sistem, bukan panel tertanam seperti aplikasi lama (Electron tanpa `webview`).
6. Jembatan v9 menyembunyikan mode Multi pada UI lama; `UI_MIN_BRIDGE_VERSION` tidak dinaikkan.
7. Concurrent dan Exclude IP diingat per komputer di `localStorage`.
8. Peristiwa `injected` disimpan di SQLite (`multi_injected`) sampai di-ack, bukan hanya di memori.
9. Renderer mendorong daftar serial terdaftar dan alasan blokir ke main (`setRegistered`, `setBlocked`); main tidak membaca berkas draft.
10. Himpunan MAC/serial sukses per sesi Multi mencegah inject ulang otomatis; perangkat `success` yang IP-nya berubah tidak diproses ulang.
11. Ketidakcocokan model dengan Tipe/Firmware batch hanya ditampilkan.
12. Pindah mode saat Multi berjalan ditolak; menutup jendela tidak menghentikan Multi.
13. Router dibaca dari `config.server` (`server.ip`); `ipServer` hanya untuk placeholder skrip; `connectVia` diabaikan; host key diterima otomatis.
14. Tanggal uji dihitung dari `injectedAt` milik engine (WIB).

## Diserahkan ke builder

Pemisahan berkas di dalam `countrylock/src/multi/` dan `desktop/src/main/multi/`, bentuk tepat DTO snapshot, skema zod, teks pesan status, tata letak tabel/kartu, pemilihan antarmuka SSH untuk membaca lease (exec-channel sudah tersedia), dan nama kunci `localStorage` selain yang disebut di atas.

## Risiko dan hal yang belum dapat diverifikasi

- Perilaku `ssh2` terhadap router dengan banyak sesi exec berulang (pemindaian tiap 1 sampai 5 dtk) belum diuji di perangkat nyata; engine membatasi satu pemindaian berjalan pada satu waktu (`isScanning`, L4.3).
- Verifikasi lease sebelum inject dapat bergabung ke pembacaan lease yang sudah berjalan (datanya paling usang `LEASE_TIMEOUT_MS`, sekitar 4 dtk). Ini diterima secara sadar sebagai kompromi untuk membatasi sesi SSH ke router (satu pembacaan pada satu waktu), bukan celah yang akan ditutup; keputusan perancang 2026-11-19, tanpa perubahan kode.
- Peristiwa `injected` yang gagal ditulis ke penyimpanan ditahan di engine (lintas perangkat dan Stop) dan ditulis ulang otomatis dengan jeda bertahap 5 sampai 60 dtk serta lewat Retry; `MultiSnapshot.injectedSeq` (penghitung monoton) memicu pencatatan di renderer. Percobaan ulang otomatis atas verifikasi lease yang gagal dibatasi 5 kali berturut-turut per perangkat, lalu menunggu Retry manual.
- Keluaran `lease print terse` hanya diverifikasi dari contoh di inventaris, bukan dari router nyata.
- Beban: puluhan loop ping ICMP (`ping.exe`) per perangkat; batas jumlah perangkat aktif sengaja tidak dipasang (aplikasi lama juga tidak). Loop perangkat `disconnected` berhenti saat ia dibuang setelah masa tenggang 60 dtk.
