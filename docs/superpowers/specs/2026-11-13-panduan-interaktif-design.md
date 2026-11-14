# Panduan interaktif (tur, tooltip demo, kartu panduan) — desain

Tanggal: 2026-11-13. Status: diimplementasikan (2026-11-14); disetujui pemilik produk 2026-11-13, dengan keputusan
tambahan pemilik produk 2026-11-14 (bagian 6) yang sudah masuk kode dan tes. Klip rekaman (PWA, push) menunggu
rekaman pemilik; panduan tetap berjalan tanpa klip lewat fallback teks per adegan.
Konteks: aplikasi QC (web React + TanStack, server Bun + Hono + MariaDB). Dokumen ini merancang fitur; implementasinya
ada di `web/src/modules/guide/`, `server/src/modules/guide/`, dan `shared/guides.ts`.
Status panduan disimpan dengan dua cara menurut jenis akun (individu atau bersama), sehingga fitur ini menyentuh
web dan server (bagian 4.3).

## 1. Maksud dan alasan

Pemakai aplikasi bukan hanya tim QC: ada tim WH, Sales, RMA Service, serta leader/manager. Demo lewat meeting
terbukti belum cukup, dan harus diulang setiap ada pengguna baru, fitur baru, atau penugasan ke fitur yang
sebelumnya tidak dimiliki. Contoh nyata (pemilik): panel "Tempel dari WhatsApp" di Serah Terima mendukung banyak
pesan sekaligus (kalimatnya sudah tertulis di panel), tetapi banyak pengguna masih menyalin satu per satu.

Maksudnya: setiap pemakai dapat belajar sendiri, kapan saja, langsung di aplikasi, tanpa meminta demo ulang.

## 2. Tujuan, bukan tujuan, anti-tujuan

Tujuan:
- Pengguna baru, fitur baru, dan akses baru ditangani oleh SATU aturan (bagian 4.2), bukan tiga mekanisme.
- Pengguna bisa mencoba alurnya sendiri lewat tur yang menyorot UI asli.
- Fitur yang sering terlewat (mis. tempel banyak pesan WhatsApp) punya penjelasan bergerak di tempatnya.
- Panduan tidak pernah memaksa dan tidak mengganggu pengguna yang sudah paham.

Bukan tujuan (tahap ini):
- Mode latihan dengan data contoh terpisah (ditolak: mencemari data produksi, biaya tinggi).
- Analitik siapa yang menyelesaikan apa untuk atasan (tidak diminta; status akun individu di database memungkinkannya
  nanti, status akun bersama per perangkat tidak).
- Mengenali orang berbeda yang berbagi satu akun DAN satu perangkat (di luar jangkauan; lihat 4.3).
- Panduan untuk semua modul sekaligus; tahap awal hanya yang tercantum di bagian 7.

Anti-tujuan (dianggap gagal walau secara teknis jalan):
- Tur yang mengirim, menyimpan, atau mengubah data sungguhan.
- Panduan yang menyuruh pengguna membuka menu yang tidak mereka punya.
- Pengguna lama dibanjiri pop-up beruntun saat rilis pertama.
- Panduan yang diam-diam rusak setelah UI berubah.

## 3. Batasan dari proyek (dari CLAUDE.md)

- Migrasi MariaDB expand-only, idempoten, kompatibel mundur (kolom/tabel baru saja). Nomor berikutnya: 0015.
- Rute REST baru wajib lewat `shared/contract.ts` + `shared/api.ts` + modul server + tes `rest.test.ts`.
- `shared/` murni (tanpa API runtime/DOM). Penerima/pemilik data dikunci email ternormalisasi (`normalizeEmail`).
- Penyimpanan sisi peramban memakai pola `web/src/modules/push/lib/storage.ts`: kunci per email (huruf kecil, tanpa
  spasi pinggir), dibungkus try/catch karena penyimpanan dapat kosong/terblokir (jendela privat).
- Field relasi form memakai `LinkField`; tidak boleh `<select>` bawaan (tidak relevan di sini kecuali ada form baru).
- Teks UI santai, bukan kaku/baku penuh (serapan asing seperti scan/batch/default boleh).
- Tiap potongan JS web <= 600 KB gzip (dijaga `scripts/verify-dist.ts`): mesin tur dan konten dimuat malas.
- Service worker tidak boleh men-cache `/api`; berkas klip media tidak dipra-cache (`globPatterns` PWA hanya
  js/css/html/png/svg/woff2) dan itu dipertahankan.
- Dialog: header/footer tetap, badan yang digulir (aturan `ui/dialog`).

## 4. Rancangan

### 4.1 Katalog panduan

Satu daftar di kode web (`web/src/modules/guide/`). Tiap entri:
- `id` (unik, huruf kecil + strip), `versi` (bilangan bulat, mulai 1)
- `jenis`: `dasar` (tur satu modul/topik), `baru` (tur mini 1-3 langkah untuk satu fitur/perubahan), `tip`
  (tooltip ikon info di satu tempat)
- `status`: `disimpan` (penanda selesai di penyimpanan menurut jenis akun, lihat 4.3) atau `diturunkan` (dihitung
  dari keadaan perangkat, tidak disimpan; untuk PWA dan push)
- `izin`: modul + level minimal (dicek dengan `canAnywhere`), atau kosong = semua pengguna
- `halaman`: awalan rute tempat banner panduan ini boleh muncul (4.4); kosong = tanpa banner (hanya kartu/menu)
- `langkah`: daftar langkah. Tiap langkah: rute tujuan, target (atribut `data-tour="..."`), teks, mode lanjut
  (tombol Lanjut atau menunggu pengguna mengklik sendiri), dan `izin` opsional per langkah (4.5). Untuk `tip`:
  urutan adegan demo.
