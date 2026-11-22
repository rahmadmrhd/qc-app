import type { GuideEntry, GuidePermission } from '../lib/types';

const SERIAL_VIEW: GuidePermission = { module: 'serial', level: 'view' };
const SERIAL_EDIT: GuidePermission = { module: 'serial', level: 'edit' };

/**
 * Panduan Serial Number (spek bagian 6 butir M, keputusan pemilik 2026-11-17): lima panduan `dasar` ringkas, satu per
 * halaman atau tugas (formulir catat memuat ubah massal; satu halaman tidak dipecah), supaya tak ada tur yang panjang. Izin = modul `serial` (tim servis `serialservice` belum
 * dicakup). Tur tidak mengisi, memindai, atau menyimpan apa pun; langkah `wait` hanya menunggu pengguna mengetik atau
 * mencentang sendiri. Daftar target `data-tour` ada di komentar tiap panduan.
 *
 * Banner per halaman (`halaman`, satu banner pada satu waktu, urutan katalog): `/serial` dan `/serial/new` ditangani
 * panduan masing-masing, sedangkan `/serial/report(s)`, `/serial/settings`, dan halaman detail `/serial/$serialId`
 * dikecualikan dari panduan `/serial` (`SERIAL_LIST_EXCEPT`) agar banner daftar tidak muncul di halaman lain. Detail
 * serial adalah `ViewPage` bertab (Detail, Riwayat, Foto bukti): hanya tab aktif yang dirender, jadi langkah yang
 * menyorot isi tab lain memakai `buka: { tab }` (mesin tur membuka tabnya lewat jalur pilih tab yang sama).
 */
const SERIAL_LIST_EXCEPT = [
  '/serial/$serialId',
  '/serial/new',
  '/serial/report',
  '/serial/reports',
  '/serial/settings',
] as const;

/** Daftar Serial Number. Target: `serial-table`, `serial-filters`, `serial-new` (`serial-list-page.tsx`). */
export const SERIAL_DAFTAR: GuideEntry = {
  id: 'serial-daftar',
  kind: 'dasar',
  status: 'disimpan',
  version: 1,
  title: 'Mengenal daftar Serial Number',
  grup: 'Serial Number',
  izin: SERIAL_VIEW,
  halaman: '/serial',
  halamanKecuali: SERIAL_LIST_EXCEPT,
  steps: [
    {
      target: 'serial-table',
      route: '/serial',
      text: 'Ini daftar Serial Number di Business Unit (BU) yang boleh kamu lihat: item, BU, lokasi, tanggal uji, status (Lolos, Dilaporkan, Rusak, dan seterusnya), serta posisinya. Klik serialnya untuk membuka detail.',
      advance: 'next',
    },
    {
      target: 'serial-filters',
      text: 'Ketik satu serial untuk mencocokkan awalannya, atau tempel beberapa (satu per baris) untuk mencocokkan persis; tombol kamera membaca barcode. Filter lain: BU, item, lokasi, status, posisi, dan "Dicatat oleh saya".',
      advance: 'next',
    },
    {
      target: 'serial-new',
      text: 'Mau mencatat serial baru? Tombol ini membuka halaman Catat Serial Number, yang punya panduannya sendiri.',
      advance: 'next',
      izin: SERIAL_EDIT,
    },
  ],
};

/**
 * Detail satu Serial Number, dibuka dari baris pertama daftar (langkah `click`). Target: `serial-open`
 * (`serial-list-page.tsx`); `serial-stepper` (tab Detail); `serial-actions` (bar judul header di SEMUA tab, `actionsTour`
 * di `serial-detail-page.tsx`, juga dipakai `case-detail-page.tsx`; bar bawah di ponsel); `serial-timeline` (tab Riwayat,
 * baris tombol filter di `timeline-section.tsx`). Semua langkah detail bergantung data, jadi ber-`teksJikaKosong`.
 */
