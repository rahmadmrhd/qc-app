import type { GuideEntry, GuidePermission } from '../lib/types';

const SERIAL_VIEW: GuidePermission = { module: 'serial', level: 'view' };
const SERIAL_EDIT: GuidePermission = { module: 'serial', level: 'edit' };

/**
 * Panduan dasar pencatatan Serial Number (spek 7 butir 4; keputusan pemilik 2026-11-17, bagian 6 butir M): daftar
 * serial lalu halaman Catat Serial Number sampai tepat sebelum tombol Simpan. Izin panduan = `serial: view` (modul
 * ber-BU; tim servis yang hanya punya `serialservice` belum dicakup panduan ini), langkah mencatat baru berlaku bagi
 * `serial: edit`, jadi pembaca saja hanya melihat dua langkah daftar. Target `data-tour`: `serial-table`,
 * `serial-filters`, `serial-new` di `modules/serial/components/serial-list-page.tsx`; `serial-defaults`,
 * `serial-stickers`, `serial-scan`, `serial-draft`, `serial-qcsn`, `serial-save` di `record-page.tsx`. Semua
 * langkahnya berjenis `next`: tur tidak mengisi field, tidak memindai, dan tidak menyimpan apa pun.
 */
export const SERIAL_DASAR: GuideEntry = {
  id: 'serial-dasar',
  kind: 'dasar',
  status: 'disimpan',
  version: 1,
  title: 'Mencatat Serial Number',
  izin: SERIAL_VIEW,
  halaman: '/serial',
  steps: [
    {
      target: 'serial-table',
      route: '/serial',
      text: 'Ini daftar Serial Number di Business Unit (BU) yang boleh kamu lihat. Tiap baris memuat item, BU, lokasi, tanggal uji, status (Lolos, Dilaporkan, Rusak, dan seterusnya), serta posisinya. Klik serialnya untuk membuka detail.',
      advance: 'next',
    },
    {
      target: 'serial-filters',
      text: 'Ketik satu serial untuk mencocokkan awalannya, atau tempel beberapa serial (satu per baris) untuk mencocokkan persis. Tombol kamera di kolom pencarian membaca barcode lewat kamera. Di bawahnya ada filter BU, item, lokasi, status, posisi, rentang tanggal uji, dan "Dicatat oleh saya".',
      advance: 'next',
    },
    {
      target: 'serial-new',
      text: 'Mau mencatat serial baru? Tombol ini membuka halaman Catat Serial Number. Kita lanjut ke sana.',
      advance: 'next',
      izin: SERIAL_EDIT,
    },
    {
      target: 'serial-defaults',
      route: '/serial/new',
      text: 'Isi bawaan sekali saja di sini: item (BU mengikuti item), lokasi, tanggal uji, catatan, dan apakah unitnya sample. Isian ini dipakai untuk serial yang ditambahkan sesudahnya; baris yang sudah ada di draft tidak berubah. Panduan tidak mengisi apa pun, jadi isi sendiri saat mencatat sungguhan.',
      advance: 'next',
      izin: SERIAL_EDIT,
    },
    {
      target: 'serial-stickers',
      text: 'Stiker yang berlaku bagi item itu muncul di sini, semuanya tercentang dengan jumlah awalnya (belum muncul sebelum item dipilih). Setiap serial yang disimpan memotong stok stiker yang tercentang sebanyak jumlahnya; stok boleh sampai minus dan akan tampil "Kurang N" di halaman stok.',
      advance: 'next',
      izin: SERIAL_EDIT,
    },
    {
      target: 'serial-scan',
      text: 'Scan dengan pemindai barcode (kolom ini sudah terfokus), atau ketik lalu Enter, atau tempel banyak serial sekaligus, satu per baris. Tiap serial langsung masuk ke draft di bawah dan serial kembar dilewati. Huruf kecil dijadikan huruf besar dan MAC address dirapikan otomatis. Tombol kamera di kanan atas kolom membuka pemindai kamera ponsel.',
      advance: 'next',
      izin: SERIAL_EDIT,
    },
    {
      target: 'serial-draft',
      text: 'Serial yang sudah di-scan berkumpul di draft. Tiap baris bisa diubah langsung (tanggal uji, sample, catatan), dicentang untuk diubah massal, atau dibuka lewat Detail untuk memilih ulang item, lokasi, dan stiker. Kolom Foto untuk melampirkan foto bukti QC (opsional, maksimal 5 per serial). Draft tersimpan otomatis di perangkat ini, jadi aman kalau halaman tertutup.',
      advance: 'next',
      izin: SERIAL_EDIT,
    },
    {
      target: 'serial-qcsn',
      text: 'Perlu memindahkan draft ke perangkat lain? Ekspor jadi berkas .qcsn lalu impor di perangkat itu. Baris yang belum lengkap tidak ikut terekspor.',
      advance: 'next',
      izin: SERIAL_EDIT,
    },
    {
      target: 'serial-save',
      text: 'Simpan menyimpan semua baris sekaligus sebagai Serial Number berstatus Lolos. Serial yang sudah tercatat ditandai duplikat dan tidak dibuat ulang, sedangkan baris yang gagal tetap di draft supaya bisa diperbaiki. Kalau semuanya berhasil, kamu kembali ke daftar. Panduan berhenti di sini: belum ada yang tersimpan.',
      advance: 'next',
      izin: SERIAL_EDIT,
    },
  ],
};