- Untuk `dasar`: daftar id panduan `baru` modul itu yang sudah tercakup (lihat 4.2); daftar ini ada di
  `shared/guides.ts` karena server ikut memakainya (penyimpanan akun individu).

Untuk `baru`: field `dasar` wajib berisi id panduan `dasar` induknya (klarifikasi 2026-11-14, bagian 6); tes katalog
mewajibkan field itu dan keberadaan entrinya.

Daftar id, versi, dan cakupan `dasar` → `baru` (tanpa teks/langkah) ada di `shared/guides.ts` agar server dapat
memvalidasi id dan memperluas penanda. Tes menjaga daftar itu sama dengan katalog web.

### 4.2 Aturan penawaran

```
ditawarkan = berhak(izin sekarang)
             AND (belum ada catatan OR versi tersimpan < versi katalog)
             AND (jenis != baru OR dasar modul itu sudah selesai)
```

Dihitung ulang tiap aplikasi dibuka. Pengguna baru, fitur baru, dan akses baru semuanya jatuh ke aturan ini.
Panduan `baru` tidak ditawarkan kepada yang belum menyelesaikan `dasar` modulnya (yang bersangkutan mendapat
`dasar` lebih dulu). Menyelesaikan panduan `dasar` menulis penanda selesai untuk semua panduan `baru` yang
tercakup di dalamnya (daftar di katalog), sehingga pengguna baru tidak ditawari "fitur baru" yang sudah
diajarkan `dasar`. Penanda `baru` yang tercakup ditulis bersamaan dengan penanda `dasar` itu sendiri dalam satu kali
tulis (satu `batch()` di server untuk akun individu; satu kali tulis `localStorage` untuk akun bersama).

### 4.3 Penyimpanan (dua cara, menurut jenis akun)

Keputusan pemilik 2026-11-13: sebagian akun dipakai bersama oleh beberapa orang, sebagian lagi individu. Tabel
`users` mendapat kolom penanda "akun bersama", dan cara menyimpan status panduan mengikuti kolom itu:

| Jenis akun | Status "selesai" disimpan di | Akibatnya |
|---|---|---|
| **Individu** (bawaan) | Database, per akun | Selesai sekali, tidak mengulang saat pindah perangkat |
| **Bersama** | Peramban (`localStorage`), per email per perangkat | Diulang di setiap perangkat baru |

- **Kolom baru** `users.shared_account` `TINYINT(1) NOT NULL DEFAULT 0` (migrasi 0015, expand-only dan idempoten;
  image lama mengabaikannya). Bawaan 0 = individu. Ikut di `UserDto.sharedAccount`, `SaveUserInput.sharedAccount`,
  dan `MeDto.sharedAccount` (boolean). Diatur di form pengguna Pengaturan Akses (opsi "Akun bersama" dengan
  keterangan singkat) dan tampil sebagai penanda di tabel pengguna. Izin dan pencatatan perubahannya sama dengan
  field pengguna lain (`access: manage`). Keputusan pemilik 2026-11-14: ekspor Sheets `export_users` menambah
  kolom `shared_account` (0/1) di kanan, sebagai kolom data biasa (alasan: tes paritas skema-ekspor). Kolom itu
  sudah ada di `server/src/modules/jobs/sheets-export.ts`.
- **Satu antarmuka penyimpanan di klien** (`GuideStore`: baca penanda, tulis penanda, reset satu panduan) dengan dua
  implementasi: server (akun individu) dan perangkat (akun bersama). Aturan penawaran, banner, dan mesin tur tidak
  peduli yang mana; pemilihnya `me.sharedAccount`, yang sudah ada saat aplikasi dibuka.
- **Akun individu (database).** Tabel baru `guide_progress`: `recipient` (email ternormalisasi) + `guide_id` kunci
  utama gabungan, `version` INT, `updated_at` (ISO UTC); konvensi tabel notifikasi (id/waktu VARCHAR, tanpa kunci
  asing, kolasi `utf8mb4_nopad_bin`). Tidak ada kolom status: adanya baris berarti "selesai pada versi itu" (tidak
  ada `skipped`). Rute REST tanpa izin modul, cakupan akun pemanggil seperti lonceng: `guides.list` (GET),
  `guides.mark` (PUT id + versi; server memperluasnya ke panduan `baru` yang tercakup dalam satu `batch()`),
  `guides.reset` (POST: hapus baris satu panduan agar dapat diulang). Validasi: id harus ada di `shared/guides.ts`,
  versi tidak melebihi versi di daftar itu. Server tidak menilai izin modul (itu urusan klien); yang disimpan hanya
  penanda belajar milik pemanggil.
- **Akun bersama (perangkat).** Satu kunci `localStorage` per email: `qc.guide.done:<email>`, objek JSON
  `{ "<id panduan>": <versi> }`. Baca/tulis dibungkus try/catch (pola `push/lib/storage.ts`); bila penyimpanan tak
  tersedia, panduan dianggap belum selesai (ditawarkan lagi), bukan merusak halaman.
- **Pemuatan akun individu.** Penanda dimuat sekali dari `guides.list` saat aplikasi dibuka (cache query). Selama
  belum termuat, atau bila gagal (offline, galat), TIDAK ada penawaran apa pun: lebih baik diam daripada
  menampilkan "semua belum selesai" kepada yang sebenarnya sudah.