export const SERIAL_DETAIL: GuideEntry = {
  id: 'serial-detail',
  kind: 'dasar',
  status: 'disimpan',
  version: 1,
  title: 'Membaca detail Serial Number',
  grup: 'Serial Number',
  izin: SERIAL_VIEW,
  halaman: '/serial',
  halamanKecuali: SERIAL_LIST_EXCEPT,
  steps: [
    {
      target: 'serial-open',
      route: '/serial',
      text: 'Klik salah satu serial untuk membuka detailnya. Kita intip isinya.',
      teksJikaKosong:
        'Belum ada serial di daftar. Begitu ada, klik serialnya untuk membuka halaman detail.',
      advance: 'click',
    },
    {
      target: 'serial-stepper',
      buka: { tab: 'detail' },
      text: 'Di tab Detail, baris tahap menunjukkan posisi unit dalam penanganan, dari Lolos sampai Lolos atau Rusak. Tahap yang menyala adalah status unit sekarang.',
      teksJikaKosong:
        'Di tab Detail serial ada baris tahap: Lolos, Dilaporkan, Di servis, Diagnosis, Sedang diperbaiki, Menunggu cek ulang, lalu Lolos atau Rusak. Tahap yang menyala adalah status unit sekarang.',
      advance: 'next',
    },
    {
      target: 'serial-actions',
      text: 'Semua aksi ada di bar judul di atas halaman (bar bawah di ponsel), apa pun tabnya, dan berubah mengikuti status dan posisi unit; hanya yang boleh kamu kerjakan yang tampil. Dua atau tiga aksi yang paling sering dipakai di tahap itu jadi tombol, misalnya Lapor rusak dan Ubah data saat unit Lolos, atau Cek ulang dan Kirim ke servis saat Dilaporkan. Sisanya (Tempel stiker, Catatan, dan aksi lain) ada di tombol titik tiga Aksi lainnya. Tempel stiker mencatat stiker yang baru ditempel (tiap centang menambah satu dan memotong stok satu).',
      teksJikaKosong:
        'Di detail serial, semua aksi ada di bar judul di atas halaman (bar bawah di ponsel), apa pun tabnya. Dua atau tiga aksi yang paling sering dipakai di tahap itu jadi tombol (misalnya Lapor rusak dan Ubah data, atau Cek ulang dan Kirim ke servis), sisanya seperti Tempel stiker dan Catatan ada di tombol titik tiga Aksi lainnya. Isinya berubah mengikuti status dan posisi unit, dan hanya yang boleh kamu kerjakan; tanpa aksi yang cocok, tombolnya tidak tampil.',
      advance: 'next',
    },
    {
      target: 'serial-actions',
      text: 'Alurnya: QC melaporkan lalu Kirim ke servis. Tim servis Terima, Diagnosis, Sedang diperbaiki, lalu Selesai (kembali ke QC) atau Nyatakan rusak. QC Terima lalu Cek ulang: lolos menutup laporan, tidak lolos membuatnya tetap terbuka.',
      teksJikaKosong:
        'Alurnya: QC melaporkan lalu Kirim ke servis. Tim servis Terima, Diagnosis, Sedang diperbaiki, lalu Selesai (kembali ke QC) atau Nyatakan rusak. QC Terima lalu Cek ulang: lolos menutup laporan, tidak lolos membuatnya tetap terbuka.',
      advance: 'next',
    },
    {
      target: 'serial-timeline',
      buka: { tab: 'riwayat' },
      text: 'Di tab Riwayat, tombol di atas linimasa (awalnya Semua Riwayat) membuka pilihan filter: Semua Riwayat, Riwayat Pengecekan, dan Riwayat Perubahan Data; angka di tiap pilihan = jumlah kejadiannya. Di Semua Riwayat, semua kejadian satu laporan (mis. LP/SBY/2611-0001) diringkas jadi satu kartu yang membuka halaman detail laporan; kejadian lain jadi satu kartu masing-masing dan yang terbaru ditandai.',
      teksJikaKosong:
        'Riwayat di detail serial punya tombol filter di atas linimasa: Semua Riwayat, Riwayat Pengecekan, dan Riwayat Perubahan Data, dengan jumlah kejadian di tiap pilihan. Di Semua Riwayat, semua kejadian satu laporan (mis. LP/SBY/2611-0001) diringkas jadi satu kartu yang membuka halaman detail laporan; kejadian lain jadi satu kartu masing-masing dan yang terbaru ditandai.',
      advance: 'next',
    },
  ],
};

