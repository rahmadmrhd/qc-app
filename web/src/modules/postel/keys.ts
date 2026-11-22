export const postelKeys = {
  all: ['postel'] as const,
  list: ['postel', 'list'] as const,
  /** Daftar catatan terhapus (hanya `sticker: edit`): kunci sendiri agar tak bercampur dengan daftar hidup. */
  listDeleted: ['postel', 'list', 'deleted'] as const,
  one: (id: string) => ['postel', 'one', id] as const,
  /** Riwayat perubahan satu catatan (log audit per target). */
  history: (id: string) => ['postel', 'history', id] as const,
  /** Pengaturan peringatan masa berlaku (halaman Konfigurasi Stiker). */
  settings: ['postel', 'settings'] as const,
};