- Entri `tip` (titik penanda tooltip, 4.6) dan sapaan login (`sapaan-awal`, 4.4) adalah entri katalog biasa dengan
  penanda di penyimpanan yang sama; "ikon dibuka sekali" dan "sapaan sudah ditanyakan" = penanda ada. Karena itu
  sapaan akun individu hanya sekali seumur akun, sedangkan akun bersama sekali per perangkat.
- Sapaan login (`sapaan-awal`) ditawarkan kepada SIAPA PUN yang belum punya penandanya, termasuk pengguna lama saat
  fitur pertama dirilis (keputusan pemilik 2026-11-13). Tidak perlu mendeteksi "pengguna baru".
- **Mengubah jenis akun.** Individu → bersama: baris database akun itu tidak dihapus tetapi diabaikan, dan
  penyimpanan perangkat (kosong) dipakai, jadi panduan ditawarkan lagi di tiap perangkat. Bersama → individu:
  database dipakai (kosong bila belum pernah selesai), jadi ditawarkan sekali lagi.
- **Langkah rilis.** Admin menandai akun-akun bersama di Pengaturan Akses segera setelah rilis. Sebelum ditandai, akun
  itu diperlakukan individu (orang pertama yang menyelesaikan panduan "menghabiskan"-nya untuk semua pemakai akun).
- Batas yang diterima: dua orang yang berbagi akun DAN perangkat yang sama tidak dibedakan (yang kedua tidak ditawari
  lagi), tetapi dapat membuka panduan lewat menu profil "Ulangi".
- Panduan `diturunkan` (pasang PWA, aktifkan push): tidak ada penanda tersimpan. "Pasang PWA" ditawarkan selama
  aplikasi belum berjalan terpasang (mode tampilan `standalone`) dan perangkat mendukung pemasangan; "Aktifkan push"
  ditawarkan selama izin notifikasi peramban bukan `granted` atau perangkat belum berlangganan. Keputusan pemilik
  2026-11-14 (bagian 6, butir A): panduan push HANYA ditawarkan bila peramban mendukung push (izin peramban bukan
  `unsupported`), server punya VAPID (`push.config.enabled`), dan pengguna belum mematikan notifikasi push
  (`userEnabled` bukan `false`). Menu "Panduan" (4.4) hanya memuat panduan `diturunkan` yang berlaku bagi perangkat
  itu (butir B). "Ulangi" pada panduan `diturunkan` membuka panduannya kembali; tidak ada penanda yang ditulis.
- Klien memakai SATU fungsi penawaran dengan dua sumber status (`GuideStore` menurut jenis akun, dan keadaan
  perangkat untuk panduan `diturunkan`).
  `PushOnboarding` yang sudah ada tidak diganti: dialog pra-izinnya tetap yang meminta izin; panduan `diturunkan`
  hanya menjelaskan dan mengarahkan ke dialog/menu yang sama, dan tidak muncul bersamaan dengan dialog itu (penawaran
  ditunda selama `PushOnboarding` sedang menampilkan dialog atau banner).
- Progres sebagian tidak disimpan: tur yang terputus dimulai dari awal. Klarifikasi 2026-11-14 (bagian 6, butir D.ii):
  pengguna yang pindah ke halaman lain di luar langkah tur membatalkan tur itu tanpa menulis penanda (mesin tur
  menghentikannya seperti dibatalkan; panduan tetap ditawarkan lagi).

### 4.4 Titik masuk

- **Kartu "Panduan untuk Anda" di beranda**: daftar panduan yang ditawarkan (4.2), masing-masing dengan jumlah langkah
  dan tombol Mulai. Hilang bila tidak ada yang ditawarkan.
- **Banner di bagian atas halaman** yang punya panduan belum selesai (keputusan pemilik 2026-11-13, menggantikan
  rancangan toast hitung mundur: toast mudah terlewat dan hilang sebelum terbaca; banner menetap sampai
  ditanggapi). Isi: "Pertama kali di <halaman>? Ada panduan N langkah." dengan tiga tombol, memakai pola banner
  yang sudah ada (banner pembaruan PWA dan banner izin push):
  - **Mulai**: menjalankan tur.
  - **Nanti**: menyembunyikan banner untuk sesi tab ini (`sessionStorage`), tidak menulis penanda selesai;
    banner muncul lagi di sesi berikutnya selama panduan belum selesai.
  - **Sudah paham**: menulis penanda selesai pada versi katalog saat ini (sama dengan menyelesaikan tur, bukan
    status baru); banner tidak muncul lagi, panduan tetap ada di menu profil lewat "Ulangi". Pada panduan `dasar`,
    tombol ini juga menutup panduan `baru` yang tercakup (4.2).
  Aturan pemicu: banner hanya untuk panduan yang awalan `halaman`-nya cocok dengan rute yang dibuka; bila lebih dari
  satu cocok, hanya yang pertama menurut urutan katalog yang tampil (satu banner pada satu waktu). Panduan layout
  dasar tidak punya `halaman` (tanpa banner; hanya kartu beranda, menu profil, dan sapaan).
  N dihitung per pengguna: hanya langkah yang lolos `izin` per langkah (4.5).
- **Titik penanda di item sidebar** yang punya panduan belum selesai bagi pengguna itu (penanda ringan tanpa
  mengganggu); hilang saat panduannya selesai.
