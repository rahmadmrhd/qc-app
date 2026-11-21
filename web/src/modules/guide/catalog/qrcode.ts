import type { GuideEntry, GuidePermission } from '../lib/types';

const QR_VIEW: GuidePermission = { module: 'qrcode', level: 'view' };
const QR_EDIT: GuidePermission = { module: 'qrcode', level: 'edit' };

/**
 * Panduan QR Code Manual Book (spek 7 butir 4; keputusan pemilik 2026-11-15, bagian 6 butir K; dipersingkat dan
 * dipecah per halaman pada 2026-11-17, butir N: 13 langkah dalam satu tur terlalu panjang): `qrcode-dasar` (daftar,
 * `/qrcode`) dan `qrcode-buat` (membuat konfigurasi di formulir, `/qrcode/new`, 7 langkah). Formulir TIDAK dipecah lagi:
 * satu halaman dan satu tugas tetap satu panduan, jadi pemendekannya lewat penggabungan langkah (isi label, logo,
 * bingkai, dan ukuran dijelaskan dalam satu langkah). Izin `qrcode-dasar` = `qrcode: view` (modul global, tanpa
 * lokasi); tombol Buat konfigurasi dan panduan formulir berizin `qrcode: edit`, jadi pembaca saja hanya melihat dua
 * langkah daftar. `qrcode-dasar` mengecualikan `/qrcode/new` (`halamanKecuali`) agar banner formulir tidak jatuh ke
 * banner daftar; begitu pula `/qrcode/<id>` (View, `$id` = segmen berparameter) dan rute di bawahnya. Target `data-tour`:
 * `qr-header` (`ListPage tour`), `qr-new` (`createAction.tour`), `qr-table` di `routes/_app/qrcode/index.tsx`;
 * `qr-items`, `qr-preset`, `qr-name`, `qr-source`, `qr-label`, `qr-preview` di
 * `modules/qrcode/components/qr-design-form.tsx` dan `qr-save` (`FormPage saveTour`) di `qr-design-form-page.tsx`
 * (`qr-logo`, `qr-frame`, `qr-size` tetap ada di kode tetapi tak lagi disorot sendiri). Formulirnya bertab (Item,
 * Sumber link, Isi label, Logo dan bingkai, Ukuran): langkah yang targetnya berada di tab lain memakai
 * `buka: { tab }` agar mesin tur membuka tab itu lebih dulu (tanpa mengisi apa pun).
 *
 * Form QR baru hanya menampilkan bagian "Item Manual Book" sampai pengguna memilih item (dan konfigurasi default
 * bila diminta), padahal tur tidak mengisi field apa pun. Dua langkah awal `qrcode-buat` memakai `advance: 'wait'`:
 * pengguna memilih item sendiri, lalu tombol Lanjut aktif begitu bagian form berikutnya muncul (`waitFor`). Tur
 * berhenti SEBELUM tombol simpan: tidak ada yang tersimpan atau diekspor.
 */
export const QRCODE_DASAR: GuideEntry = {
  id: 'qrcode-dasar',
  kind: 'dasar',
  status: 'disimpan',
  version: 1,
  title: 'Mengenal daftar QR Code Manual Book',
  grup: 'QR Code Manual Book',
  izin: QR_VIEW,
  halaman: '/qrcode',
  // Semua rute di bawah `/qrcode/<apa pun>` (formulir baru, View, ubah, dan `/qrcode/default*`) punya halaman sendiri.
  halamanKecuali: ['/qrcode/$id'],
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
      text: 'Mau bikin Manual Book baru? Tombol ini membuka formulir konfigurasi baru, yang punya panduannya sendiri.',
      advance: 'next',
      izin: QR_EDIT,
    },
  ],
};

/** Formulir baru: item, konfigurasi default, nama, sumber link, label, pratinjau, dan tombol simpan. */
export const QRCODE_BUAT: GuideEntry = {
  id: 'qrcode-buat',
  kind: 'dasar',
  status: 'disimpan',
  version: 1,
  title: 'Membuat QR Code Manual Book',
  grup: 'QR Code Manual Book',
  izin: QR_EDIT,
  halaman: '/qrcode/new',
  steps: [
    {
      target: 'qr-items',
      route: '/qrcode/new',
      text: 'Mulai dari item. Cari lalu pilih satu atau beberapa item yang berbagi satu Manual Book. Item yang sudah punya Manual Book lain tampil nonaktif: keluarkan dulu dari sana. Panduan tidak mengisi apa pun, jadi pilih sendiri ya. Setelah itu tombol Lanjut aktif.',
      advance: 'wait',
      waitFor: 'qr-preset',
    },
    {
      target: 'qr-preset',
      text: 'Konfigurasi default ditarik dari BU item, dan isinya langsung mengisi formulir di bawah (tetap bisa kamu ubah). Kalau item berlainan BU, atau BU-nya belum punya konfigurasi default, kamu diminta memilih sendiri di sini. Lanjut aktif setelah formulir lengkap muncul.',
      advance: 'wait',
      waitFor: 'qr-name',
    },
    {
      target: 'qr-name',
      text: 'Nama Manual Book dibuat otomatis dari tipe item, dan boleh kamu edit. Namanya harus unik. Saat QR pertama kali diekspor, nama ini jadi nama stiker "MB - nama vN".',
      advance: 'next',
    },
    {
      target: 'qr-source',
      // Formulir bertab: panel Sumber link berada di tab sendiri; tur membukanya (hanya memilih tab, tak mengisi apa pun).
      buka: { tab: 'sumber' },
      text: 'Sumber link: unggah PDF manualnya (maksimal 10 MB) atau salin dari Google Drive. QR akan mengarah ke PDF ini, dan PDF-nya bisa dibuka siapa saja yang punya link, jadi pastikan isinya memang boleh dibagikan.',
      advance: 'next',
    },
    {
      target: 'qr-label',
      buka: { tab: 'label' },
      text: 'Isi label: Title, Subtitle, dan Footer, lengkap dengan ukuran huruf dan gaya teks; bagian yang terkunci otomatis mengikuti Nama Manual Book. Di bawahnya ada logo di tengah QR (dari pustaka logo bersama, maksimal 15% luas QR), bingkai (tanpa bingkai, siku di sudut, atau kotak penuh), dan ukuran serta jarak tiap bagian di label 3 × 3 cm.',
      advance: 'next',
    },
    {
      target: 'qr-preview',
      text: 'Pratinjau label 3 × 3 cm berubah langsung saat kamu mengisi. Kalau isinya tidak muat, muncul peringatan dan label belum bisa diekspor. Tombol Pratinjau lembar menampilkan lembar cetak 10 × 14.',
      advance: 'next',
    },
    {
      target: 'qr-save',
      text: 'Simpan hanya menyimpan konfigurasi. Simpan dan ekspor menyimpan lalu membuat PDF lembar dan PNG di Drive; versi stiker Manual Book baru lahir saat ekspor berhasil, dan ekspor ulang dengan label berubah meminta alasan. Panduan berhenti di sini, belum ada yang tersimpan.',
      advance: 'next',
    },
  ],
};

export const QRCODE_GUIDES: readonly GuideEntry[] = [QRCODE_DASAR, QRCODE_BUAT];
