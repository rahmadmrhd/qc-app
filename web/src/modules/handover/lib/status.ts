import type { HandoverStatus } from '@shared/handover';

export const HANDOVER_STATUS_LABELS: Record<HandoverStatus, string> = {
  new: 'Baru',
  in_progress: 'Dikerjakan',
  done: 'Selesai',
  cancelled: 'Dibatalkan',
};

/**
 * Warna status: Selesai hijau, Dikerjakan biru, Baru netral, Dibatalkan merah (terang dan gelap).
 * Status tidak hanya dibedakan lewat warna: label teks selalu tampil.
 *  - `badge`: label status; `accent`: garis aksen kartu/kolom; `column`: latar kolom kanban.
 */
export const HANDOVER_STATUS_STYLES: Record<
  HandoverStatus,
  { badge: string; accent: string; column: string }
> = {
  new: {
    badge: 'border-border bg-background text-foreground',
    accent: 'border-l-border',
    column: 'border-t-border bg-muted/40',
  },
  in_progress: {
    badge: 'border-transparent bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-200',
    accent: 'border-l-blue-500',
    column: 'border-t-blue-500 bg-blue-500/5',
  },
  done: {
    badge:
      'border-transparent bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-200',
    accent: 'border-l-green-500',
    column: 'border-t-green-500 bg-green-500/5',
  },
  cancelled: {
    badge: 'border-transparent bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200',
    accent: 'border-l-red-500',
    column: 'border-t-red-500 bg-red-500/5',
  },
};