/**
 * Catat Serial Number: bawaan, scan, draft, ubah massal, dan Simpan. Target: `serial-defaults`, `serial-scan`,
 * `serial-draft`, `serial-row-actions` (hanya tabel; di ponsel baris berupa kartu tanpa tombol aksi, jadi langkahnya
 * `langsung` dengan kartu pengganti), `serial-row-select` (ada di tabel dan kartu), `serial-bulk` (bar aksi pilihan),
 * `serial-save` (tombol Simpan `FormPage` lewat `saveTour` di `record-page.tsx`: bar judul di desktop, bar bawah di
 * ponsel; `staging-table.tsx`, `staging-cards.tsx`, `selection-bar.tsx`). Dua langkah
 * `wait`: menunggu baris draft pertama (`serial-row`, ada di tabel dan kartu), lalu menunggu pengguna mencentang baris
 * sampai bar aksi pilihan muncul. Berhenti SEBELUM Simpan.
 */
export const SERIAL_CATAT: GuideEntry = {
  id: 'serial-catat',
  kind: 'dasar',
  status: 'disimpan',
  version: 3,
  title: 'Mencatat Serial Number',
  grup: 'Serial Number',
  izin: SERIAL_EDIT,
  halaman: '/serial/new',
  steps: [
    {
      target: 'serial-defaults',
      route: '/serial/new',
      text: 'Isi Default dulu, urutannya: lokasi, tanggal uji, item, dan BU wajib terisi sebelum kamu bisa scan; sample, stiker yang ditempel, dan catatan opsional (semua stiker yang berlaku tercentang; tiap serial yang disimpan memotong stok stikernya). Lokasi terkunci otomatis kalau lokasi aktif di header cuma satu. BU terisi sendiri bila item hanya punya satu BU, dan boleh kamu ganti ke BU mana pun. Catatan memakai editor Markdown. Kolom scan tetap abu-abu dengan petunjuk "Isi Default dulu" selama masih ada yang kosong. Dipakai untuk serial yang ditambahkan sesudahnya. Panduan tidak mengisi apa pun, jadi isi sendiri.',
      advance: 'next',
    },
    {
      target: 'serial-scan',
      text: 'Scan dengan pemindai barcode, ketik lalu Enter, tempel banyak serial (satu per baris), atau pakai tombol kamera di kanan atas. Coba ketik serial apa saja (mis. TEST-001) lalu Enter; Lanjut aktif setelah satu baris muncul di draft. Kalau kolomnya masih abu-abu, balik dulu ke Default. Item yang wajib foto bukti berbeda: satu serial per kali, lalu muncul dialog dua langkah (scan, lalu konfirmasi dengan info item, serial yang masih bisa diedit, dan foto). Tombol Simpan di dialog baru aktif setelah fotonya cukup, dan barisnya baru masuk draft sesudah itu. Serial yang ternyata sudah tercatat tidak jadi serial baru: barisnya menjadi baris Cek ulang. Belum ada yang tersimpan sampai kamu menekan Simpan di halaman.',
      advance: 'wait',
      waitFor: 'serial-row',
    },
    {
      target: 'serial-draft',
      text: 'Tiap serial jadi satu baris draft (di ponsel berupa kartu). Serial dan tanggal uji bisa diubah langsung di tabel; item, lokasi, sample, catatan, stiker, dan foto bukti (maksimal 5) lewat dialog Ubah baris. Item wajib foto yang fotonya kurang ditandai "Butuh n foto lagi" dan menahan Simpan. Serial yang sudah tercatat berlencana "Cek ulang": item terkunci mengikuti catatannya, BU bisa dipilih bila perlu (hanya BU yang boleh), dan tidak ada stiker yang tercentang, jadi centang hanya stiker yang kamu tempel lagi lewat Ubah baris. Serial yang sedang punya laporan aktif atau sudah Rusak tidak bisa disimpan dari sini. Kolom Hasil juga memberi tahu hasil sesudah Simpan (gagal atau bermasalah). Draft tersimpan otomatis di perangkat ini; Impor/Ekspor .qcsn untuk pindah perangkat.',
      advance: 'next',
    },
    {
      target: 'serial-row-actions',
      text: 'Detail membuka dialog Ubah baris: semua kolom baris ini bisa diubah di sana. Hapus membuang baris itu dari draft.',
      teksJikaKosong:
        'Di layar sempit baris tampil sebagai kartu tanpa tombol aksi: ketuk kartunya untuk membuka dialog Ubah baris, tempat kamu mengubah semua kolom baris itu. Menghapus satu baris: pilih dulu barisnya (tombol Pilih di atas daftar, atau tahan kartunya), lalu Hapus di bar aksi.',
      langsung: true,
      advance: 'next',
    },
    {
      target: 'serial-row-select',
      text: 'Mau ubah atau hapus banyak baris sekaligus? Di tabel, centang baris ini (atau kotak "Pilih semua" di judul tabel untuk semuanya). Di ponsel, ketuk tombol Pilih di atas daftar (atau tahan sebuah kartu beberapa saat) untuk masuk mode pilih, lalu ketuk kartu yang mau dipilih; kotak centang di kiri bar bawah memilih semua baris. Bar aksi muncul begitu ada yang terpilih (di ponsel, begitu kamu masuk mode pilih) dan Lanjut aktif.',
      advance: 'wait',
      waitFor: 'serial-bulk',
    },
    {
      target: 'serial-bulk',
      text: 'Bar aksi punya Edit, yang membuka dialog ubah massal (isi hanya kolom yang mau diubah untuk semua baris terpilih, kosong = tidak diubah, lalu Terapkan), dan Hapus, yang membuang baris terpilih beserta foto buktinya setelah kamu konfirmasi. Di tabel (layar lebar) ada juga tombol Batalkan pilihan. Di ponsel bar itu satu baris: kotak centang di kirinya memilih semua (atau mengosongkan pilihan bila semua sudah terpilih) dan tombol atau gestur kembali juga keluar dari mode pilih. Panduan tidak menerapkan atau menghapus apa pun.',
      advance: 'next',
    },
    {
      target: 'serial-save',
      teksJikaKosong:
        'Simpan ada di bar judul di atas halaman (di ponsel di bar bawah, yang tersembunyi selama ada baris terpilih: keluar dari mode pilih dulu). Simpan menyimpan semua baris sebagai Serial Number berstatus Lolos. Panduan berhenti di sini: belum ada yang tersimpan.',
      langsung: true,
      text: 'Simpan menyimpan semua baris sebagai Serial Number berstatus Lolos. Baris yang belum lengkap (termasuk foto bukti kurang) menahan Simpan; baris Cek ulang dicatat sebagai cek ulang lolos pada serial yang sudah ada (bukan serial baru) dan baris yang gagal tetap di draft. Kalau semuanya berhasil kamu kembali ke daftar. Panduan berhenti di sini: belum ada yang tersimpan, dan baris contohmu bisa dibuang dengan Kosongkan draft.',
      advance: 'next',
    },
  ],
};

