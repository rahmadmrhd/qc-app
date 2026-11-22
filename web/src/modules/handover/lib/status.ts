import type { HandoverStatus } from '@shared/handover';
import type { UiColor } from '@/components/ui/variant-style';

export const HANDOVER_STATUS_LABELS: Record<HandoverStatus, string> = {
  new: 'Baru',
  in_progress: 'Dikerjakan',
  done: 'Selesai',
  cancelled: 'Dibatalkan',
};

/**
 * Warna status satu-satunya (badge task, kolom kanban, aksen kartu ponsel): Baru netral, Dikerjakan biru, Selesai
 * hijau, Dibatalkan merah. Status tidak hanya dibedakan lewat warna: label teks selalu tampil.
 */
export function badgeColorOf(status: HandoverStatus): UiColor {
  switch (status) {
    case 'in_progress':
      return 'info';
    case 'done':
      return 'success';
    case 'cancelled':
      return 'destructive';
    default:
      return 'secondary';
  }
}

/** Garis kiri aksen kartu ponsel menurut warna status (kelas statis agar dikenali Tailwind). */
export const HANDOVER_STATUS_ACCENT: Record<HandoverStatus, string> = {
  new: 'border-l-secondary-text',
  in_progress: 'border-l-info-text',
  done: 'border-l-success-text',
  cancelled: 'border-l-destructive-text',
};