- **Menu profil: item "Panduan"**: semua panduan yang berhak, dengan "Ulangi" bagi yang sudah selesai. Keputusan
  pemilik 2026-11-14 (butir B): panduan `diturunkan` (PWA/push) hanya tampil bila berlaku bagi perangkat itu. PWA
  tidak tampil bila "Pasang aplikasi" tak tersedia atau aplikasi sudah terpasang; push tidak tampil bila syarat
  butir A tak terpenuhi. Alasan: "Ulangi" tak boleh membuka langkah yang menyuruh memilih menu yang tak ada.
- **Sapaan login pertama**: SATU dialog "Mau tur singkat?" (menawarkan panduan dasar). "Nanti" = tidak ditanya lagi.
- Tidak ada pop-up beruntun saat rilis pertama untuk pengguna lama: hanya sapaan satu kali, kartu, banner
  kontekstual satu per halaman, dan titik penanda sidebar.

### 4.5 Mesin tur

- Menyorot elemen lewat `data-tour`, bukan kelas CSS. Langkah berikut dapat berpindah rute lalu menunggu target muncul.
- Langkah yang menunggu klik pengguna lanjut otomatis begitu elemen diklik. Tur berhenti SEBELUM tombol simpan/kirim
  mana pun dan tidak pernah memanggil rute tulis.
- Tur HANYA menyorot dan menjelaskan: tidak mengisi atau mengubah isi field mana pun (tidak ada isi contoh yang
  dimasukkan ke editor, jadi tidak menyentuh draf atau `useUnsavedChanges`). Satu-satunya hal yang boleh ia lakukan
  sendiri adalah MEMBUKA menu (keputusan 2026-11-14, butir G): langkah dapat meminta sebuah menu terbuka
  (`langkah.buka: 'location-picker' | 'notification-bell' | 'theme-toggle' | 'user-menu'`) supaya isinya bisa
  disorot. Pembukaan murni UI (membuka dan menutup menu; tanpa klik sintetis, tanpa mengubah data, tanpa rute tulis),
  menu menutup saat langkah berganti, tur selesai, atau tur dibatalkan (Esc/Tutup), dan menu yang sudah dibuka
  pengguna sendiri tidak ditutup paksa.
- Peragaan hasil (mis. tempel banyak pesan menjadi banyak kartu) tetap lewat demo tooltip (4.6), dan demo itu MASUK
  ke alur tur (keputusan pemilik 2026-11-13): sebuah langkah dapat menyematkan adegan demo milik sebuah entri `tip`
  (`langkah.tip: '<id tip>'`) di dalam gelembung langkahnya, lengkap dengan keterangan per adegan. Pengguna menontonnya
  di tengah tur lalu menekan Lanjut. Entri `tip` yang sama dipakai ulang oleh ikon info permanen di halamannya (4.6),
  jadi demo hanya ditulis sekali.
- Langkah yang `izin`-nya tidak terpenuhi pengguna (mis. langkah sisi QC bagi akun yang hanya `handover: view`)
  dilewati seluruhnya, bukan ditampilkan sebagai teks. Dengan `izin` per langkah, satu panduan Serah Terima melayani
  sisi WH dan sisi QC tanpa dipecah, dan jumlah langkah pada kartu dihitung per pengguna.
- Target tidak ada (sidebar tertutup di ponsel, butir menu bersyarat, pemicu menu yang tak dirender): langkah
  dilewati; tur tidak macet. Pengecualian: langkah yang targetnya bergantung data (kartu task di papan; ditandai
  `langkah.teksJikaKosong`) TIDAK dilewati melainkan tampil sebagai kartu di tengah layar tanpa sorotan, dengan teks
  pengganti yang menjelaskan keadaannya dan demo `tip` langsung terputar (keputusan 2026-11-14, butir H); langkah itu
  tetap terhitung pada "Langkah x dari N". Kartu contoh bersifat sementara: targetnya terus diamati dan, bila muncul
  belakangan (jaringan lambat), kartu beralih ke sorotan asli; target yang sudah terbukti kosong tak ditunggu lagi
  oleh langkah berikutnya yang bertarget sama. Langkah yang menu pemicunya tak dirender saat tur dimulai (mis.
  pemilih lokasi untuk satu lokasi) dibuang di awal bersama langkah yang menyorot pemicu itu, agar "Langkah x dari N"
  tak melompat. Demo kartu contoh sepenuhnya tak dapat dioperasikan (tak membuka komposer asli, tak memasang status
  "belum disimpan"). Langkah yang `izin`-nya gugur tetap dibuang di awal. Di ponsel, langkah
  yang menyorot menu membuka sidebar lebih dulu.
- Penempatan kartu langkah (desktop; ponsel selalu menempel di dasar layar): dihitung dari ukuran kartu yang
  SEBENARNYA (diukur ulang saat isinya tumbuh, mis. demo `tip` selesai dimuat malas), memilih di antara posisi di
  bawah, atas, kiri, dan kanan sorotan yang paling sedikit menutupi sorotan dan, pada langkah `buka`, seluruh menu
  yang terbuka, selalu dijepit di dalam layar; tinggi kartu dibatasi tinggi layar dan isinya menggulir. Popover ikon
  info (4.6) membatasi tingginya pada ruang yang tersedia (`--radix-popover-content-available-height`) dan
  menggulir di dalamnya. Pemeriksaan "pengguna meninggalkan tur" hanya membandingkan saat `pathname` benar-benar
  berubah (efek yang dijalankan ulang oleh StrictMode tidak boleh menutup tur yang baru berpindah rute).
- Dimuat malas (potongan JS terpisah). Mesin: pustaka kecil atau tulis sendiri; diputuskan di rencana implementasi
  (lihat bagian 8).
- Hormati `prefers-reduced-motion` dan dapat dioperasikan dengan keyboard.