/**
 * Panduan dasar pelaporan unit rusak (keputusan pemilik 2026-11-17, bagian 6 butir M): daftar Laporan, intip detail
 * serial (baris tahap, tombol update, linimasa), lalu halaman Lapor Rusak sampai tepat sebelum tombol "Lapor rusak".
 * Izin = `serial: view`; langkah membuat laporan baru berlaku bagi `serial: edit`. Target `data-tour`: `case-table`,
 * `case-filters`, `case-open`, `case-report` di `case-list-page.tsx`; `serial-stepper`, `serial-actions`,
 * `serial-timeline` di `serial-detail-page.tsx` (dan `act-buttons.tsx`); `report-serial`, `report-result`,
 * `report-new-fields`, `report-message`, `report-submit` di `report-page.tsx` dan `report-form.tsx`.
 *
 * Langkah `case-open` berjenis `click` (pengguna sendiri membuka detail dari baris pertama); detail serial dan
 * tombol update bergantung data (laporan ada atau tidak, hak, status), jadi langkahnya ber-`teksJikaKosong` dan tampil
 * sebagai kartu contoh di tengah layar bila target tak ada. Hasil pencarian di halaman Lapor Rusak baru muncul
 * setelah pengguna mengetik serial: langkah pencarian berjenis `wait` (`waitFor: 'report-result'`); mencari tidak
 * menyimpan apa pun. Tur berhenti SEBELUM tombol "Lapor rusak": tidak ada laporan yang dibuat.
 */
