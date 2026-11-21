import type { GuideEntry } from '../lib/types';

/**
 * Panduan dasar tata letak aplikasi (spek 7 butir 1): berlaku bagi semua pengguna, tanpa halaman (tanpa banner;
 * ditawarkan lewat kartu/menu). Target `data-tour` dipasang di `app-shell.tsx`, `app-sidebar.tsx`,
 * `location-picker.tsx`, `notification-bell.tsx`, `theme-toggle.tsx`, dan `user-menu.tsx`. Tiap tombol di header
 * diwakili satu langkah yang MEMBUKA menunya sendiri (`buka`, murni UI) dan menyorot isinya (`location-menu`,
 * `notification-menu`, `theme-menu`, `user-menu-content`); langkah "sorot tombol" dan "sorot isi menu" digabung (keputusan
 * pemilik 2026-11-17: 10 langkah terlalu panjang, kini 5), dan target tombolnya (`location-picker`, `notification-bell`,
 * `theme-toggle`, `user-menu`) tetap dipakai sebagai pemicu `buka`. Pemilih lokasi hanya dirender bila
 * pengguna punya lebih dari satu lokasi, dan sidebar tertutup di ponsel: langkah yang targetnya tak muncul (atau
 * yang pemicu menunya tak ada) dilewati mesin tur.
 */
export const DASAR_LAYOUT: GuideEntry = {
  id: 'dasar-layout',
  kind: 'dasar',
  status: 'disimpan',
  version: 1,
  title: 'Mengenal tampilan aplikasi',
  grup: 'Umum',
  steps: [
    {
      target: 'sidebar-menu',
      text: 'Menu di sini mengikuti akses kamu.',
      advance: 'next',
      inSidebar: true,
    },
    {
      target: 'location-menu',
      buka: 'location-picker',
      text: 'Ini pemilih lokasi aktif. Centang satu atau beberapa lokasi yang kamu pegang; daftar di halaman (papan, stok, dan lainnya) langsung ikut berubah mengikuti lokasi yang tercentang. Di ponsel, lokasi aktif ada di baris di bawah judul pada halaman yang bergantung lokasi; ketuk untuk memilih.',
      advance: 'next',
    },
    {
      target: 'notification-menu',
      buka: 'notification-bell',
      text: 'Lonceng menampung kabar terbaru di task Serah Terima, seperti komentar dan centang; angka merahnya jumlah yang belum kamu baca. Klik satu kabar untuk langsung membuka task-nya, atau pakai "Tandai semua dibaca" untuk membersihkan angkanya.',
      advance: 'next',
    },
    {
      target: 'theme-menu',
      buka: 'theme-toggle',
      text: 'Tombol ini mengatur tampilan aplikasi: Terang, Gelap, atau Ikuti sistem (mengikuti pengaturan perangkatmu). Pilihannya diingat di perangkat ini.',
      advance: 'next',
    },
    {
      target: 'user-menu-content',
      buka: 'user-menu',
      text: 'Ini menu akunmu. Paling atas ada nama dan email akun yang sedang dipakai (cek di sini kalau perangkatnya dipakai bergantian). Di bawahnya ada Pasang aplikasi (kalau perangkatmu bisa), Panduan untuk membuka tur seperti ini lagi, Notifikasi push, dan Keluar. Di ponsel, menu ini berupa lembar dari bawah yang juga memuat Lokasi aktif, pilihan Tema, dan antrean yang belum terkirim.',
      advance: 'next',
    },
  ],
};
