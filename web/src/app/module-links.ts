import type { ModuleKey } from '@shared/permissions';
import type { LinkProps } from '@tanstack/react-router';

/** Modul yang sudah punya halaman. Modul tanpa entri ditandai "Segera hadir" di beranda. */
export const MODULE_LINKS: Partial<Record<ModuleKey, LinkProps['to']>> = {
  access: '/access/users',
  item: '/item',
  qrcode: '/qrcode',
  handover: '/handover',
  qc: '/handover',
  sticker: '/sticker',
  stickerstock: '/sticker',
  serial: '/serial',
  serialservice: '/serial',
  // Rute `/dashboard` dibuat di Tugas 11 (route tree belum memuatnya); ganti ke literal biasa saat itu.
  dashboard: '/dashboard' as unknown as LinkProps['to'],
};
