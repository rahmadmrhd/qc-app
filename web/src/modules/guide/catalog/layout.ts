import type { GuideEntry } from '../lib/types';

/**
 * Panduan dasar tata letak aplikasi (spek 7 butir 1): berlaku bagi semua pengguna, tanpa halaman (tanpa banner;
 * ditawarkan lewat kartu/menu). Target `data-tour` dipasang di `app-shell.tsx`, `app-sidebar.tsx`,
 * `location-picker.tsx`, `notification-bell.tsx`, `theme-toggle.tsx`, dan `user-menu.tsx`. Pemilih lokasi hanya
 * dirender bila pengguna punya lebih dari satu lokasi, dan sidebar tertutup di ponsel: langkah yang targetnya tak
 * muncul dilewati mesin tur.
 */
export const DASAR_LAYOUT: GuideEntry = {
  id: 'dasar-layout',
  kind: 'dasar',
  status: 'disimpan',
  version: 1,
  title: 'Mengenal tampilan aplikasi',
  steps: [
    { target: 'sidebar-menu', text: 'Menu di sini mengikuti akses kamu.', advance: 'next' },
    {
      target: 'location-picker',
      text: 'Pilih lokasi aktif: daftar di halaman ikut berubah.',
      advance: 'next',
    },
    {
      target: 'notification-bell',
      text: 'Kabar terbaru (komentar, centang) muncul di sini.',
      advance: 'next',
    },
    { target: 'theme-toggle', text: 'Terang, gelap, atau ikut sistem.', advance: 'next' },
    {
      target: 'user-menu',
      text: 'Pasang aplikasi, atur notifikasi push, dan buka Panduan lagi dari sini.',
      advance: 'next',
    },
  ],
};