/** Daftar Laporan. Target: `case-table`, `case-filters`, `case-report` (`case-list-page.tsx`). */
export const SERIAL_LAPORAN_DAFTAR: GuideEntry = {
  id: 'serial-laporan-daftar',
  kind: 'dasar',
  status: 'disimpan',
  version: 1,
  title: 'Mengenal daftar Laporan',
  grup: 'Serial Number',
  izin: SERIAL_VIEW,
  halaman: '/serial/reports',
  // Detail laporan (`/serial/reports/$caseId`) bukan halaman daftar: tanpa banner panduan daftar.
  halamanKecuali: ['/serial/reports/$caseId'],
  steps: [
    {
      target: 'case-table',
      route: '/serial/reports',
      text: 'Halaman Laporan memuat laporan unit bermasalah: nomor LP, serial, item, status, lokasi, durasi, pelapor. Satu serial paling banyak punya satu laporan aktif. Klik nomor LP untuk membuka halaman detail laporannya.',
      advance: 'next',
    },
    {
      target: 'case-filters',
      text: 'Cari dengan awalan nomor LP atau serial. Bawaannya hanya laporan aktif; ganti ke "Laporan selesai" atau "Semua laporan", dan batasi per BU bila perlu.',
      advance: 'next',
    },
    {
      target: 'case-report',
      text: 'Ada unit yang bermasalah? Tombol ini membuka halaman Lapor Rusak, yang punya panduannya sendiri.',
      advance: 'next',
      izin: SERIAL_EDIT,
    },
  ],
};

