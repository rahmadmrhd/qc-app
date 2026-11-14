import type { GuideEntry } from '../lib/types';

/**
 * Panduan dasar tata letak aplikasi (spek 7 butir 1): berlaku bagi semua pengguna, tanpa halaman (tanpa banner;
 * ditawarkan lewat kartu/menu). Target `data-tour` dipasang di `app-shell.tsx`, `app-sidebar.tsx`,
 * `location-picker.tsx`, `notification-bell.tsx`, `theme-toggle.tsx`, dan `user-menu.tsx`. Tiap tombol di header
 * disusul langkah yang MEMBUKA menunya sendiri (`buka`, murni UI) dan menyorot isinya (`location-menu`,
 * `notification-menu`, `theme-menu`, `user-menu-account`, `user-menu-content`). Pemilih lokasi hanya dirender bila
 * pengguna punya lebih dari satu lokasi, dan sidebar tertutup di ponsel: langkah yang targetnya tak muncul (atau
 * yang pemicu menunya tak ada) dilewati mesin tur.
 */
export const DASAR_LAYOUT: GuideEntry = {
  id: 'dasar-layout',
  kind: 'dasar',
  status: 'disimpan',
  version: 1,
  title: 'Mengenal tampilan aplikasi',
  steps: [
    {
      target: 'sidebar-menu',
      text: 'Menu di sini mengikuti akses kamu.',
      advance: 'next',
      inSidebar: true,
    },
    {
      target: 'location-picker',
      text: 'Ini pemilih lokasi aktif. Kalau kamu pegang beberapa lokasi, di sinilah kamu memilihnya.',
      advance: 'next',
    },
    {
      target: 'location-menu',
      buka: 'location-picker',
      text: 'Ini daftar lokasimu. Centang satu atau beberapa lokasi; daftar di halaman (papan, stok, dan lainnya) langsung ikut berubah mengikuti lokasi yang tercentang.',
      advance: 'next',
    },
    {
      target: 'notification-bell',
      text: 'Lonceng ini menampung kabar terbaru. Angka merahnya jumlah yang belum kamu baca.',
      advance: 'next',
    },
    {
      target: 'notification-menu',
      buka: 'notification-bell',
      text: 'Isinya kabar terbaru di task Serah Terima, seperti komentar dan centang. Klik satu kabar untuk langsung membuka task-nya, atau pakai "Tandai semua dibaca" untuk membersihkan angkanya.',
      advance: 'next',
    },
    {
      target: 'theme-toggle',
      text: 'Tombol ini mengatur tampilan aplikasi: terang atau gelap.',
      advance: 'next',
    },
    {
      target: 'theme-menu',
      buka: 'theme-toggle',
      text: 'Pilih Terang, Gelap, atau Ikuti sistem (mengikuti pengaturan perangkatmu). Pilihannya diingat di perangkat ini.',
      advance: 'next',
    },
    {
      target: 'user-menu',
      text: 'Ini menu akunmu.',
      advance: 'next',
    },
    {
      target: 'user-menu-account',
      buka: 'user-menu',
      text: 'Paling atas ada nama dan email akun yang sedang dipakai. Cek di sini kalau perangkatnya dipakai bergantian.',
      advance: 'next',
    },
    {
      target: 'user-menu-content',
      buka: 'user-menu',
      text: 'Di bawahnya ada Pasang aplikasi (kalau perangkatmu bisa), Panduan untuk membuka tur seperti ini lagi, Notifikasi push, dan Keluar.',
      advance: 'next',
    },
  ],
};