### 4.6 Tooltip ikon info dengan demo bergerak

- Ikon info (i) di dekat field/judul terkait. Desktop: hover atau fokus keyboard membuka; layar sentuh: ketuk
  (komponen `ui/popover` yang ada, dibuka terkendali).
- Isi: demo bergerak berulang + keterangan singkat yang berganti sesuai adegan/frame. Tombol jeda dan titik adegan
  yang dapat diketuk untuk lompat adegan. Gagal muat, "kurangi gerakan", atau offline = keterangan tampil sebagai daftar
  langkah bernomor.
- **Ikon info bersifat permanen** (keputusan pemilik 2026-11-13): tetap ada di tempatnya selamanya, tidak hilang
  setelah tur selesai atau setelah panduan ditandai selesai. Hanya titik penandanya yang hilang (di bawah).
- **Titik penanda** pada ikon sampai pernah dibuka sekali (penanda entri `tip` di penyimpanan status yang sama,
  4.3, jadi bukan mekanisme kedua). Tujuannya agar yang sudah terbiasa cara lama tetap menemukannya.
- Dua jenis adegan (keputusan pemilik 2026-11-13, gabungan):
  - **`kode`**: adegan HTML/CSS yang dimainkan langsung untuk apa yang terjadi DI DALAM aplikasi. Hasil yang
    ditampilkan dihitung fungsi asli bila ada (mis. adegan "Pecah" memakai `splitWhatsappBatch` di
    `shared/handover-paste.ts` pada teks contoh), sehingga tidak basi bila aturan berubah. Mengikuti tema
    terang/gelap otomatis. Aplikasi lain yang sering dibutuhkan peragaannya, terutama chat WhatsApp, juga adegan `kode`
    yang meniru tata letaknya (bilah atas, latar chat, bubble masuk/keluar, bilah pilihan; keputusan pemilik
    2026-11-14, bagian 6 butir E): hanya tiruan tampilan yang meniru warna khasnya (hijau gelap/teal, bubble hijau muda
    dan putih; butir J) dan tetap terbaca di terang dan gelap, tanpa logo, gambar, atau aset resmi.
  - **`klip`**: video pendek berulang (WebM/MP4, tanpa suara, sekitar 8 detik) untuk yang terjadi DI LUAR aplikasi
    dan tak dapat ditiru layout-nya dengan wajar (menu pasang PWA di peramban, dialog izin notifikasi). Demo
    "Tempel dari WhatsApp" TIDAK lagi memakai klip: memilih lalu menyalin pesan ditiru sebagai adegan `kode` (butir E). Klip direkam pemilik produk. Keterangan disinkronkan lewat daftar waktu di katalog. Klip diunduh
    hanya saat tooltip dibuka (`preload="none"`), disajikan sebagai berkas statis, tidak dipra-cache. Letak:
    `web/public/klip/<id-panduan>-<n>.webm` (ikut ke `server/dist` dan image Docker seperti berkas statis lain).
    Konvensi `berkas` (klarifikasi 2026-11-14, butir D.i): nama polos tanpa path (mis. `tip-a-1.webm`); URL dibangun
    `klipUrl()` menjadi `/klip/<berkas>`;
    batas 1 MB per klip (sekitar 8 detik, tanpa suara, lebar <= 720 px).
  - Klip belum tersedia saat rilis TIDAK menghalangi rilis: adegan `klip` yang `berkas`-nya belum diisi memakai
    fallback daftar langkah bernomor. Tes katalog hanya memeriksa bahwa berkas yang DIDEKLARASIKAN ada; adegan
    tanpa `berkas` lolos. Jadi panduan PWA/push dan Serah Terima dapat rilis lebih dulu, klipnya menyusul.
  - **Kartu contoh untuk langkah tanpa data** (keputusan pemilik 2026-11-14, bagian 6 butir F): langkah yang menyorot
    isi papan (checklist, status, komentar pada task) tidak bergantung pada ada-tidaknya task sungguhan. Penjelasannya
    adalah demo `kode` milik entri `tip` (`tip-handover-checklist`, `tip-handover-komentar`) yang merender komponen
    asli (`HandoverCard`/`NoteView`) dengan data contoh yang dibuat di sisi klien, diberi lencana "Contoh". Demo tidak
    menyentuh data, halaman, kueri, atau penyimpanan apa pun selain titik penanda `tip`, dan kartu contoh bukan target
    `data-tour` (tur tak pernah menyorotnya).
  - Satu tooltip dapat memakai keduanya berurutan.

### 4.7 Perawatan (agar panduan tidak basi)

Tabel keputusan saat merilis perubahan, ditulis sebagai checklist rilis di CLAUDE.md. Pertanyaan penentu: apakah
pengguna yang sudah paham bisa salah langkah atau melewatkan sesuatu bila tidak diberi tahu?

| Jenis perubahan | Tindakan | Siapa yang melihat |
|---|---|---|
| Kosmetik (alur sama) | Perbaiki target/teks katalog saja | Tidak ada yang ditawari ulang; pengguna baru dapat versi terbaru |
| Alur berubah | Tambah panduan `baru` 1-2 langkah; rekam ulang klip terkait | Yang sudah menyelesaikan `dasar` modul itu |
| Fitur ditambah | Tambah panduan `baru` | Yang sudah menyelesaikan `dasar` modul itu |
| Perombakan besar | Naikkan versi panduan `dasar` ("Diperbarui"); rekam ulang klip | Semua yang berhak, termasuk yang sudah selesai |

