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
    badge: 'border-transparent bg-info-text/15 text-info-text',
    accent: 'border-l-info-text',
    column: 'border-t-info-text bg-info-text/5',
  },
  done: {
    badge: 'border-transparent bg-success-text/15 text-success-text',
    accent: 'border-l-success-text',
    column: 'border-t-success-text bg-success-text/5',
  },
  cancelled: {
    badge: 'border-transparent bg-destructive-text/15 text-destructive-text',
    accent: 'border-l-destructive-text',
    column: 'border-t-destructive-text bg-destructive-text/5',
  },
};
