import type { GuideEntry, GuidePermission } from '../lib/types';

const QR_VIEW: GuidePermission = { module: 'qrcode', level: 'view' };
const QR_EDIT: GuidePermission = { module: 'qrcode', level: 'edit' };

/**
 * Panduan dasar QR Code Manual Book (spek 7 butir 4; keputusan pemilik 2026-11-15, bagian 6 butir K): membuat
 * konfigurasi QR dari nol sampai tepat sebelum tombol simpan. Izin panduan = `qrcode: view` (modul global, tanpa
 * lokasi); langkah pembuatan (tombol Buat konfigurasi dan seluruh form) baru berlaku bagi `qrcode: edit`, jadi
 * pembaca saja hanya melihat dua langkah daftar. Target `data-tour`: `qr-header`, `qr-table`, `qr-new` di
 * `routes/_app/qrcode/index.tsx`; `qr-items`, `qr-preset`, `qr-name`, `qr-source`, `qr-label`, `qr-logo`,
 * `qr-frame`, `qr-size`, `qr-preview`, `qr-save` di `modules/qrcode/components/qr-design-form.tsx`.
 *
 * Form QR baru hanya menampilkan bagian "Item Manual Book" sampai pengguna memilih item (dan konfigurasi default
 * bila diminta), padahal tur tidak mengisi field apa pun. Dua langkah awal form memakai `advance: 'wait'`: pengguna
 * memilih item sendiri, lalu tombol Lanjut aktif begitu bagian form berikutnya muncul (`waitFor`). Tur berhenti
 * SEBELUM tombol simpan: tidak ada yang tersimpan atau diekspor.
 */
export const QRCODE_DASAR: GuideEntry = {
  id: 'qrcode-dasar',
  kind: 'dasar',
  status: 'disimpan',
  version: 1,
  title: 'Membuat QR Code Manual Book',
  izin: QR_VIEW,
  halaman: '/qrcode',
  steps: [
    {
      target: 'qr-header',
      route: '/qrcode',
      text: 'Di sini kamu mengelola QR Code label. Satu konfigurasi sama dengan satu Manual Book: item-item yang digabung ke dalamnya memakai satu QR dan satu stiker Manual Book.',
      advance: 'next',
    },
    {
      target: 'qr-table',
      text: 'Daftar konfigurasi memuat item yang tergabung, versi stiker (v1, v2, dan seterusnya), serta status ekspornya. Dari sini kamu bisa mengubah, mengekspor ulang, atau mengunduh PDF dan PNG-nya, sesuai akses kamu.',
      advance: 'next',
    },
    {
      target: 'qr-new',
      text: 'Mau bikin Manual Book baru? Tombol ini membuka formulir konfigurasi baru. Kita lanjut ke sana.',
      advance: 'next',
      izin: QR_EDIT,
    },
    {
      target: 'qr-items',
      route: '/qrcode/new',
      text: 'Mulai dari item. Cari lalu pilih satu atau beberapa item yang berbagi satu Manual Book. Item yang sudah punya Manual Book lain tampil nonaktif: keluarkan dulu dari sana. Panduan tidak mengisi apa pun, jadi pilih sendiri ya. Setelah itu tombol Lanjut aktif.',
      advance: 'wait',
      waitFor: 'qr-preset',
      izin: QR_EDIT,
    },
    {
      target: 'qr-preset',
      text: 'Konfigurasi default ditarik dari BU item, dan isinya langsung mengisi formulir di bawah (tetap bisa kamu ubah). Kalau item berlainan BU, atau BU-nya belum punya konfigurasi default, kamu diminta memilih sendiri di sini. Lanjut aktif setelah formulir lengkap muncul.',
      advance: 'wait',
      waitFor: 'qr-name',
      izin: QR_EDIT,
    },
    {
      target: 'qr-name',
      text: 'Nama Manual Book dibuat otomatis dari tipe item, dan boleh kamu edit. Namanya harus unik. Saat QR pertama kali diekspor, nama ini jadi nama stiker "Manual Book - nama vN".',
      advance: 'next',
      izin: QR_EDIT,
    },
    {
      target: 'qr-source',
      text: 'Sumber link: unggah PDF manualnya (maksimal 10 MB) atau salin dari Google Drive. QR akan mengarah ke PDF ini, dan PDF-nya bisa dibuka siapa saja yang punya link, jadi pastikan isinya memang boleh dibagikan.',
      advance: 'next',
      izin: QR_EDIT,
    },
    {
      target: 'qr-label',
      text: 'Isi label: Title, Subtitle, dan Footer, lengkap dengan ukuran huruf dan gaya teks. Bagian yang terkunci otomatis mengikuti Nama Manual Book, sesuai konfigurasi default.',
      advance: 'next',
      izin: QR_EDIT,
    },
    {
      target: 'qr-logo',
      text: 'Logo di tengah QR dipilih dari pustaka logo bersama. Logo beserta latarnya maksimal 15% luas QR supaya QR tetap terbaca.',
      advance: 'next',
      izin: QR_EDIT,
    },
    {
      target: 'qr-frame',
      text: 'Bingkai QR: tanpa bingkai, siku di sudut, atau kotak penuh, dengan garis solid, putus-putus, atau titik-titik.',
      advance: 'next',
      izin: QR_EDIT,
    },
    {
      target: 'qr-size',
      text: 'Ukuran dan jarak tiap bagian di label 3 × 3 cm diatur di sini.',
      advance: 'next',
      izin: QR_EDIT,
    },
    {
      target: 'qr-preview',
      text: 'Pratinjau label 3 × 3 cm berubah langsung saat kamu mengisi. Kalau isinya tidak muat, muncul peringatan dan label belum bisa diekspor. Tombol Pratinjau lembar menampilkan lembar cetak 10 × 14.',
      advance: 'next',
      izin: QR_EDIT,
    },
    {
      target: 'qr-save',
      text: 'Simpan hanya menyimpan konfigurasi. Simpan dan ekspor menyimpan lalu membuat PDF lembar dan PNG di Drive; versi stiker Manual Book baru lahir saat ekspor berhasil, dan ekspor ulang dengan label berubah meminta alasan. Panduan berhenti di sini, belum ada yang tersimpan.',
      advance: 'next',
      izin: QR_EDIT,
    },
  ],
};

export const QRCODE_GUIDES: readonly GuideEntry[] = [QRCODE_DASAR];