Tes katalog (CI): id unik, id/versi/cakupan sama dengan `shared/guides.ts`, rute valid, setiap target `data-tour`
ada di kode sumber, setiap modul di `MODULE_LINKS` yang sudah punya halaman punya panduan `dasar`, setiap klip yang
dirujuk ada berkasnya.

## 5. Pendekatan yang dipertimbangkan

1. **Pusat Panduan saja** (halaman bantuan per modul, teks dan gambar). Murah dan mudah dirawat, tetapi bergantung
   pada kemauan membaca; tidak memenuhi "dapat dilakukan langsung". Ditolak.
2. **Tur interaktif + Pusat Panduan** yang menyorot UI asli, dipicu aturan "berhak dan belum selesai". **Dipilih
   pemilik 2026-11-13.**
3. **Mode latihan dengan data contoh terpisah.** Paling efektif belajar, tetapi berisiko mencemari data produksi dan
   tiap fitur baru menambah pekerjaan besar. Ditolak.

Untuk demo tooltip: rekaman semua (sederhana, tetapi klip bisa basi tanpa terdeteksi tes) vs demo dari kode semua
(awalnya dinilai tak bisa meniru WhatsApp, menu peramban, dan dialog izin sistem; tiruan WhatsApp akhirnya dibuat
sebagai kode, lihat bagian 6 butir E) vs **gabungan, dipilih per langkah
(dipilih pemilik 2026-11-13)**.

Untuk status: database per akun saja (pada akun bersama, orang kedua tidak akan pernah melihat panduan) vs
`localStorage` per perangkat saja (akun individu ditawari ulang di tiap perangkat tanpa perlu) vs **keduanya,
dipilih menurut kolom "akun bersama" di tabel pengguna (dipilih pemilik 2026-11-13, final)**.

## 6. Keputusan pemilik produk

Semuanya 2026-11-13, disetujui pemilik produk:
- Pendekatan tur interaktif + kartu + banner per halaman (butir 5.2).
- Status panduan disimpan menurut jenis akun: akun individu di database (tidak mengulang saat pindah perangkat),
  akun bersama di peramban per perangkat (diulang di tiap perangkat baru). Jenis akun ditentukan kolom baru "akun
  bersama" di tabel pengguna, diatur admin di Pengaturan Akses. Alasan: sebagian pengguna memakai akun bersama,
  sebagian individu. Keputusan ini menggantikan dua keputusan sebelumnya pada hari yang sama (status di database
  untuk semua akun; lalu per perangkat untuk semua akun). Panduan PWA dan push tetap dihitung dari keadaan
  perangkat (bagian 4.3).
- Bentuk tampilan: daftar kartu di beranda dan banner di bagian atas halaman (Mulai / Nanti / Sudah paham),
  ditambah titik penanda di sidebar. Toast hitung mundur dibatalkan (2026-11-13).
- Tabel keputusan perubahan (4.7) cocok dengan cara merilis; checklist rilis dimasukkan ke CLAUDE.md.
- Tooltip ikon info dengan gambar bergerak + keterangan per frame; gabungan demo kode dan klip.
- Klip untuk bagian di luar aplikasi direkam pemilik produk.
- Urutan awal: layout dasar, lalu Serah Terima (bagian 7).
- Sapaan login ditawarkan ke semua pengguna yang belum pernah menjawabnya, termasuk pengguna lama (4.3).
- Demo tooltip masuk ke alur tur lewat langkah yang menyematkan entri `tip` (4.5); ikon info permanen (4.6).
- Disetujui tanpa perubahan dari daftar keputusan perancang (bagian 8): panduan `baru` baru ditawarkan setelah
  `dasar`, izin per langkah, klip yang belum siap tidak menghalangi rilis, dan status PWA/push diturunkan dari
  perangkat.
- Akibat keputusan penyimpanan menurut jenis akun: ada migrasi 0015 (kolom `users.shared_account` dan tabel
  `guide_progress`), tiga rute REST, dan perubahan form/tabel pengguna di Pengaturan Akses.