export const SERIAL_LAPORAN: GuideEntry = {
  id: 'serial-laporan',
  kind: 'dasar',
  status: 'disimpan',
  version: 1,
  title: 'Melaporkan unit rusak',
  izin: SERIAL_VIEW,
  halaman: '/serial/reports',
  steps: [
    {
      target: 'case-table',
      route: '/serial/reports',
      text: 'Halaman Laporan memuat laporan unit bermasalah: nomor LP-tanggal-urutan, serial, item, BU, status, lokasi saat ini, lama, pelapor, dan ringkasan. Satu Serial Number paling banyak punya satu laporan aktif. Laporan yang selesai (hasil Lolos atau Rusak) tetap tersimpan di sini.',
      advance: 'next',
    },
    {
      target: 'case-filters',
      text: 'Cari berdasarkan awalan nomor LP atau serial. Bawaannya hanya laporan aktif; ganti ke "Laporan selesai" atau "Semua laporan", dan batasi per BU bila perlu.',
      advance: 'next',
    },
    {
      target: 'case-open',
      text: 'Klik nomor LP untuk membuka detail serialnya, langsung di tab laporan itu. Kita intip isinya.',
      teksJikaKosong:
        'Belum ada laporan, jadi belum ada baris yang bisa dibuka. Begitu ada, kamu tinggal mengklik nomor LP-nya untuk membuka detail serial itu.',
      advance: 'click',
    },
    {
      target: 'serial-stepper',
      text: 'Baris tahap menunjukkan posisi unit dalam penanganan: Lolos, Dilaporkan, Di servis, Diagnosis, Sedang diperbaiki, Menunggu cek ulang, lalu Lolos atau Rusak. Tahap yang menyala adalah status unit sekarang.',
      teksJikaKosong:
        'Belum ada serial yang dibuka. Di halaman detail serial ada baris tahap seperti ini: Lolos, Dilaporkan, Di servis, Diagnosis, Sedang diperbaiki, Menunggu cek ulang, lalu Lolos atau Rusak. Tahap yang menyala adalah status unit sekarang.',
      advance: 'next',
    },
    {
      target: 'serial-actions',
      text: 'Tombol update di sebelah judul Riwayat berubah mengikuti status dan posisi unit, dan hanya menampilkan yang boleh kamu kerjakan: Lapor rusak, Kirim ke servis, Terima, Diagnosis, Cek ulang, atau Catatan. Tim QC dan tim servis mengerjakan bagiannya masing-masing.',
      teksJikaKosong:
        'Tombol update ada di sebelah judul Riwayat pada detail serial. Isinya berubah mengikuti status dan posisi unit, dan hanya menampilkan yang boleh kamu kerjakan: Lapor rusak, Kirim ke servis, Terima, Diagnosis, Cek ulang, atau Catatan. Kalau tidak ada aksi yang cocok bagi kamu, tombolnya tidak tampil.',
      advance: 'next',
    },
    {
      target: 'serial-timeline',
      text: 'Riwayat dibagi per tab: Semua, satu tab per laporan (LP-…), Pengecekan, dan Perubahan data. Tiap kejadian menjadi satu kartu dan yang terbaru ditandai.',
      teksJikaKosong:
        'Riwayat di detail serial dibagi per tab: Semua, satu tab per laporan (LP-…), Pengecekan, dan Perubahan data. Tiap kejadian menjadi satu kartu dan yang terbaru ditandai.',
      advance: 'next',
    },
    {
      target: 'case-report',
      route: '/serial/reports',
      text: 'Ada unit yang bermasalah? Tombol ini membuka halaman Lapor Rusak untuk membuat laporan baru. Kita lanjut ke sana.',
      advance: 'next',
      izin: SERIAL_EDIT,
    },
    {
      target: 'report-serial',
      route: '/serial/report',
      text: 'Ketik atau scan Serial Number yang bermasalah, lalu Enter. Satu laporan untuk satu Serial Number. Mencari belum menyimpan apa pun, jadi ketik serial apa saja (mis. TEST-123) supaya hasilnya muncul; tombol Lanjut aktif setelah hasilnya tampil.',
      advance: 'wait',
      waitFor: 'report-result',
      izin: SERIAL_EDIT,
    },
    {
      target: 'report-result',
      text: 'Hasilnya ada tiga kemungkinan. Belum tercatat: kamu mengisi item dan lokasi, lalu Serial Number dicatat langsung sebagai Dilaporkan. Sudah tercatat dan Lolos: cukup tulis catatan. Tidak bisa dilaporkan (sudah ada laporan aktif, sudah Rusak, atau sedang dalam penanganan): kamu diberi tombol untuk membuka serialnya.',
      advance: 'next',
      izin: SERIAL_EDIT,
    },
    {
      target: 'report-new-fields',
      text: 'Khusus serial yang belum tercatat: pilih item (BU mengikuti item) dan lokasi unitnya.',
      teksJikaKosong:
        'Bagian ini hanya muncul bila Serial Number belum tercatat: kamu memilih item (BU mengikuti item) dan lokasi unitnya, lalu Serial Number dicatat langsung sebagai Dilaporkan.',
      advance: 'next',
      izin: SERIAL_EDIT,
    },
    {
      target: 'report-message',
      text: 'Catatan wajib diisi: apa yang rusak dan gejalanya. Kamu bisa menyisipkan gambar (maksimal 10) sebagai bukti. Catatan ini menjadi isi laporan di riwayat dan dibaca tim servis.',
      teksJikaKosong:
        'Kalau Serial Number bisa dilaporkan, kamu menulis catatan wajib di sini: apa yang rusak dan gejalanya, boleh disertai gambar (maksimal 10) sebagai bukti.',
      advance: 'next',
      izin: SERIAL_EDIT,
    },
    {
      target: 'report-submit',
      text: 'Lapor rusak membuka laporan LP-… berstatus Dilaporkan, lalu membawamu ke detail serial; dari situ unit dikirim ke servis. Tombol ini aktif setelah catatan terisi. Panduan berhenti di sini: belum ada laporan yang dibuat.',
      teksJikaKosong:
        'Kalau Serial Number bisa dilaporkan, tombol Lapor rusak di sini membuka laporan LP-… berstatus Dilaporkan lalu membawamu ke detail serial. Tombol aktif setelah catatan terisi. Panduan berhenti di sini: belum ada laporan yang dibuat.',
      advance: 'next',
      izin: SERIAL_EDIT,
    },
  ],
};

// `SERIAL_LAPORAN` sengaja lebih dulu: banner memilih panduan pertama yang `halaman`-nya cocok dengan rute, dan
// `/serial` juga cocok untuk `/serial/reports` (awalan). Urutan ini menjaga banner Laporan tidak tertutup banner dasar.
export const SERIAL_GUIDES: readonly GuideEntry[] = [SERIAL_LAPORAN, SERIAL_DASAR];