/**
 * Lapor Rusak. Langkahnya MENYESUAIKAN hasil pencarian (yang tampil tergantung serial yang diketik): sesudah langkah
 * `wait`, tiap langkah ber-`langsung` tanpa `teksJikaKosong` dilewati seketika bila bagiannya tak ada. Target:
 * `report-serial`, `report-result` (semua hasil), `report-blocked-open` (hanya serial yang tak bisa dilaporkan),
 * `report-new-fields` dan `report-message` (hanya yang bisa dilaporkan) di `report-form.tsx`, serta `report-submit`
 * (tombol "Lapor rusak" milik `FormPage`, lewat `saveTour` di `report-page.tsx`: bar judul di desktop, bar bawah di
 * ponsel; SELALU ada, nonaktif sampai ada form laporan dengan catatan terisi). Berhenti SEBELUM tombol "Lapor rusak".
 */
export const SERIAL_LAPORAN: GuideEntry = {
  id: 'serial-laporan',
  kind: 'dasar',
  status: 'disimpan',
  version: 1,
  title: 'Membuat laporan unit rusak',
  grup: 'Serial Number',
  izin: SERIAL_EDIT,
  halaman: '/serial/report',
  steps: [
    {
      target: 'report-serial',
      route: '/serial/report',
      text: 'Ketik atau scan Serial Number yang bermasalah, lalu Enter. Satu laporan untuk satu Serial Number. Mencari belum menyimpan apa pun; untuk melihat formulir lengkap, ketik serial yang belum tercatat (mis. TEST-123). Lanjut aktif setelah hasilnya tampil.',
      advance: 'wait',
      waitFor: 'report-result',
    },
    {
      target: 'report-result',
      text: 'Hasil pencarian tampil di sini. Belum tercatat: kamu isi item dan lokasi, lalu dicatat langsung sebagai Dilaporkan. Sudah tercatat dan Lolos: cukup tulis catatan. Selain itu serial tidak bisa dilaporkan lagi dari sini.',
      advance: 'next',
    },
    {
      target: 'report-blocked-open',
      text: 'Serial ini tidak bisa dilaporkan lagi: sudah ada laporan aktif, sudah dinyatakan Rusak, atau sedang ditangani. Tombol ini membuka laporan atau serialnya untuk dilanjutkan di sana. Karena itu panduan tidak membahas formulir.',
      langsung: true,
      advance: 'next',
    },
    {
      target: 'report-new-fields',
      text: 'Serial ini belum tercatat: pilih item (BU mengikuti item) dan lokasi unitnya.',
      langsung: true,
      advance: 'next',
    },
    {
      target: 'report-message',
      text: 'Catatan wajib diisi: apa yang rusak dan gejalanya. Boleh menyisipkan gambar (maksimal 10) sebagai bukti. Catatan ini menjadi isi laporan dan dibaca tim servis.',
      langsung: true,
      advance: 'next',
    },
    {
      target: 'report-submit',
      text: 'Lapor rusak membuka laporan baru (mis. LP/SBY/2611-0001) berstatus Dilaporkan lalu membawamu ke detail serial. Tombolnya ada di bar judul (di ponsel di bar bawah) dan baru aktif setelah ada serial yang bisa dilaporkan dengan catatan terisi. Panduan berhenti di sini: belum ada laporan yang dibuat.',
      langsung: true,
      advance: 'next',
    },
  ],
};

export const SERIAL_GUIDES: readonly GuideEntry[] = [
  SERIAL_DAFTAR,
  SERIAL_DETAIL,
  SERIAL_CATAT,
  SERIAL_LAPORAN_DAFTAR,
  SERIAL_LAPORAN,
];