- Keputusan tambahan pemilik produk 2026-11-14 (disetujui lewat tanya-jawab di sesi; tanggal absolut 2026-11-14):
  - **A. Panduan push hanya bila berlaku.** Panduan `perangkat-push` ditawarkan hanya bila peramban mendukung push,
    server punya VAPID (`push.config.enabled`), dan pengguna belum mematikan notifikasi push (`userEnabled` bukan
    `false`). Alasan: menghindari kartu yang tak bisa diselesaikan (Safari iOS di tab biasa, staging tanpa VAPID) dan
    selaras anti-tujuan "tidak mengganggu". Diubah: 4.3 (aturan panduan `diturunkan`).
  - **B. Menu "Panduan" menyembunyikan panduan turunan yang tak berlaku.** Menu hanya memuat panduan `diturunkan`
    yang berlaku bagi perangkat itu; "Ulangi" membuka panduannya kembali. Alasan: "Ulangi" tak boleh membuka langkah
    yang menyuruh memilih menu yang tak ada. Diubah: 4.3 dan 4.4 (item menu profil).
  - **C. Kolom ekspor `shared_account`.** Ekspor Sheets `export_users` menambah kolom `shared_account` (0/1) di
    kanan. Alasan: tes paritas skema-ekspor; kolom data biasa. Dicatat di 4.3.
  - **D. Klarifikasi (bukan perubahan perilaku):** (i) `berkas` klip = nama polos, URL `klipUrl()` = `/klip/<berkas>`
    (4.6); (ii) pindah halaman di luar langkah tur membatalkan tur tanpa penanda (4.3); (iii) panduan `baru` menyebut
    `dasar` induknya di katalog, field `dasar` (4.1).
  - **E. Demo WhatsApp sebagai adegan `kode` yang meniru WhatsApp (2026-11-14, diminta pemilik produk setelah
    mencoba tur langsung).** Urutan demo dikoreksi menjadi: pilih pesan di WhatsApp, salin, tempel di kotak, tekan
    Pecah, lalu hasil kartu task (sebelumnya langkah memilih pesan muncul terakhir). Langkah di WhatsApp kini empat
    bingkai `kode` yang meniru tampilan WhatsApp (chat biasa; tekan lama satu bubble dengan bilah pilihan "1"; ketuk
    pesan lain; ketuk ikon salin dengan toast "Disalin"), bukan adegan `klip` tanpa berkas. Alasan: urutan terbalik
    membingungkan, dan teks langkah tanpa gambar kurang membantu. Diubah: 4.6 (jenis adegan) dan kalimat status di
    kepala dokumen. Infrastruktur klip (`klipUrl`, pemutar, tes konvensi) tetap untuk kasus lain.
  - **F. Kartu contoh sebagai demo `kode`, bukan data palsu di halaman (2026-11-14, usul pemilik produk).** Untuk
    pengguna yang papannya kosong (tak ada kartu untuk disorot) dan untuk langkah memilih teks lalu memberi komentar
    yang belum dijelaskan, penjelasannya diwujudkan sebagai demo `kode` (entri `tip`) yang merender kartu task contoh
    dari komponen asli dengan data contoh, bukan dengan menaruh data palsu di papan atau halaman. Alasan: tidak
    mencemari data atau kueri, tampilan selalu sama dengan aplikasi, dan memakai sistem demo yang sudah ada. Id
    penanda baru `tip-handover-checklist` dan `tip-handover-komentar` (versi 1) masuk `shared/guides.ts`. Diubah: 4.6
    (bullet kartu contoh).
  - **G. Tur membuka menu sendiri dan menjelaskan isinya (2026-11-14, masukan pemilik produk setelah mencoba tur
    langsung: panduan lokasi, notifikasi, tema, info pengguna, pasang aplikasi, dan push "tidak detail").** Langkah
    tidak lagi berhenti pada tombol pemicu: mesin tur membuka sendiri popover/dropdown-nya (`langkah.buka`, 4.5) lalu
    menyorot dan menjelaskan isinya (daftar lokasi yang bisa dicentang, daftar kabar, pilihan tema, nama + email akun
    dan butir menu profil, butir "Pasang aplikasi" dengan bedanya Android/iOS, butir "Notifikasi push" dengan alur
    izin dan saklarnya). Menu dibuka lewat state kecil yang di-OR-kan ke `open` komponen menu (bukan klik sintetis) dan
    dibuat non-modal selama dipaksa tur, supaya kartu tur tetap dapat diklik dan menu tak menutup sendiri. Alasan:
    tombol saja tidak mengajarkan isi menu. Diubah: 4.5 (kalimat "tidak mengubah apa pun" dilonggarkan hanya untuk
    membuka menu).
  - **H. Langkah bergantung data jatuh ke kartu contoh; ditambah langkah komentar (2026-11-14, jawaban pemilik
    produk atas pertanyaan "bagaimana jika tak ada datanya").** Langkah checklist Serah Terima (umum dan sisi QC)
    yang targetnya (kartu task) tak ada di papan kosong tidak lagi dilewati diam-diam: tampil sebagai kartu tur di
    tengah layar tanpa sorotan, dengan teks "Papan masih kosong, ..." dan demo kartu contoh (butir F) langsung terputar
    (`langkah.teksJikaKosong`). Ditambah satu langkah baru memilih sepotong teks lalu memberi komentar
    (`tip-handover-komentar`, tanpa `izin` tambahan karena komentar terbuka bagi pembaca WH maupun QC). Alasan:
    pengguna baru di papan kosong tak pernah belajar soal checklist, komentar, dan centang, dan nomor "Langkah x dari
    N" melompat. Diubah: 4.5 (kalimat "langkah dilewati atau jatuh ke penjelasan teks" dipertegas); jumlah langkah
    panduan Serah Terima menjadi 3 (WH lihat), 4 (QC), 6 (WH tulis), 7 (keduanya).
  - **I. Versi panduan `dasar-layout` dan `handover-dasar` tetap 1 (2026-11-14, keputusan pemilik produk).**
    Putaran butir F-H menambah langkah (layout 5 → 10, Serah Terima +1) tanpa menaikkan `GUIDE_VERSIONS`, sehingga
    pengguna yang sudah menyelesaikan kedua panduan itu tidak ditawari ulang ("Diperbarui"). Pemilik produk
    menyetujui itu sebagai disengaja: perluasan ini dianggap melengkapi, bukan perombakan alur, dan pengguna yang
    sudah paham tidak perlu diganggu (checklist rilis, tabel "Alur berubah"/"Fitur ditambah": panduan `baru` bila
    perlu, bukan naik versi). Pengguna baru dan yang belum menyelesaikan tetap mendapat versi terbaru. Bukan temuan.
  - **J. Tiruan WhatsApp boleh memakai warna khas WhatsApp (2026-11-14, keputusan pemilik produk atas temuan review
    A7).** Butir E semula menyebut "skema warna sendiri", tetapi `whatsapp-mock.tsx` memakai palet yang meniru
    WhatsApp. Pemilik produk menyetujui palet itu dipertahankan: tujuan demo adalah peragaan yang langsung dikenali
    pengguna, jadi warna yang mirip memang dikehendaki. Batas tetap: tanpa logo, gambar, atau aset resmi, dan tetap
    terbaca di tema terang dan gelap. Diubah: bagian 4 (kalimat adegan `kode` tiruan aplikasi lain). Bukan temuan.
  - **Catatan status.** Butir A dan B sudah ada di kode (`pushAvailable` di `push/lib/support.ts`,
    `deviceGuideRelevance` dan `deriveDeviceGuides` di `catalog/device.ts`, `useDeviceGuides`; kartu, banner, dan menu
    memakai satu fungsi relevansi). Pertanyaan terbuka: tidak ada.

## 7. Cakupan tahap awal dan urutan

0. **Fondasi penyimpanan**: kolom "akun bersama" di Pengaturan Akses > Pengguna, tabel/rute panduan akun individu,
   dan `GuideStore` di klien (4.3). Dikerjakan lebih dulu karena semua panduan bergantung padanya.
1. **Layout dasar** (`dasar`, semua pengguna): sidebar (menu menurut izin), pemilih lokasi aktif, lonceng
   notifikasi, tema, menu profil.
2. **Pasang PWA** dan **aktifkan push** (`dasar`, status `diturunkan` dari keadaan perangkat; memakai mekanisme izin dan
   penanda yang sudah ada di `web/src/modules/push/` dan `web/src/app/pwa/`; klip direkam pemilik).
3. **Serah Terima** (`dasar`, izin `handover`): papan/kartu, buat task (formulir batch), tempel dari WhatsApp
   (tooltip demo: contoh pertama), checklist dan centang, komentar, pengerjaan QC. Daftar langkah rinci ditentukan
   di rencana implementasi bersama pemilik produk.
4. Modul lain (Item, QR Code, Stiker, Postel, Serial Number, Pengaturan Akses) menyusul di tahap berikutnya.

## 8. Pilihan perancang (bukan persetujuan pemilik; dapat dikoreksi)

- Progres sebagian tidak disimpan.
- Mesin tur: pustaka kecil dimuat malas atau tulis sendiri dengan Radix; keputusan di rencana implementasi dengan
  pertimbangan tema (terang/gelap), ukuran, dan kemampuan menunggu klik serta pindah rute.
- Tombol jeda dan titik adegan pada demo.
- Akun bersama: satu kunci `localStorage` per email berisi objek id → versi; akun individu: tabel `guide_progress`
  dengan konvensi tabel notifikasi (4.3).
- Kolom `users.shared_account` bawaan 0 (individu); akun bersama ditandai admin segera setelah rilis (4.3).
- Rute REST panduan tanpa izin modul; validasi id dan versi lewat `shared/guides.ts` (4.3).
- Akun individu: bila status belum termuat atau gagal dimuat, tidak ada penawaran apa pun (4.3).
- Hasil tinjauan pembangun independen (semua diputuskan perancang, bukan pemilik; dapat dikoreksi):
  - `baru` ditawarkan hanya setelah `dasar` modulnya selesai; `dasar` yang selesai menutup `baru` yang tercakup,
    ditulis dalam satu kali tulis (4.2).
  - Tidak ada status `skipped`; penanda ada = selesai; "Nanti" tidak menulis penanda selesai (4.3, 4.4).
  - Tur hanya menyorot, tidak mengisi field apa pun (4.5).
  - `izin` opsional per langkah; langkah tanpa izin dilewati, satu panduan Serah Terima melayani sisi WH dan QC (4.5).
  - Field `halaman` per panduan; satu banner pada satu waktu menurut urutan katalog; layout dasar tanpa banner (4.4).
  - Klip belum siap tidak menghalangi rilis; fallback daftar langkah; klip di `web/public/klip/`, maks. 1 MB (4.6).
  - Panduan PWA/push: status diturunkan dari keadaan perangkat, satu fungsi penawaran dengan dua sumber;
    `PushOnboarding` tidak diganti (4.3).

## 9. Diserahkan ke pembangun

- Rancangan konkret tiap panduan tahap awal (langkah, teks, target `data-tour`) bersama pemilik produk.
- Tata letak kartu beranda, banner, titik penanda sidebar, dan item menu profil dalam gaya komponen yang ada.
- Pemilihan pustaka tur dan penulisan tesnya.
- Aturan penamaan berkas klip dan tempat penyimpanannya (statis, tidak dipra-cache).
- Teks UI santai sesuai gaya proyek.
- Tampilan opsi "Akun bersama" di form pengguna, dan penanda di tabel pengguna (gaya komponen yang ada).

## 10. Risiko dan pertanyaan terbuka

- Rilis pertama: pengguna lama melihat semua panduan sekaligus. Dimitigasi dengan kartu dan banner per halaman (satu per waktu), bukan pop-up beruntun.
- Klip basi tanpa terdeteksi tes; dimitigasi checklist rilis (4.7), bukan otomatis.
- Akun bersama yang belum ditandai admin diperlakukan individu: orang pertama yang menyelesaikan panduan
  menghabiskannya untuk pemakai lain. Dimitigasi langkah rilis (admin menandai akun bersama segera setelah rilis).
- Akun bersama: orang yang membuka akun yang sama di perangkat berbeda melihat panduan lagi (disengaja). Dua orang
  yang berbagi akun dan perangkat yang sama tidak dibedakan; yang kedua memakai "Ulangi" dari menu profil.
- Membersihkan data peramban pada akun bersama menghapus penanda, jadi panduan ditawarkan lagi (disengaja).
